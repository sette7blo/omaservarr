import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// Background service: polls Sonarr, Radarr and Lidarr with their API keys and
// exposes what they return to the bar widget and the panel. It only reads;
// nothing here changes anything on the servers.
Item {
  id: root

  property var shell: null
  property bool panelOpen: false

  // --- Persistent settings (bar layout entry) ------------------------------
  property var pluginSettings: Model.pluginSettings(null, Model.PLUGIN_ID)
  readonly property int pollSeconds: pluginSettings.pollSeconds
  readonly property int calendarDays: pluginSettings.calendarDays

  // --- Connection (private state file, shared with bin/omaservarr) ---------
  property var connection: Model.emptyConnection()
  property bool connectionLoaded: false
  readonly property var configuredIds: Model.configuredIds(connection)
  readonly property bool configured: configuredIds.length > 0

  // --- Filesystem layout ---------------------------------------------------
  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string stateDir: home + "/.local/state/omarchy/omaservarr"
  readonly property string cacheDir: home + "/.cache/omarchy/omaservarr"
  readonly property string connectionPath: stateDir + "/credentials.json"
  readonly property string pluginDir: home + "/.config/omarchy/plugins/io.github.sette7blo.omaservarr"

  // --- Fetched state exposed to widget/panel -------------------------------
  property var snapshot: Model.emptyState()
  property string lastUpdatedAt: ""
  property bool busy: false
  readonly property var summary: Model.summary(snapshot, configuredIds)

  // --- Settings test-connection result (SettingsView listens) --------------
  // `ticket` is the number testConnection returned, so a view can tell a
  // late answer about values it has since changed from the current one.
  signal connectionProbed(string serviceId, int ticket, bool ok, string message)

  // --- Internal state ------------------------------------------------------
  property bool dirsReady: false
  property bool headersReady: false
  property int headerGen: 0
  property int headerPending: 0
  property bool headerFailed: false
  property var writeQueue: []
  property string pendingWriteText: ""
  property string pendingWriteThen: ""
  property var reqQueue: []
  property var currentReq: null
  property string probingId: ""
  property int probeTicket: 0
  // "" until checked, then installed, none or unavailable.
  property string skillsState: ""
  property bool skillsBusy: false
  property double slowFetchedAt: 0
  property double libraryFetchedAt: 0

  readonly property int slowSeconds: 900
  readonly property int librarySeconds: 600

  // --- Plugin settings -----------------------------------------------------
  function loadSettings() {
    var sh = root.shell
    var cfg = sh ? (sh.shellConfig || (sh.barConfig ? { bar: sh.barConfig } : null)) : null
    var next = Model.pluginSettings(cfg, Model.PLUGIN_ID)
    if (JSON.stringify(next) !== JSON.stringify(root.pluginSettings)) root.pluginSettings = next
  }

  function persistSettings(patch) {
    var current = Model.normalizeSettings(root.pluginSettings)
    var extra = patch && typeof patch === "object" ? patch : {}
    for (var k in extra) current[k] = extra[k]
    current = Model.normalizeSettings(current)
    if (root.shell && typeof root.shell.updateEntryInline === "function")
      root.shell.updateEntryInline(Model.PLUGIN_ID, Model.settingsPayload(current))
    root.pluginSettings = current
  }

  // --- Connection write (atomic, chmod 600) --------------------------------
  function persistConnection(patch) {
    var next = Model.mergeConnection(root.connection, patch)
    enqueueWrite(root.stateDir, "credentials.json", Model.serializeConnection(next), "connection")
    root.applyConnection(next)
  }

  function applyConnection(next) {
    if (Model.sameConnection(next, root.connection)) return
    root.connection = next
    root.snapshot = Model.emptyState()
    root.reqQueue = []
    root.slowFetchedAt = 0
    root.libraryFetchedAt = 0
    root.refreshHeaders()
  }

  function enqueueWrite(dir, name, text, thenKind) {
    root.writeQueue = root.writeQueue.concat([{
      dir: dir, name: name, text: String(text || ""), thenKind: String(thenKind || "")
    }])
    pumpWrites()
  }

  function pumpWrites() {
    if (secretProc.running || !root.writeQueue.length) return
    var next = root.writeQueue[0]
    root.writeQueue = root.writeQueue.slice(1)
    root.pendingWriteText = next.text
    root.pendingWriteThen = next.thenKind
    secretProc.command = Model.atomicWriteCmd(next.dir, next.name, Model.utf8ByteLength(next.text))
    secretProc.running = true
  }

  // One curl header file per service keeps the keys out of process listings.
  // Polling waits until every file of the newest batch is written. One failed
  // write keeps it stopped, since that file may still hold an older key that
  // must not go to a newly saved address.
  function refreshHeaders() {
    if (!root.dirsReady) return
    root.headersReady = false
    root.headerGen += 1
    root.headerFailed = false
    var ids = root.configuredIds
    root.headerPending = ids.length
    for (var i = 0; i < ids.length; i++) {
      enqueueWrite(root.cacheDir, Model.headerFileName(ids[i]),
        Model.headerText(root.connection[ids[i]].apiKey), "headers:" + root.headerGen)
    }
  }

  function headerWritten(then, ok) {
    if (then !== "headers:" + root.headerGen) return  // an older batch
    if (!ok) root.headerFailed = true
    root.headerPending -= 1
    if (root.headerPending > 0 || root.headerFailed) return
    root.headersReady = true
    root.forcePoll(true)
    if (root.panelOpen) root.ensureLibrary(false)
  }

  // --- HTTP request queue --------------------------------------------------
  function enqueueRequest(id, kind) {
    if (!root.headersReady || !Model.isConfigured(root.connection, id)) return
    for (var i = 0; i < root.reqQueue.length; i++) {
      if (root.reqQueue[i].id === id && root.reqQueue[i].kind === kind) return
    }
    var opts = { now: new Date(), calendarDays: root.calendarDays }
    var path = Model.requestPath(id, kind, opts)
    if (!path) return
    root.reqQueue = root.reqQueue.concat([{
      id: id, kind: kind, opts: opts,
      url: Model.apiUrl(root.connection[id].baseUrl, path),
      filter: Model.requestFilter(id, kind)
    }])
    pump()
  }

  function enqueueKinds(kinds) {
    var ids = root.configuredIds
    for (var i = 0; i < ids.length; i++) {
      for (var k = 0; k < kinds.length; k++) enqueueRequest(ids[i], kinds[k])
    }
  }

  // Queue and health every poll. Calendar, recent imports and the missing
  // count change slowly, so they refresh on a longer interval, or at once
  // when `everything` is set.
  function forcePoll(everything) {
    if (!root.configured || !root.headersReady) return
    enqueueKinds(Model.FAST_KINDS)
    var now = Date.now()
    if (everything || now - root.slowFetchedAt > root.slowSeconds * 1000) {
      root.slowFetchedAt = now
      enqueueKinds(Model.SLOW_KINDS)
    }
  }

  // The library is the heavy request. It loads when the panel asks for it.
  function ensureLibrary(force) {
    if (!root.configured || !root.headersReady) return
    var now = Date.now()
    if (!force && now - root.libraryFetchedAt < root.librarySeconds * 1000) return
    root.libraryFetchedAt = now
    enqueueKinds(["library"])
  }

  function refreshAll() {
    forcePoll(true)
    if (root.libraryFetchedAt > 0) ensureLibrary(true)
  }

  function dropRequestsFor(id) {
    var keep = []
    for (var i = 0; i < root.reqQueue.length; i++) {
      if (root.reqQueue[i].id !== id) keep.push(root.reqQueue[i])
    }
    root.reqQueue = keep
  }

  function pump() {
    if (apiProc.running || !root.dirsReady || !root.headersReady) return
    if (!root.reqQueue.length) { root.busy = false; return }
    var next = root.reqQueue[0]
    root.reqQueue = root.reqQueue.slice(1)
    root.currentReq = next
    root.busy = true
    apiProc.command = Model.fetchCmd(root.cacheDir + "/" + Model.headerFileName(next.id), next.url, next.filter)
    apiProc.running = true
  }

  function handleResponse(req, statusCode, body) {
    if (statusCode === 401 || statusCode === 403) {
      root.snapshot = Model.applyFailure(root.snapshot, req.id, "unauthorized", "HTTP " + statusCode)
      root.dropRequestsFor(req.id)  // don't hammer the server with a bad key
      return
    }
    if (statusCode < 200 || statusCode >= 400) {
      // Older versions lack /wanted/missing; that is not a service failure.
      if (req.kind !== "missing")
        root.snapshot = Model.applyFailure(root.snapshot, req.id, "error", "HTTP " + statusCode + " on " + req.kind)
      return
    }
    root.snapshot = Model.applyResponse(root.snapshot, req.id, req.kind, body, req.opts)
    root.lastUpdatedAt = new Date().toISOString()
  }

  // --- Test-connection one-shot (used by SettingsView) ---------------------
  // Runs before Save, so the key is not in a header file yet. It reaches curl
  // on stdin as a config file rather than on the command line.
  // --- Agent skills --------------------------------------------------------
  // Linked only when the user presses the button in the Settings view.
  function checkSkills() {
    if (skillsProc.running) return
    skillsProc.statusRun = true
    skillsProc.command = [root.pluginDir + "/install.sh", "--skills-status"]
    skillsProc.running = true
  }

  function setSkills(install) {
    if (skillsProc.running) return
    root.skillsBusy = true
    skillsProc.statusRun = false
    // --if-needed keeps the installer from rescanning plugins, which would
    // reload this service in the middle of the run.
    skillsProc.command = install
      ? [root.pluginDir + "/install.sh", "--if-needed", "--skills"]
      : [root.pluginDir + "/uninstall.sh", "--skills"]
    skillsProc.running = true
  }

  // Returns the ticket the answer will carry, or 0 when no test started.
  function testConnection(id, testBaseUrl, testKey) {
    var info = Model.serviceInfo(id)
    var base = Model.normalizeBaseUrl(testBaseUrl)
    var key = String(testKey || "").replace(/\s+/g, "")
    if (root.probingId !== "") return 0
    root.probeTicket += 1
    if (!info || !Model.isHttpUrl(base) || !Model.isValidKey(key)) {
      root.connectionProbed(id, root.probeTicket, false, "Enter the address and the API key first.")
      return root.probeTicket
    }
    root.probingId = id
    probeProc.config = "header = \"X-Api-Key: " + key + "\"\nheader = \"Accept: application/json\"\n"
    probeProc.command = Model.probeCmd(Model.utf8ByteLength(probeProc.config),
      Model.apiUrl(base, Model.requestPath(id, "status")))
    probeProc.running = true
    return root.probeTicket
  }

  // --- Processes -----------------------------------------------------------
  Process {
    id: ensureDirProc
    running: false
    onExited: function(code) {
      if (code !== 0) return
      root.dirsReady = true
      connectionFile.reload()
      root.refreshHeaders()
    }
  }

  Process {
    id: secretProc
    running: false
    stdinEnabled: true
    onRunningChanged: {
      if (running) secretProc.write(root.pendingWriteText)
    }
    onExited: function(code) {
      var then = root.pendingWriteThen
      root.pendingWriteText = ""
      root.pendingWriteThen = ""
      if (then.indexOf("headers:") === 0) root.headerWritten(then, code === 0)
      Qt.callLater(root.pumpWrites)
      Qt.callLater(root.pump)
    }
  }

  Process {
    id: apiProc
    running: false
    stdout: StdioCollector { id: apiOut; waitForEnd: true }
    onExited: function(code) {
      var raw = String(apiOut.text || "")
      var req = root.currentReq
      root.currentReq = null
      if (req && Model.isConfigured(root.connection, req.id)) {
        if (code !== 0) {
          root.snapshot = Model.applyFailure(root.snapshot, req.id, "unreachable",
            code === 90 ? "Unreadable response" : "curl exit " + code)
          root.dropRequestsFor(req.id)
        } else {
          var res = Model.splitResponse(raw)
          if (res.status > 0) root.handleResponse(req, res.status, res.body)
          else root.snapshot = Model.applyFailure(root.snapshot, req.id, "error", "Unparseable response")
        }
      }
      Qt.callLater(root.pump)
    }
  }

  Process {
    id: probeProc
    property string config: ""
    running: false
    stdinEnabled: true
    stdout: StdioCollector { id: probeOut; waitForEnd: true }
    onRunningChanged: {
      if (running) {
        probeProc.write(probeProc.config)
        probeProc.config = ""
      }
    }
    onExited: function(code) {
      var id = root.probingId
      var t = root.probeTicket
      var name = Model.serviceName(id)
      root.probingId = ""
      var report = function(ok, message) { root.connectionProbed(id, t, ok, message) }
      if (code === 63) {
        report(false, "The server sent a far larger answer than " + name + " does. Check the address.")
        return
      }
      if (code === 47) {
        report(false, "The address redirects elsewhere. Enter the address " + name + " answers on directly.")
        return
      }
      if (code !== 0) {
        report(false, "Could not reach the server. Check the address and that " + name + " is running.")
        return
      }
      var res = Model.splitResponse(String(probeOut.text || ""))
      if (res.status === 200) {
        var info = Model.parseStatus(res.body)
        if (!info) report(false, "The server did not respond like " + name + ". Check the address.")
        else if (info.appName && info.appName.toLowerCase() !== id)
          report(false, "This address answers as " + info.appName + ", not " + name + ".")
        else report(true, "Connected to " + name + (info.version ? " " + info.version : ""))
      } else if (res.status === 401 || res.status === 403) {
        report(false, name + " did not accept this API key.")
      } else if (res.status > 0) {
        report(false, name + " returned HTTP " + res.status + ".")
      } else {
        report(false, "The server did not respond like " + name + ". Check the address.")
      }
    }
  }

  FileView {
    id: connectionFile
    path: root.connectionPath
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: {
      root.connectionLoaded = true
      var next = Model.parseConnection(text())
      if (Model.sameConnection(next, root.connection)) {
        if (!root.headersReady && !root.writeQueue.length && !secretProc.running) root.refreshHeaders()
      } else {
        root.applyConnection(next)
      }
    }
    onLoadFailed: {
      root.connectionLoaded = true
      root.applyConnection(Model.emptyConnection())
    }
    onFileChanged: reload()
  }

  // --- Lifecycle -----------------------------------------------------------
  // install.sh --if-needed finishes what omarchy plugin add does not (the
  // command and the launcher) and exits at once when that is already done.
  // It never links the agent skills; that takes install.sh --skills by hand.
  Process {
    id: installProc
    running: false
  }

  Process {
    id: skillsProc
    property bool statusRun: false
    running: false
    stdout: StdioCollector { id: skillsOut; waitForEnd: true }
    onExited: function(code) {
      if (skillsProc.statusRun) {
        var word = String(skillsOut.text || "").trim()
        if (word === "installed" || word === "none" || word === "unavailable") root.skillsState = word
        return
      }
      root.skillsBusy = false
      Qt.callLater(root.checkSkills)
    }
  }

  Component.onCompleted: {
    ensureDirProc.command = Model.ensurePrivateDirsCmd(root.stateDir, root.cacheDir)
    ensureDirProc.running = true
    installProc.command = [root.pluginDir + "/install.sh", "--if-needed"]
    installProc.running = true
  }

  onShellChanged: root.loadSettings()

  Connections {
    target: root.shell
    ignoreUnknownSignals: true
    function onBarConfigChanged() { root.loadSettings() }
    function onShellConfigChanged() { root.loadSettings() }
  }

  onCalendarDaysChanged: {
    root.slowFetchedAt = 0
    root.forcePoll(false)
  }

  onPanelOpenChanged: if (root.panelOpen) root.forcePoll(true)

  Timer {
    interval: Math.max(Model.MIN_POLL_SECONDS, root.pollSeconds) * 1000
    running: root.configured && root.headersReady
    repeat: true
    onTriggered: root.forcePoll(false)
  }
}
