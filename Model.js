// Pure-JS helpers shared by Service.qml, Panel.qml, BarWidget.qml and
// SettingsView.qml: settings, the connection file, request URLs, response
// parsing and the row lists the panel draws. No QML types in here, so the
// whole file runs under Node for tests.

var PLUGIN_ID = "io.github.sette7blo.omaservarr"
var DEFAULT_POLL_SECONDS = 60
var MIN_POLL_SECONDS = 15
var MAX_POLL_SECONDS = 3600
var DEFAULT_CALENDAR_DAYS = 7
var MIN_CALENDAR_DAYS = 1
var MAX_CALENDAR_DAYS = 60

// Response bounds. Anything past these is dropped before it reaches the UI.
var MAX_TEXT = 200
var MAX_QUEUE = 100
var MAX_CALENDAR = 200
var MAX_RECENT = 40
var MAX_HEALTH = 50
var MAX_LIBRARY = 20000
var MAX_LIBRARY_ROWS = 400

var SERVICES = [
  { id: "sonarr", name: "Sonarr", api: "/api/v3", defaultUrl: "http://localhost:8989", itemOne: "series", itemMany: "series", unit: "episodes" },
  { id: "radarr", name: "Radarr", api: "/api/v3", defaultUrl: "http://localhost:7878", itemOne: "movie", itemMany: "movies", unit: "movies" },
  { id: "lidarr", name: "Lidarr", api: "/api/v1", defaultUrl: "http://localhost:8686", itemOne: "artist", itemMany: "artists", unit: "albums" }
]

function serviceIds() {
  var ids = []
  for (var i = 0; i < SERVICES.length; i++) ids.push(SERVICES[i].id)
  return ids
}

function serviceInfo(id) {
  for (var i = 0; i < SERVICES.length; i++) {
    if (SERVICES[i].id === id) return SERVICES[i]
  }
  return null
}

function serviceName(id) {
  var info = serviceInfo(id)
  return info ? info.name : String(id || "")
}

// ----- Settings (persisted into the Omarchy bar layout entry) -------------

function defaultSettings() {
  return { pollSeconds: DEFAULT_POLL_SECONDS, calendarDays: DEFAULT_CALENDAR_DAYS }
}

function clampInt(value, min, max, fallback) {
  var n = parseInt(value, 10)
  if (!(n >= min)) return fallback
  if (n > max) return max
  return n
}

function normalizeSettings(raw) {
  var data = raw && typeof raw === "object" ? raw : {}
  return {
    pollSeconds: clampInt(data.pollSeconds, MIN_POLL_SECONDS, MAX_POLL_SECONDS, DEFAULT_POLL_SECONDS),
    calendarDays: clampInt(data.calendarDays, MIN_CALENDAR_DAYS, MAX_CALENDAR_DAYS, DEFAULT_CALENDAR_DAYS)
  }
}

function pluginSettings(config, id) {
  var key = String(id || PLUGIN_ID)
  var empty = defaultSettings()
  if (!config || typeof config !== "object") return empty

  function fromEntry(entry) {
    if (!entry || typeof entry !== "object") return null
    if (String(entry.id || "") !== key) return null
    return normalizeSettings(entry)
  }

  var bar = config.bar && config.bar.layout ? config.bar.layout : {}
  var sections = ["left", "center", "right"]
  for (var s = 0; s < sections.length; s++) {
    var entries = bar[sections[s]] || []
    for (var i = 0; i < entries.length; i++) {
      var found = fromEntry(entries[i])
      if (found) return found
    }
  }
  var plugins = config.plugins || []
  for (var p = 0; p < plugins.length; p++) {
    var plugin = fromEntry(plugins[p])
    if (plugin) return plugin
  }
  return empty
}

function settingsPayload(settings) {
  var data = normalizeSettings(settings)
  return { id: PLUGIN_ID, pollSeconds: data.pollSeconds, calendarDays: data.calendarDays }
}

// ----- Connection (address + API key per service, private state file) -----

function normalizeBaseUrl(value) {
  var s = String(value || "").replace(/^\s+|\s+$/g, "")
  if (!s) return ""
  return s.replace(/\/+$/, "")
}

function cleanKey(value) {
  return String(value || "").replace(/\s+/g, "")
}

function emptyConnection() {
  var conn = {}
  for (var i = 0; i < SERVICES.length; i++) conn[SERVICES[i].id] = { baseUrl: "", apiKey: "" }
  return conn
}

function cleanConnection(data) {
  var src = data && typeof data === "object" ? data : {}
  var conn = {}
  for (var i = 0; i < SERVICES.length; i++) {
    var id = SERVICES[i].id
    var entry = src[id] && typeof src[id] === "object" ? src[id] : {}
    conn[id] = { baseUrl: normalizeBaseUrl(entry.baseUrl), apiKey: cleanKey(entry.apiKey) }
  }
  return conn
}

function parseConnection(raw) {
  try {
    return cleanConnection(JSON.parse(String(raw || "{}")))
  } catch (e) {
    return emptyConnection()
  }
}

function serializeConnection(conn) {
  return JSON.stringify(cleanConnection(conn), null, 2) + "\n"
}

// patch: { sonarr: { baseUrl, apiKey }, ... }; services left out are kept.
function mergeConnection(conn, patch) {
  var merged = cleanConnection(conn)
  var extra = patch && typeof patch === "object" ? patch : {}
  for (var i = 0; i < SERVICES.length; i++) {
    var id = SERVICES[i].id
    if (!extra[id] || typeof extra[id] !== "object") continue
    if (extra[id].baseUrl !== undefined) merged[id].baseUrl = normalizeBaseUrl(extra[id].baseUrl)
    if (extra[id].apiKey !== undefined) merged[id].apiKey = cleanKey(extra[id].apiKey)
  }
  return merged
}

function isHttpUrl(url) {
  return /^https?:\/\/[^\s"'\\]+$/.test(String(url || ""))
}

// The *arr apps generate 32 hex characters, but a reverse proxy or a custom
// build may differ, so only the shape of a header-safe token is enforced.
function isValidKey(key) {
  return /^[A-Za-z0-9_\-]{8,128}$/.test(String(key || ""))
}

function isConfigured(conn, id) {
  var entry = conn && conn[id]
  return !!entry && isHttpUrl(entry.baseUrl) && isValidKey(entry.apiKey)
}

function configuredIds(conn) {
  var ids = []
  for (var i = 0; i < SERVICES.length; i++) {
    if (isConfigured(conn, SERVICES[i].id)) ids.push(SERVICES[i].id)
  }
  return ids
}

function sameConnection(a, b) {
  return serializeConnection(a) === serializeConnection(b)
}

// ----- Requests -----------------------------------------------------------

var FAST_KINDS = ["queue", "health"]
var SLOW_KINDS = ["calendar", "recent", "missing"]

function apiUrl(base, path) {
  var root = normalizeBaseUrl(base)
  if (!root) return ""
  var p = String(path || "")
  if (!p) return root
  return root + (p.charAt(0) === "/" ? p : "/" + p)
}

function dayStart(date) {
  var d = date || new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Path below the service address for one kind of request. `opts.now` and
// `opts.calendarDays` only matter for the calendar.
function requestPath(id, kind, opts) {
  var info = serviceInfo(id)
  if (!info) return ""
  var api = info.api
  var o = opts || {}
  if (kind === "status") return api + "/system/status"
  if (kind === "health") return api + "/health"
  if (kind === "missing") return api + "/wanted/missing?page=1&pageSize=1"
  if (kind === "queue") {
    var q = api + "/queue?page=1&pageSize=" + MAX_QUEUE
    if (id === "sonarr") return q + "&includeUnknownSeriesItems=true&includeSeries=true&includeEpisode=true"
    if (id === "radarr") return q + "&includeUnknownMovieItems=true&includeMovie=true"
    return q + "&includeUnknownArtistItems=true&includeArtist=true&includeAlbum=true"
  }
  if (kind === "calendar") {
    var start = dayStart(o.now)
    var days = clampInt(o.calendarDays, MIN_CALENDAR_DAYS, MAX_CALENDAR_DAYS, DEFAULT_CALENDAR_DAYS)
    var end = new Date(start.getTime() + days * 86400000)
    var c = api + "/calendar?start=" + encodeURIComponent(start.toISOString())
      + "&end=" + encodeURIComponent(end.toISOString()) + "&unmonitored=false"
    if (id === "sonarr") return c + "&includeSeries=true"
    if (id === "lidarr") return c + "&includeArtist=true"
    return c
  }
  if (kind === "recent") {
    // eventType 3 is "download folder imported" in Sonarr and Radarr. Lidarr
    // logs one of those per track, so its per-album event (8) is used instead.
    var h = api + "/history?page=1&pageSize=" + MAX_RECENT + "&sortKey=date&sortDirection=descending"
    if (id === "sonarr") return h + "&eventType=3&includeSeries=true&includeEpisode=true"
    if (id === "radarr") return h + "&eventType=3&includeMovie=true"
    return h + "&eventType=8&includeArtist=true&includeAlbum=true"
  }
  if (kind === "library") {
    if (id === "sonarr") return api + "/series"
    if (id === "radarr") return api + "/movie"
    return api + "/artist"
  }
  return ""
}

// A whole library is megabytes of JSON. When jq is installed the response is
// cut down to the fields parseLibrary reads before it reaches the shell.
function requestFilter(id, kind) {
  if (kind !== "library") return ""
  if (id === "sonarr")
    return "[.[]|{id,title,year,titleSlug,monitored,sizeOnDisk:(.statistics.sizeOnDisk//0),have:(.statistics.episodeFileCount//0),total:(.statistics.episodeCount//0)}]"
  if (id === "radarr")
    return "[.[]|{id,title,year,tmdbId,monitored,hasFile,sizeOnDisk:(.sizeOnDisk//0)}]"
  if (id === "lidarr")
    return "[.[]|{id,title:.artistName,foreignArtistId,monitored,sizeOnDisk:(.statistics.sizeOnDisk//0),have:(.statistics.trackFileCount//0),total:(.statistics.trackCount//0)}]"
  return ""
}

function headerText(apiKey) {
  return "X-Api-Key: " + cleanKey(apiKey) + "\nAccept: application/json\n"
}

function headerFileName(id) {
  return "header-" + String(id || "") + ".txt"
}

// Every request that carries a key starts curl this way. -q must come first:
// it skips the user's ~/.curlrc, which could turn on redirects or a proxy.
// -L with --max-redirs 0 turns any redirect into an error (exit 47) instead
// of following it, so the key header only ever goes to the saved address.
var CURL_SAFE = "curl -q -L --max-redirs 0 --proto '=http,https'"

// Prints the response body, a newline and the HTTP status. Exits with curl's
// own code when the server could not be reached.
function fetchCmd(headerPath, url, filter) {
  return ["sh", "-c",
    "out=$(" + CURL_SAFE + " -sS -m 45 --max-filesize 67108864 -H \"@$1\" -w '\\n%{http_code}' -- \"$2\") || exit $?\n"
      + "code=$(printf '%s' \"$out\" | tail -n 1)\n"
      + "body=$(printf '%s' \"$out\" | sed '$d')\n"
      + "if [ -n \"$3\" ] && [ \"$code\" = 200 ] && command -v jq >/dev/null 2>&1; then\n"
      + "  body=$(printf '%s' \"$body\" | jq -c \"$3\") || exit 90\n"
      + "fi\n"
      + "printf '%s\\n%s' \"$body\" \"$code\"\n",
    "omaservarr-fetch", String(headerPath || ""), String(url || ""), String(filter || "")]
}

// A status answer is a few hundred bytes; anything past this is not one.
var PROBE_MAX_BYTES = 65536

// One-off status request for the settings form. The curl config (holding the
// key) arrives on stdin; head passes on exactly `bytes` of it and then closes
// the pipe, so curl does not wait for an end of file the shell never sends.
// The body goes to a private temporary file capped by --max-filesize, and only
// its first PROBE_MAX_BYTES reach the shell, so a fast endless answer can
// never pile up in memory. Exit 63 means the answer was too large.
function probeCmd(bytes, url) {
  return ["sh", "-c",
    "umask 077\n"
      + "tmp=$(mktemp) || exit 1\n"
      + "trap 'rm -f \"$tmp\"' EXIT\n"
      + "code=$(head -c \"$1\" | " + CURL_SAFE + " -sS -m 10 --max-filesize \"$3\" -o \"$tmp\" -w '%{http_code}' -K - -- \"$2\") || exit $?\n"
      + "head -c \"$3\" \"$tmp\"\n"
      + "printf '\\n%s' \"$code\"\n",
    "omaservarr-probe", String(parseInt(bytes, 10) || 0), String(url || ""), String(PROBE_MAX_BYTES)]
}

function splitResponse(raw) {
  var text = String(raw || "")
  var cut = text.lastIndexOf("\n")
  var code = parseInt(cut >= 0 ? text.slice(cut + 1) : text, 10)
  return { status: code > 0 ? code : 0, body: cut >= 0 ? text.slice(0, cut) : "" }
}

// ----- Shell helpers (atomic private writes) ------------------------------

function leafName(filePath) {
  var parts = String(filePath || "").split("/")
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "..") return ""
  }
  var name = parts.length ? parts[parts.length - 1] : ""
  if (!name || name === "." || name === ".." || name.indexOf("/") !== -1) return ""
  return name
}

function utf8ByteLength(text) {
  var s = String(text || "")
  var n = 0
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c < 128) n += 1
    else if (c < 2048) n += 2
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++ }
    else n += 3
  }
  return n
}

function ensurePrivateDirsCmd(stateDir, cacheDir) {
  return ["sh", "-c",
    "ensure() {\n"
      + "  t=$1\n"
      + "  mkdir -p -- \"$(dirname -- \"$t\")\" || exit 1\n"
      + "  if [ -L \"$t\" ]; then exit 1; fi\n"
      + "  if [ -e \"$t\" ]; then [ -d \"$t\" ] || exit 1; else mkdir -m 700 -- \"$t\" || exit 1; fi\n"
      + "  chmod 700 -- \"$t\" || exit 1\n"
      + "}\n"
      + "ensure \"$1\"\n"
      + "ensure \"$2\"\n",
    "omaservarr-dirs", String(stateDir || ""), String(cacheDir || "")]
}

function atomicWriteCmd(dir, name, bytes) {
  var leaf = leafName(name)
  var n = parseInt(bytes, 10)
  if (!leaf || leaf !== String(name || "") || !(n >= 0)) return ["sh", "-c", "exit 1"]
  return ["sh", "-c",
    "dir=$1; name=$2; n=$3\n"
      + "[ -d \"$dir\" ] && [ ! -L \"$dir\" ] || exit 1\n"
      + "umask 077\n"
      + "tmp=$(mktemp -p \"$dir\" .tmp.XXXXXX) || exit 1\n"
      + "trap 'rm -f \"$tmp\"' EXIT\n"
      + "head -c \"$n\" > \"$tmp\" || exit 1\n"
      + "[ \"$(wc -c < \"$tmp\")\" -eq \"$n\" ] || exit 1\n"
      + "chmod 600 -- \"$tmp\" || exit 1\n"
      + "mv -f -T -- \"$tmp\" \"$dir/$name\" || exit 1\n"
      + "trap - EXIT\n",
    "omaservarr-write", String(dir || ""), leaf, String(n)]
}

// ----- Parsing ------------------------------------------------------------

function parseJsonSafe(text, fallback) {
  try {
    var data = JSON.parse(String(text || ""))
    return data === null || data === undefined ? fallback : data
  } catch (e) {
    return fallback
  }
}

function num(value) {
  var n = Number(value)
  return isFinite(n) ? n : 0
}

// Server text is untrusted: one line, bounded length.
function text(value) {
  if (value === null || value === undefined) return ""
  var s = String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/^\s+|\s+$/g, "")
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + "\u2026" : s
}

function isoOrEmpty(value) {
  if (!value) return ""
  var d = new Date(String(value))
  return isNaN(d.getTime()) ? "" : d.toISOString()
}

function slug(value) {
  var s = String(value === null || value === undefined ? "" : value)
  return /^[A-Za-z0-9._~\-]{1,200}$/.test(s) ? s : ""
}

function pad2(n) {
  var v = Math.max(0, Math.floor(num(n)))
  return v < 10 ? "0" + v : String(v)
}

function episodeCode(ep) {
  if (!ep) return ""
  return "S" + pad2(ep.seasonNumber) + "E" + pad2(ep.episodeNumber)
}

function joinParts(parts, sep) {
  var out = []
  for (var i = 0; i < parts.length; i++) {
    if (parts[i]) out.push(parts[i])
  }
  return out.join(sep || " \u00b7 ")
}

function records(data) {
  if (Array.isArray(data)) return data
  return data && Array.isArray(data.records) ? data.records : []
}

function parseStatus(body) {
  var data = parseJsonSafe(body, null)
  if (!data || typeof data !== "object") return null
  var app = text(data.appName)
  var version = text(data.version)
  if (!app && !version) return null
  return { appName: app, version: version, instanceName: text(data.instanceName) }
}

// Names and web paths for whatever a queue, history or calendar record is
// about, across the three apps.
function describe(id, rec) {
  var r = rec || {}
  if (id === "sonarr") {
    var series = r.series || {}
    var ep = r.episode || (r.episodeNumber !== undefined ? r : null)
    return {
      title: text(series.title),
      subtitle: ep ? joinParts([episodeCode(ep), text(ep.title)]) : "",
      path: slug(series.titleSlug) ? "/series/" + slug(series.titleSlug) : ""
    }
  }
  if (id === "radarr") {
    var movie = r.movie || (r.tmdbId !== undefined ? r : {})
    return {
      title: text(movie.title),
      subtitle: movie.year ? String(Math.floor(num(movie.year))) : "",
      path: slug(movie.tmdbId) ? "/movie/" + slug(movie.tmdbId) : ""
    }
  }
  var artist = r.artist || {}
  var album = r.album || (r.foreignAlbumId !== undefined ? r : {})
  return {
    title: text(artist.artistName),
    subtitle: text(album.title),
    path: slug(artist.foreignArtistId) ? "/artist/" + slug(artist.foreignArtistId) : ""
  }
}

function parseQueue(id, body) {
  var data = parseJsonSafe(body, {})
  var list = records(data)
  var items = []
  for (var i = 0; i < list.length && items.length < MAX_QUEUE; i++) {
    var r = list[i]
    if (!r || typeof r !== "object") continue
    var d = describe(id, r)
    var size = num(r.size)
    var left = num(r.sizeleft)
    var tracked = String(r.trackedDownloadStatus || "").toLowerCase()
    var state = String(r.trackedDownloadState || "")
    var status = String(r.status || "")
    var problem = tracked === "warning" || tracked === "error"
      || status === "warning" || status === "failed" || state === "importBlocked"
      || state === "failedPending" || state === "failed"
    var message = text(r.errorMessage)
    if (!message && problem && Array.isArray(r.statusMessages) && r.statusMessages.length) {
      var first = r.statusMessages[0] || {}
      message = text(Array.isArray(first.messages) && first.messages.length ? first.messages[0] : first.title)
    }
    items.push({
      service: id,
      title: d.title || text(r.title) || "Unknown",
      subtitle: d.title ? d.subtitle : "",
      path: "/activity/queue",
      progress: size > 0 ? Math.max(0, Math.min(1, (size - left) / size)) : -1,
      status: status,
      state: state,
      downloading: status === "downloading",
      problem: problem,
      error: tracked === "error" || status === "failed" || state === "failed",
      message: message,
      timeleft: text(r.timeleft),
      client: text(r.downloadClient)
    })
  }
  var total = num(data && data.totalRecords)
  return { items: items, total: total > items.length ? total : items.length }
}

function parseHealth(id, body) {
  var list = parseJsonSafe(body, [])
  var items = []
  if (!Array.isArray(list)) return items
  for (var i = 0; i < list.length && items.length < MAX_HEALTH; i++) {
    var h = list[i]
    if (!h || typeof h !== "object") continue
    var type = String(h.type || "").toLowerCase()
    if (type === "ok") continue
    var wiki = typeof h.wikiUrl === "string" ? h.wikiUrl
      : (h.wikiUrl && typeof h.wikiUrl.fullUri === "string" ? h.wikiUrl.fullUri : "")
    items.push({
      service: id,
      level: type === "error" ? "error" : (type === "warning" ? "warning" : "notice"),
      message: text(h.message),
      source: text(h.source),
      wikiUrl: /^https:\/\/[^\s"'\\]+$/.test(wiki) ? wiki : ""
    })
  }
  return items
}

// Radarr gives a movie three release dates. Show the first one that falls in
// the window, so a film already in cinemas lists under its digital release.
function movieRelease(movie, from, to) {
  var kinds = [["Digital", movie.digitalRelease], ["Physical", movie.physicalRelease], ["Cinemas", movie.inCinemas]]
  var best = null
  for (var i = 0; i < kinds.length; i++) {
    var iso = isoOrEmpty(kinds[i][1])
    if (!iso) continue
    var t = new Date(iso).getTime()
    if (t < from || t >= to) continue
    if (!best || t < best.time) best = { time: t, date: iso, label: kinds[i][0] }
  }
  return best
}

function parseCalendar(id, body, opts) {
  var list = parseJsonSafe(body, [])
  var items = []
  if (!Array.isArray(list)) return items
  var o = opts || {}
  var from = dayStart(o.now).getTime()
  var days = clampInt(o.calendarDays, MIN_CALENDAR_DAYS, MAX_CALENDAR_DAYS, DEFAULT_CALENDAR_DAYS)
  var to = from + days * 86400000
  for (var i = 0; i < list.length && items.length < MAX_CALENDAR; i++) {
    var r = list[i]
    if (!r || typeof r !== "object") continue
    var d = describe(id, r)
    var date = ""
    var note = ""
    var have = false
    if (id === "sonarr") {
      date = isoOrEmpty(r.airDateUtc)
      have = r.hasFile === true
    } else if (id === "radarr") {
      var rel = movieRelease(r, from, to)
      if (!rel) continue
      date = rel.date
      note = rel.label
      have = r.hasFile === true
    } else {
      date = isoOrEmpty(r.releaseDate)
      var stats = r.statistics || {}
      have = num(stats.trackCount) > 0 && num(stats.trackFileCount) >= num(stats.trackCount)
    }
    if (!date || !d.title) continue
    items.push({
      service: id,
      title: d.title,
      subtitle: joinParts([d.subtitle, note]),
      path: d.path || "/calendar",
      date: date,
      have: have
    })
  }
  return items
}

function parseRecent(id, body) {
  var list = records(parseJsonSafe(body, {}))
  var items = []
  var byDownload = {}
  for (var i = 0; i < list.length && items.length < MAX_RECENT; i++) {
    var r = list[i]
    if (!r || typeof r !== "object") continue
    var d = describe(id, r)
    var date = isoOrEmpty(r.date)
    if (!d.title || !date) continue
    // A season pack imports as one record per episode; fold them into a row.
    var key = id === "sonarr" && r.downloadId ? String(r.downloadId) + "|" + d.title : ""
    if (key && byDownload[key]) {
      byDownload[key].count += 1
      continue
    }
    var quality = r.quality && r.quality.quality ? text(r.quality.quality.name) : ""
    var item = {
      service: id, title: d.title, subtitle: d.subtitle, path: d.path || "/activity/history",
      date: date, quality: quality, count: 1
    }
    if (key) byDownload[key] = item
    items.push(item)
  }
  return items
}

function parseMissing(body) {
  var data = parseJsonSafe(body, null)
  if (!data || typeof data !== "object" || data.totalRecords === undefined) return null
  var n = Number(data.totalRecords)
  return isFinite(n) && n >= 0 ? Math.floor(n) : null
}

// Accepts both the jq-trimmed shape from requestFilter and the full objects.
function parseLibrary(id, body) {
  var list = parseJsonSafe(body, [])
  var items = []
  if (!Array.isArray(list)) return items
  for (var i = 0; i < list.length && items.length < MAX_LIBRARY; i++) {
    var r = list[i]
    if (!r || typeof r !== "object") continue
    var stats = r.statistics || {}
    var title = text(r.title || r.artistName)
    if (!title) continue
    var item = {
      service: id,
      title: title,
      year: Math.floor(num(r.year)),
      monitored: r.monitored !== false,
      size: num(r.sizeOnDisk !== undefined ? r.sizeOnDisk : stats.sizeOnDisk),
      have: 0, total: 0, path: ""
    }
    if (id === "sonarr") {
      item.have = num(r.have !== undefined ? r.have : stats.episodeFileCount)
      item.total = num(r.total !== undefined ? r.total : stats.episodeCount)
      item.path = slug(r.titleSlug) ? "/series/" + slug(r.titleSlug) : ""
    } else if (id === "radarr") {
      item.have = r.hasFile === true ? 1 : 0
      item.total = 1
      item.path = slug(r.tmdbId) ? "/movie/" + slug(r.tmdbId) : ""
    } else {
      item.have = num(r.have !== undefined ? r.have : stats.trackFileCount)
      item.total = num(r.total !== undefined ? r.total : stats.trackCount)
      item.path = slug(r.foreignArtistId) ? "/artist/" + slug(r.foreignArtistId) : ""
    }
    items.push(item)
  }
  return items
}

// ----- Per-service state --------------------------------------------------

function emptyServiceState() {
  return {
    status: "idle",       // idle | ok | unauthorized | unreachable | error
    detail: "",
    queue: [], queueTotal: 0,
    health: [], calendar: [], recent: [],
    library: [], libraryLoaded: false,
    missing: null
  }
}

function emptyState() {
  var state = {}
  for (var i = 0; i < SERVICES.length; i++) state[SERVICES[i].id] = emptyServiceState()
  return state
}

function cloneState(state, id, patch) {
  var next = {}
  for (var i = 0; i < SERVICES.length; i++) {
    var sid = SERVICES[i].id
    next[sid] = state && state[sid] ? state[sid] : emptyServiceState()
  }
  if (id && next[id]) {
    var copy = {}
    for (var k in next[id]) copy[k] = next[id][k]
    for (var p in patch) copy[p] = patch[p]
    next[id] = copy
  }
  return next
}

function applyResponse(state, id, kind, body, opts) {
  var patch = { status: "ok", detail: "" }
  if (kind === "queue") {
    var q = parseQueue(id, body)
    patch.queue = q.items
    patch.queueTotal = q.total
  } else if (kind === "health") patch.health = parseHealth(id, body)
  else if (kind === "calendar") patch.calendar = parseCalendar(id, body, opts)
  else if (kind === "recent") patch.recent = parseRecent(id, body)
  else if (kind === "missing") patch.missing = parseMissing(body)
  else if (kind === "library") {
    patch.library = parseLibrary(id, body)
    patch.libraryLoaded = true
  }
  return cloneState(state, id, patch)
}

function applyFailure(state, id, status, detail) {
  return cloneState(state, id, { status: status, detail: String(detail || "") })
}

// ----- Totals for the bar -------------------------------------------------

function summary(state, ids) {
  var out = { downloading: 0, queued: 0, problems: 0, warnings: 0, errors: 0, down: 0 }
  var list = ids || []
  for (var i = 0; i < list.length; i++) {
    var s = state && state[list[i]]
    if (!s) continue
    if (s.status === "unreachable" || s.status === "unauthorized" || s.status === "error") out.down += 1
    out.queued += s.queueTotal
    for (var q = 0; q < s.queue.length; q++) {
      if (s.queue[q].downloading) out.downloading += 1
      if (s.queue[q].problem) out.problems += 1
    }
    for (var h = 0; h < s.health.length; h++) {
      if (s.health[h].level === "error") out.errors += 1
      else if (s.health[h].level === "warning") out.warnings += 1
    }
  }
  out.level = out.down > 0 || out.errors > 0 ? "error"
    : (out.warnings > 0 || out.problems > 0 ? "warning" : "ok")
  out.issues = out.down + out.errors + out.warnings
  return out
}

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many)
}

function summaryText(sum) {
  if (!sum) return ""
  return joinParts([
    sum.downloading > 0 ? sum.downloading + " downloading" : "",
    sum.queued > sum.downloading ? (sum.queued - sum.downloading) + " waiting" : "",
    sum.down > 0 ? plural(sum.down, "service", "services") + " down" : "",
    sum.errors > 0 ? plural(sum.errors, "error", "errors") : "",
    sum.warnings > 0 ? plural(sum.warnings, "warning", "warnings") : ""
  ])
}

// ----- Formatting ---------------------------------------------------------

function formatBytes(bytes) {
  var n = num(bytes)
  if (n <= 0) return "0 B"
  var units = ["B", "KB", "MB", "GB", "TB", "PB"]
  var i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + " " + units[i]
}

// "00:12:34" or "1.02:03:04" (days.hh:mm:ss) to "12m" / "1d 2h".
function formatTimeleft(value) {
  var m = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})/.exec(String(value || ""))
  if (!m) return ""
  var days = parseInt(m[1] || "0", 10)
  var hours = parseInt(m[2], 10)
  var mins = parseInt(m[3], 10)
  if (days > 0) return days + "d " + hours + "h"
  if (hours > 0) return hours + "h " + mins + "m"
  if (mins > 0) return mins + "m"
  return "<1m"
}

var QUEUE_LABELS = {
  importPending: "Waiting to import",
  importing: "Importing",
  imported: "Imported",
  importBlocked: "Import blocked",
  failedPending: "Failed",
  failed: "Failed",
  queued: "Queued",
  paused: "Paused",
  completed: "Downloaded",
  delay: "Delayed",
  downloadClientUnavailable: "Client unavailable",
  warning: "Warning",
  downloading: "Downloading"
}

function queueLabel(item) {
  if (item.downloading) {
    var left = formatTimeleft(item.timeleft)
    var pct = item.progress >= 0 ? Math.round(item.progress * 100) + "%" : ""
    return joinParts([pct, left]) || "Downloading"
  }
  return QUEUE_LABELS[item.state] && item.state !== "downloading"
    ? QUEUE_LABELS[item.state]
    : (QUEUE_LABELS[item.status] || text(item.status) || "Queued")
}

var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function dayOffset(iso, now) {
  var t = new Date(iso)
  if (isNaN(t.getTime())) return null
  return Math.round((dayStart(t).getTime() - dayStart(now).getTime()) / 86400000)
}

function dayLabel(iso, now) {
  var t = new Date(iso)
  var off = dayOffset(iso, now)
  if (off === null) return ""
  if (off === 0) return "Today"
  if (off === 1) return "Tomorrow"
  if (off === -1) return "Yesterday"
  return WEEKDAYS[t.getDay()] + " " + t.getDate() + " " + MONTHS[t.getMonth()]
}

function clock(iso) {
  var t = new Date(iso)
  if (isNaN(t.getTime())) return ""
  return pad2(t.getHours()) + ":" + pad2(t.getMinutes())
}

function timeAgo(iso, now) {
  var t = new Date(iso)
  if (isNaN(t.getTime())) return ""
  var mins = Math.floor(((now || new Date()).getTime() - t.getTime()) / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return mins + "m ago"
  if (mins < 1440) return Math.floor(mins / 60) + "h ago"
  var days = Math.floor(mins / 1440)
  return days < 30 ? days + "d ago" : dayLabel(iso, now)
}

// ----- Rows the panel draws -----------------------------------------------
// Every tab is one flat list. A row is either { header } or
// { service, title, subtitle, right, progress, tone, path, url }.
// tone: "" | "dim" | "warn" | "error".

function row(fields) {
  return {
    header: fields.header || "",
    service: fields.service || "",
    title: fields.title || "",
    subtitle: fields.subtitle || "",
    right: fields.right || "",
    progress: fields.progress === undefined ? -1 : fields.progress,
    tone: fields.tone || "",
    path: fields.path || "",
    url: fields.url || ""
  }
}

function each(state, ids, key, fn) {
  var list = ids || []
  for (var i = 0; i < list.length; i++) {
    var s = state && state[list[i]]
    if (!s || !Array.isArray(s[key])) continue
    for (var j = 0; j < s[key].length; j++) fn(s[key][j], list[i])
  }
}

function queueRows(state, ids) {
  var items = []
  each(state, ids, "queue", function(item) { items.push(item) })
  items.sort(function(a, b) {
    if (a.problem !== b.problem) return a.problem ? -1 : 1
    if (a.downloading !== b.downloading) return a.downloading ? -1 : 1
    return b.progress - a.progress
  })
  var rows = []
  for (var i = 0; i < items.length; i++) {
    var it = items[i]
    rows.push(row({
      service: it.service,
      title: it.title,
      subtitle: it.problem && it.message ? it.message : joinParts([it.subtitle, it.client]),
      right: queueLabel(it),
      progress: it.progress,
      tone: it.error ? "error" : (it.problem ? "warn" : ""),
      path: it.path
    }))
  }
  return rows
}

function calendarRows(state, ids, now) {
  var ref = now || new Date()
  var items = []
  each(state, ids, "calendar", function(item) { items.push(item) })
  items.sort(function(a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0) })
  var rows = []
  var lastDay = ""
  for (var i = 0; i < items.length; i++) {
    var it = items[i]
    var day = dayLabel(it.date, ref)
    if (day !== lastDay) {
      rows.push(row({ header: day }))
      lastDay = day
    }
    rows.push(row({
      service: it.service,
      title: it.title,
      subtitle: it.subtitle,
      right: it.have ? "Downloaded" : (it.service === "sonarr" ? clock(it.date) : ""),
      tone: it.have ? "dim" : "",
      path: it.path
    }))
  }
  return rows
}

function recentRows(state, ids, now) {
  var ref = now || new Date()
  var items = []
  each(state, ids, "recent", function(item) { items.push(item) })
  items.sort(function(a, b) { return a.date > b.date ? -1 : (a.date < b.date ? 1 : 0) })
  var rows = []
  for (var i = 0; i < items.length && i < MAX_RECENT; i++) {
    var it = items[i]
    rows.push(row({
      service: it.service,
      title: it.title,
      subtitle: it.count > 1 ? joinParts([it.count + " episodes", it.quality]) : joinParts([it.subtitle, it.quality]),
      right: timeAgo(it.date, ref),
      path: it.path
    }))
  }
  return rows
}

function healthRows(state, ids) {
  var rows = []
  var list = ids || []
  for (var i = 0; i < list.length; i++) {
    var s = state && state[list[i]]
    if (!s) continue
    var name = serviceName(list[i])
    if (s.status === "unreachable")
      rows.push(row({ service: list[i], title: name + " is not responding", subtitle: s.detail, right: "Down", tone: "error", path: "/" }))
    else if (s.status === "unauthorized")
      rows.push(row({ service: list[i], title: name + " did not accept the API key", subtitle: "Paste a new key in settings", right: "Key", tone: "error", path: "/settings/general" }))
    else if (s.status === "error")
      rows.push(row({ service: list[i], title: name + " returned an error", subtitle: s.detail, right: "Error", tone: "error", path: "/system/status" }))
  }
  each(state, ids, "health", function(h) {
    rows.push(row({
      service: h.service,
      title: h.message || "Health check",
      subtitle: h.source,
      right: h.level === "error" ? "Error" : (h.level === "warning" ? "Warning" : "Notice"),
      tone: h.level === "error" ? "error" : (h.level === "warning" ? "warn" : ""),
      path: h.wikiUrl ? "" : "/system/status",
      url: h.wikiUrl
    }))
  })
  return rows
}

function libraryDetail(item) {
  if (item.service === "radarr") return item.have ? formatBytes(item.size) : "Missing"
  var info = serviceInfo(item.service)
  var unit = item.service === "lidarr" ? "tracks" : (info ? info.unit : "")
  return item.have + "/" + item.total + " " + unit
}

function librarySummary(state, id) {
  var s = state && state[id]
  var info = serviceInfo(id)
  if (!s || !info || !s.libraryLoaded) return ""
  var size = 0
  for (var i = 0; i < s.library.length; i++) size += s.library[i].size
  return joinParts([
    plural(s.library.length, info.itemOne, info.itemMany),
    s.missing === null ? "" : s.missing + " missing " + info.unit,
    formatBytes(size)
  ])
}

// filter: free text matched against the title. only: "" | "missing".
// service: one of ids to show that service alone; anything else shows all.
function libraryRows(state, ids, filter, only, service) {
  var needle = String(filter || "").toLowerCase().replace(/^\s+|\s+$/g, "")
  var shown = service && (ids || []).indexOf(service) !== -1 ? [service] : ids
  var items = []
  each(state, shown, "library", function(item) {
    if (needle && item.title.toLowerCase().indexOf(needle) === -1) return
    if (only === "missing" && !(item.monitored && item.have < item.total)) return
    items.push(item)
  })
  items.sort(function(a, b) {
    var x = a.title.toLowerCase(), y = b.title.toLowerCase()
    return x < y ? -1 : (x > y ? 1 : 0)
  })
  var rows = []
  var total = items.length
  for (var i = 0; i < items.length && i < MAX_LIBRARY_ROWS; i++) {
    var it = items[i]
    var incomplete = it.have < it.total
    rows.push(row({
      service: it.service,
      title: it.title,
      subtitle: joinParts([it.year > 0 ? String(it.year) : "", it.monitored ? "" : "Unmonitored"]),
      right: libraryDetail(it),
      tone: !it.monitored ? "dim" : (incomplete ? "warn" : ""),
      path: it.path
    }))
  }
  if (total > rows.length)
    rows.push(row({ header: (total - rows.length) + " more. Type to narrow the list." }))
  return rows
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PLUGIN_ID: PLUGIN_ID, SERVICES: SERVICES, FAST_KINDS: FAST_KINDS, SLOW_KINDS: SLOW_KINDS,
    DEFAULT_POLL_SECONDS: DEFAULT_POLL_SECONDS, MIN_POLL_SECONDS: MIN_POLL_SECONDS,
    MAX_POLL_SECONDS: MAX_POLL_SECONDS, DEFAULT_CALENDAR_DAYS: DEFAULT_CALENDAR_DAYS,
    MAX_TEXT: MAX_TEXT, MAX_LIBRARY_ROWS: MAX_LIBRARY_ROWS,
    serviceIds: serviceIds, serviceInfo: serviceInfo, serviceName: serviceName,
    defaultSettings: defaultSettings, normalizeSettings: normalizeSettings,
    pluginSettings: pluginSettings, settingsPayload: settingsPayload,
    normalizeBaseUrl: normalizeBaseUrl, emptyConnection: emptyConnection,
    parseConnection: parseConnection, serializeConnection: serializeConnection,
    mergeConnection: mergeConnection, isHttpUrl: isHttpUrl, isValidKey: isValidKey,
    isConfigured: isConfigured, configuredIds: configuredIds, sameConnection: sameConnection,
    apiUrl: apiUrl, requestPath: requestPath, requestFilter: requestFilter,
    headerText: headerText, headerFileName: headerFileName, fetchCmd: fetchCmd, probeCmd: probeCmd,
    splitResponse: splitResponse, utf8ByteLength: utf8ByteLength,
    ensurePrivateDirsCmd: ensurePrivateDirsCmd, atomicWriteCmd: atomicWriteCmd,
    CURL_SAFE: CURL_SAFE, PROBE_MAX_BYTES: PROBE_MAX_BYTES,
    text: text, parseStatus: parseStatus, parseQueue: parseQueue, parseHealth: parseHealth,
    parseCalendar: parseCalendar, parseRecent: parseRecent, parseMissing: parseMissing,
    parseLibrary: parseLibrary, emptyState: emptyState, applyResponse: applyResponse,
    applyFailure: applyFailure, summary: summary, summaryText: summaryText,
    formatBytes: formatBytes, formatTimeleft: formatTimeleft, queueLabel: queueLabel,
    dayLabel: dayLabel, timeAgo: timeAgo, queueRows: queueRows, calendarRows: calendarRows,
    recentRows: recentRows, healthRows: healthRows, librarySummary: librarySummary,
    libraryRows: libraryRows
  }
}
