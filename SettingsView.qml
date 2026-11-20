import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Connection settings shown in place of the panel body. One address and key
// pair is on screen at a time; the chips switch between the three services
// and the edits for all of them are saved together.
Column {
  id: root

  property var service: null
  property color foreground: Color.foreground
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property bool editorOpen: urlField.activeFocus || keyField.activeFocus
    || pollField.field.activeFocus || daysField.field.activeFocus

  property string current: Model.SERVICES[0].id
  property var draft: Model.emptyConnection()
  property var probes: ({})
  property string probingId: ""
  // The ticket of the test this view waits for, and whether the address or
  // key of that service changed since it started, so its answer is old.
  property int probeTicket: 0
  property bool probeStale: false
  property bool edited: false

  readonly property var info: Model.serviceInfo(current)
  readonly property var probe: probes[current] || null
  readonly property bool dirty: !service
    ? false
    : (!Model.sameConnection(draft, service.connection)
      || pollField.value !== service.pollSeconds
      || daysField.value !== service.calendarDays)

  signal closeSettings()

  function showCurrent() {
    var entry = draft[current] || { baseUrl: "", apiKey: "" }
    urlField.text = entry.baseUrl
    keyField.text = entry.apiKey
  }

  function reset() {
    if (!service) return
    draft = Model.mergeConnection(service.connection, {})
    pollField.value = service.pollSeconds
    daysField.value = service.calendarDays
    probes = ({})
    probingId = ""
    probeTicket = 0
    probeStale = false
    edited = false
    showCurrent()
  }

  function editCurrent() {
    var patch = {}
    patch[current] = { baseUrl: urlField.text, apiKey: keyField.text }
    draft = Model.mergeConnection(draft, patch)
    edited = true
    if (probingId === current) probeStale = true
    var next = {}
    for (var k in probes) if (k !== current) next[k] = probes[k]
    probes = next
  }

  function save() {
    if (!service) return
    service.persistSettings({ pollSeconds: pollField.value, calendarDays: daysField.value })
    service.persistConnection(draft)
  }

  Component.onCompleted: {
    reset()
    if (service) service.checkSkills()
  }
  onVisibleChanged: if (visible && service) service.checkSkills()
  onCurrentChanged: showCurrent()

  Connections {
    target: root.service
    ignoreUnknownSignals: true
    // Saved values can arrive after the view opens; follow them until the
    // user starts editing.
    function onConnectionChanged() { if (!root.edited) root.reset() }
    function onPollSecondsChanged() { if (!root.edited) root.reset() }
    function onCalendarDaysChanged() { if (!root.edited) root.reset() }
    function onConnectionProbed(serviceId, ticket, ok, message) {
      if (ticket !== root.probeTicket) return
      root.probeTicket = 0
      root.probingId = ""
      if (root.probeStale) {
        root.probeStale = false
        return
      }
      var next = {}
      for (var k in root.probes) next[k] = root.probes[k]
      next[serviceId] = { ok: ok, message: String(message || "") }
      root.probes = next
    }
  }

  width: parent ? parent.width : implicitWidth
  spacing: Style.spacing.xxl

  component FieldLabel: Text {
    textFormat: Text.PlainText
    color: root.dim
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  ButtonGroup {
    options: {
      var list = []
      for (var i = 0; i < Model.SERVICES.length; i++) {
        var s = Model.SERVICES[i]
        list.push({
          value: s.id,
          label: s.name,
          tooltip: Model.isConfigured(root.draft, s.id) ? "Connected" : "Not set up"
        })
      }
      return list
    }
    value: root.current
    focusable: false
    foreground: root.foreground
    accent: root.accent
    fontFamily: root.fontFamily
    onChanged: function(value) { root.current = value }
  }

  // ---- Address ----
  Column {
    width: parent.width
    spacing: Style.spacing.md

    FieldLabel { text: (root.info ? root.info.name : "") + " address" }
    GuardedTextField {
      id: urlField
      width: parent.width
      placeholderText: root.info ? root.info.defaultUrl : ""
      foreground: root.foreground
      accent: root.accent
      onTextEdited: root.editCurrent()
    }
  }

  // ---- API key ----
  Column {
    width: parent.width
    spacing: Style.spacing.md

    FieldLabel { text: "API key" }
    GuardedTextField {
      id: keyField
      width: parent.width
      placeholderText: "32 characters"
      password: true
      foreground: root.foreground
      accent: root.accent
      onTextEdited: root.editCurrent()
    }
    Text {
      textFormat: Text.PlainText
      width: parent.width
      text: "Find it in " + (root.info ? root.info.name : "the app") + " under Settings, General, Security. Leave both fields empty to skip this service."
      color: root.dim
      wrapMode: Text.WordWrap
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  // ---- Connection result ----
  Row {
    width: parent.width
    spacing: Style.spacing.lg
    visible: root.probingId === root.current || root.probe !== null

    readonly property bool busy: root.probingId === root.current
    readonly property bool ok: !!root.probe && root.probe.ok === true

    Rectangle {
      anchors.verticalCenter: parent.verticalCenter
      width: Style.space(6)
      height: width
      radius: width / 2
      color: parent.busy ? root.dim : (parent.ok ? root.foreground : Color.urgent)
    }
    Text {
      textFormat: Text.PlainText
      width: parent.width - Style.space(6) - parent.spacing
      text: parent.busy ? "Testing connection" : (root.probe ? root.probe.message : "")
      color: parent.busy ? root.dim : (parent.ok ? root.foreground : Color.urgent)
      wrapMode: Text.WordWrap
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }

  PanelSeparator { foreground: root.foreground }

  // ---- Refresh ----
  NumberField {
    id: pollField
    width: parent.width
    label: "Refresh every (seconds)"
    from: Model.MIN_POLL_SECONDS
    to: Model.MAX_POLL_SECONDS
    stepSize: 15
    foreground: root.foreground
    accent: root.accent
    fontFamily: root.fontFamily
    onModified: function(v) { root.edited = true; pollField.value = v }
    // Editable only while focused, like GuardedTextField.
    field.editable: pollField.field.activeFocus
  }

  NumberField {
    id: daysField
    width: parent.width
    label: "Upcoming: days ahead"
    from: 1
    to: 60
    stepSize: 1
    foreground: root.foreground
    accent: root.accent
    fontFamily: root.fontFamily
    onModified: function(v) { root.edited = true; daysField.value = v }
    // Editable only while focused, like GuardedTextField.
    field.editable: daysField.field.activeFocus
  }

  PanelSeparator { foreground: root.foreground }

  // ---- Agent skills ----
  // Never linked on their own; this button is the opt-in.
  Column {
    id: skillsSection
    width: parent.width
    spacing: Style.spacing.md
    visible: mode !== ""

    readonly property string mode: root.service ? root.service.skillsState : ""
    readonly property bool busy: !!root.service && root.service.skillsBusy

    FieldLabel { text: "Agent skills" }
    Text {
      textFormat: Text.PlainText
      width: parent.width
      text: skillsSection.mode === "installed"
        ? "Linked into the agent skill folders on this machine. Removing them leaves everything else in place."
        : (skillsSection.mode === "unavailable"
          ? "No agent folder found (~/.agents, ~/.claude, ~/.codex or ~/.copilot), so there is nowhere to link the skills."
          : "Optional. Links five skills into the skill folders of the agents on this machine (~/.agents, ~/.claude, ~/.codex and ~/.copilot, whichever exist), so an agent can check the queue, upcoming, library and health and add a title after you confirm. Nothing is linked until you press the button.")
      color: root.dim
      wrapMode: Text.WordWrap
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
    Button {
      visible: skillsSection.mode !== "unavailable"
      text: skillsSection.mode === "installed" ? "Remove agent skills" : "Install agent skills"
      bordered: true
      enabled: !skillsSection.busy
      opacity: skillsSection.busy ? 0.45 : 1
      foreground: root.foreground
      accent: root.accent
      fontFamily: root.fontFamily
      onClicked: if (root.service) root.service.setSkills(skillsSection.mode !== "installed")
    }
  }

  PanelSeparator { foreground: root.foreground }

  // ---- Actions ----
  RowLayout {
    width: parent.width
    spacing: Style.spacing.lg

    Button {
      text: "Test " + (root.info ? root.info.name : "")
      bordered: true
      foreground: root.foreground
      accent: root.accent
      fontFamily: root.fontFamily
      onClicked: {
        if (!root.service || root.probingId !== "") return
        root.probingId = root.current
        root.probeStale = false
        // The answer can arrive before testConnection returns.
        root.probeTicket = root.service.probeTicket + 1
        if (root.service.testConnection(root.current, urlField.text, keyField.text) === 0) {
          root.probingId = ""
          root.probeTicket = 0
        }
      }
    }

    Item { Layout.fillWidth: true }

    Button {
      text: "Save"
      bordered: true
      selected: root.dirty
      enabled: root.dirty
      opacity: root.dirty ? 1 : 0.45
      foreground: root.foreground
      accent: root.accent
      fontFamily: root.fontFamily
      onClicked: {
        root.save()
        root.closeSettings()
      }
    }
  }
}
