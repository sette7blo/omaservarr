// Run with: node --test tests/
const test = require("node:test")
const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const M = require("../Model.js")

const NOW = new Date(2026, 10, 14, 12, 0, 0)
const ALL = ["sonarr", "radarr", "lidarr"]

function at(dayOffset, hour) {
  return new Date(2026, 10, 14 + dayOffset, hour || 0, 0, 0).toISOString()
}

test("settings are clamped and read from the bar layout", () => {
  assert.deepEqual(M.normalizeSettings({ pollSeconds: 1, calendarDays: 999 }),
    { pollSeconds: M.DEFAULT_POLL_SECONDS, calendarDays: 60 })
  const cfg = { bar: { layout: { right: [{ id: M.PLUGIN_ID, pollSeconds: 120, calendarDays: 3 }] } } }
  assert.deepEqual(M.pluginSettings(cfg), { pollSeconds: 120, calendarDays: 3 })
  assert.deepEqual(M.pluginSettings(null), M.defaultSettings())
})

test("connection file round-trips and ignores junk", () => {
  assert.deepEqual(M.parseConnection("not json"), M.emptyConnection())
  const conn = M.parseConnection(JSON.stringify({
    sonarr: { baseUrl: " http://host:8989/ ", apiKey: " abc123def456 \n" },
    bogus: { baseUrl: "http://x" }
  }))
  assert.equal(conn.sonarr.baseUrl, "http://host:8989")
  assert.equal(conn.sonarr.apiKey, "abc123def456")
  assert.equal(conn.bogus, undefined)
  assert.deepEqual(M.configuredIds(conn), ["sonarr"])
  const merged = M.mergeConnection(conn, { radarr: { baseUrl: "http://host:7878", apiKey: "0123456789abcdef" } })
  assert.deepEqual(M.configuredIds(merged), ["sonarr", "radarr"])
  assert.ok(M.sameConnection(M.parseConnection(M.serializeConnection(merged)), merged))
})

test("addresses and keys that could break out of a header are rejected", () => {
  assert.ok(!M.isHttpUrl("file:///etc/passwd"))
  assert.ok(!M.isHttpUrl("http://host/\"quote"))
  assert.ok(!M.isValidKey("abc\"\nheader = evil"))
  assert.ok(!M.isValidKey("short"))
  assert.ok(M.isValidKey("0123456789abcdef0123456789abcdef"))
  assert.equal(M.headerText("ab cd\nef12"), "X-Api-Key: abcdef12\nAccept: application/json\n")
})

test("request paths use the right API root and includes", () => {
  assert.equal(M.requestPath("sonarr", "status"), "/api/v3/system/status")
  assert.equal(M.requestPath("lidarr", "health"), "/api/v1/health")
  assert.match(M.requestPath("radarr", "queue"), /^\/api\/v3\/queue\?.*includeMovie=true/)
  assert.match(M.requestPath("lidarr", "recent"), /eventType=8.*includeAlbum=true/)
  assert.match(M.requestPath("sonarr", "recent"), /eventType=3.*includeEpisode=true/)
  const cal = M.requestPath("sonarr", "calendar", { now: NOW, calendarDays: 2 })
  const q = new URLSearchParams(cal.split("?")[1])
  assert.equal(new Date(q.get("end")) - new Date(q.get("start")), 2 * 86400000)
  assert.equal(new Date(q.get("start")).getTime(), new Date(2026, 10, 14).getTime())
  assert.equal(M.requestPath("nope", "queue"), "")
  assert.equal(M.apiUrl("http://h:1/", "/api/v3/health"), "http://h:1/api/v3/health")
})

test("splitResponse separates the body from the status line", () => {
  assert.deepEqual(M.splitResponse("[1,2]\n200"), { status: 200, body: "[1,2]" })
  assert.deepEqual(M.splitResponse("a\nb\n401"), { status: 401, body: "a\nb" })
  assert.deepEqual(M.splitResponse(""), { status: 0, body: "" })
})

test("fetchCmd returns body and status, and applies the jq filter", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omaservarr-"))
  const data = path.join(dir, "data.json")
  const header = path.join(dir, "header.txt")
  fs.writeFileSync(data, JSON.stringify([{ id: 1, title: "A", extra: "x".repeat(50) }]))
  fs.writeFileSync(header, "Accept: application/json\n")
  // The real command only allows http(s); swap in file:// to run it offline.
  const cmd = M.fetchCmd(header, "file://" + data, "[.[]|{id,title}]")
  cmd[2] = cmd[2].replace("--proto '=http,https'", "--proto '=file'")
  let out
  try {
    out = execFileSync(cmd[0], cmd.slice(1), { encoding: "utf8" })
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true })
    return // curl without file:// support; nothing to check here
  }
  fs.rmSync(dir, { recursive: true, force: true })
  // file:// reports status 000, so the filter is skipped and the body is whole.
  const res = M.splitResponse(out)
  assert.equal(JSON.parse(res.body)[0].title, "A")
})

test("server text is flattened and bounded", () => {
  assert.equal(M.text("a\nb\tc"), "a b c")
  assert.equal(M.text("x".repeat(500)).length, M.MAX_TEXT)
  assert.equal(M.text(null), "")
})

test("sonarr queue: progress, labels and problems", () => {
  const body = JSON.stringify({
    totalRecords: 3,
    records: [
      { title: "release.name", status: "downloading", trackedDownloadState: "downloading", trackedDownloadStatus: "ok",
        size: 1000, sizeleft: 250, timeleft: "00:12:34", downloadClient: "SABnzbd",
        series: { title: "Severance", titleSlug: "severance" },
        episode: { seasonNumber: 2, episodeNumber: 4, title: "Woe's Hollow" } },
      { title: "blocked.release", status: "completed", trackedDownloadState: "importBlocked", trackedDownloadStatus: "warning",
        size: 500, sizeleft: 0,
        statusMessages: [{ title: "blocked.release", messages: ["Not an upgrade for existing file"] }],
        series: { title: "The Bear", titleSlug: "the-bear" },
        episode: { seasonNumber: 1, episodeNumber: 1, title: "System" } },
      { title: "Orphan.Release.1080p", status: "queued", size: 0, sizeleft: 0 }
    ]
  })
  const q = M.parseQueue("sonarr", body)
  assert.equal(q.total, 3)
  assert.equal(q.items[0].progress, 0.75)
  assert.equal(M.queueLabel(q.items[0]), "75% · 12m")
  assert.equal(q.items[1].problem, true)
  assert.equal(q.items[1].message, "Not an upgrade for existing file")
  assert.equal(q.items[2].title, "Orphan.Release.1080p")
  assert.equal(q.items[2].progress, -1)

  let state = M.applyResponse(M.emptyState(), "sonarr", "queue", body)
  const rows = M.queueRows(state, ALL)
  assert.equal(rows[0].title, "The Bear")          // problems sort first
  assert.equal(rows[0].tone, "warn")
  assert.equal(rows[0].subtitle, "Not an upgrade for existing file")
  assert.equal(rows[0].right, "Import blocked")
  assert.equal(rows[1].subtitle, "S02E04 · Woe's Hollow · SABnzbd")
  assert.equal(rows[2].right, "Queued")

  const sum = M.summary(state, ["sonarr"])
  assert.equal(sum.downloading, 1)
  assert.equal(sum.queued, 3)
  assert.equal(sum.level, "warning")
  assert.equal(M.summaryText(sum), "1 downloading · 2 waiting")
})

test("radarr and lidarr queue records are named from movie and artist", () => {
  const radarr = M.parseQueue("radarr", JSON.stringify({ records: [
    { status: "downloading", size: 10, sizeleft: 5, movie: { title: "Dune: Part Two", year: 2024, tmdbId: 693134 } }] }))
  assert.equal(radarr.items[0].title, "Dune: Part Two")
  assert.equal(radarr.items[0].subtitle, "2024")
  const lidarr = M.parseQueue("lidarr", JSON.stringify({ records: [
    { status: "paused", size: 10, sizeleft: 10, artist: { artistName: "Radiohead" }, album: { title: "Kid A" } }] }))
  assert.equal(lidarr.items[0].title, "Radiohead")
  assert.equal(lidarr.items[0].subtitle, "Kid A")
  assert.equal(M.queueLabel(lidarr.items[0]), "Paused")
})

test("health: ok entries dropped, wiki links must be https", () => {
  const items = M.parseHealth("sonarr", JSON.stringify([
    { type: "ok", message: "fine" },
    { type: "warning", source: "IndexerStatusCheck", message: "Indexers unavailable", wikiUrl: "https://wiki.servarr.com/sonarr/system#x" },
    { type: "error", message: "No download client", wikiUrl: "javascript:alert(1)" },
    { type: "notice", message: "Update available", wikiUrl: { fullUri: "https://wiki.servarr.com/y" } }
  ]))
  assert.equal(items.length, 3)
  assert.equal(items[0].wikiUrl, "https://wiki.servarr.com/sonarr/system#x")
  assert.equal(items[1].wikiUrl, "")
  assert.equal(items[2].wikiUrl, "https://wiki.servarr.com/y")
  let state = M.applyResponse(M.emptyState(), "sonarr", "health", JSON.stringify([
    { type: "error", message: "No download client" }]))
  state = M.applyFailure(state, "radarr", "unreachable", "curl exit 7")
  const sum = M.summary(state, ["sonarr", "radarr"])
  assert.equal(sum.level, "error")
  assert.equal(sum.issues, 2)
  const rows = M.healthRows(state, ["sonarr", "radarr"])
  assert.equal(rows[0].title, "Radarr is not responding")
  assert.equal(rows[1].tone, "error")
})

test("calendar: grouped by day, movies pick the release in the window", () => {
  const opts = { now: NOW, calendarDays: 7 }
  let state = M.applyResponse(M.emptyState(), "sonarr", "calendar", JSON.stringify([
    { seasonNumber: 4, episodeNumber: 3, title: "Ep", airDateUtc: at(1, 21), hasFile: false,
      series: { title: "The Bear", titleSlug: "the-bear" } },
    { seasonNumber: 1, episodeNumber: 1, title: "Aired", airDateUtc: at(0, 9), hasFile: true,
      series: { title: "Done Show", titleSlug: "done-show" } }
  ]), opts)
  state = M.applyResponse(state, "radarr", "calendar", JSON.stringify([
    { title: "Dune: Part Two", year: 2024, tmdbId: 693134, inCinemas: at(-200), digitalRelease: at(3), hasFile: false },
    { title: "Out Of Window", year: 2020, tmdbId: 1, inCinemas: at(-400) }
  ]), opts)
  state = M.applyResponse(state, "lidarr", "calendar", JSON.stringify([
    { title: "Kid A", releaseDate: at(3, 1), artist: { artistName: "Radiohead", foreignArtistId: "a74b1b7f-71a5-4011-9441-d0b5e4122711" } }
  ]), opts)
  const rows = M.calendarRows(state, ALL, NOW)
  assert.deepEqual(rows.filter(r => r.header).map(r => r.header), ["Today", "Tomorrow", "Tue 17 Nov"])
  assert.equal(rows[1].title, "Done Show")
  assert.equal(rows[1].right, "Downloaded")
  assert.equal(rows[3].right, "21:00")
  assert.equal(rows[3].path, "/series/the-bear")
  const dune = rows.find(r => r.title === "Dune: Part Two")
  assert.equal(dune.subtitle, "2024 · Digital")
  assert.equal(dune.path, "/movie/693134")
  assert.ok(!rows.some(r => r.title === "Out Of Window"))
  assert.equal(rows.find(r => r.title === "Radiohead").path, "/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711")
})

test("recent: newest first, season packs folded", () => {
  const ep = n => ({ date: at(-1, 10), downloadId: "PACK", quality: { quality: { name: "WEBDL-1080p" } },
    series: { title: "Severance", titleSlug: "severance" }, episode: { seasonNumber: 1, episodeNumber: n, title: "E" + n } })
  let state = M.applyResponse(M.emptyState(), "sonarr", "recent", JSON.stringify({ records: [ep(1), ep(2), ep(3)] }))
  state = M.applyResponse(state, "radarr", "recent", JSON.stringify({ records: [
    { date: at(0, 11), movie: { title: "Dune: Part Two", year: 2024, tmdbId: 693134 }, quality: { quality: { name: "Bluray-2160p" } } }] }))
  const rows = M.recentRows(state, ALL, NOW)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].title, "Dune: Part Two")
  assert.equal(rows[0].right, "1h ago")
  assert.equal(rows[1].subtitle, "3 episodes · WEBDL-1080p")
  assert.equal(rows[1].right, "1d ago")
})

test("library: trimmed and full shapes, filter, missing, summary", () => {
  const trimmed = JSON.stringify([
    { id: 1, title: "Severance", year: 2022, titleSlug: "severance", monitored: true, sizeOnDisk: 2147483648, have: 19, total: 19 },
    { id: 2, title: "The Bear", year: 2022, titleSlug: "the-bear", monitored: true, sizeOnDisk: 1073741824, have: 8, total: 28 }
  ])
  const full = JSON.stringify([
    { id: 2, title: "The Bear", year: 2022, titleSlug: "the-bear", monitored: true,
      statistics: { sizeOnDisk: 1073741824, episodeFileCount: 8, episodeCount: 28 } }
  ])
  assert.deepEqual(M.parseLibrary("sonarr", full)[0], M.parseLibrary("sonarr", trimmed)[1])

  let state = M.applyResponse(M.emptyState(), "sonarr", "library", trimmed)
  state = M.applyResponse(state, "sonarr", "missing", JSON.stringify({ totalRecords: 20, records: [] }))
  state = M.applyResponse(state, "radarr", "library", JSON.stringify([
    { id: 5, title: "Arrival", year: 2016, tmdbId: 329865, monitored: true, hasFile: false, sizeOnDisk: 0 },
    { id: 6, title: "Dune", year: 2021, tmdbId: 438631, monitored: false, hasFile: true, sizeOnDisk: 5368709120 }
  ]))
  assert.equal(M.librarySummary(state, "sonarr"), "2 series · 20 missing episodes · 3.0 GB")
  assert.equal(M.librarySummary(state, "radarr"), "2 movies · 5.0 GB")
  assert.equal(M.librarySummary(state, "lidarr"), "")

  const all = M.libraryRows(state, ALL, "", "")
  assert.deepEqual(all.map(r => r.title), ["Arrival", "Dune", "Severance", "The Bear"])
  assert.equal(all[0].right, "Missing")
  assert.equal(all[1].tone, "dim")
  assert.equal(all[3].right, "8/28 episodes")
  assert.deepEqual(M.libraryRows(state, ALL, "  BEAR ", "").map(r => r.title), ["The Bear"])
  assert.deepEqual(M.libraryRows(state, ALL, "", "missing").map(r => r.title), ["Arrival", "The Bear"])
  assert.deepEqual(M.libraryRows(state, ALL, "", "", "radarr").map(r => r.title), ["Arrival", "Dune"])
  assert.deepEqual(M.libraryRows(state, ALL, "", "missing", "sonarr").map(r => r.title), ["The Bear"])
  assert.deepEqual(M.libraryRows(state, ALL, "", "", "lidarr"), [])
  assert.equal(M.libraryRows(state, ["sonarr"], "", "", "radarr").length, 2)   // not configured: ignored
  assert.equal(M.libraryRows(state, ALL, "", "", "nope").length, 4)
})

test("library rows are capped with a note", () => {
  const many = []
  for (let i = 0; i < M.MAX_LIBRARY_ROWS + 25; i++) many.push({ id: i, title: "Movie " + String(i).padStart(4, "0"), tmdbId: i + 1, hasFile: true })
  const state = M.applyResponse(M.emptyState(), "radarr", "library", JSON.stringify(many))
  const rows = M.libraryRows(state, ALL, "", "")
  assert.equal(rows.length, M.MAX_LIBRARY_ROWS + 1)
  assert.match(rows[rows.length - 1].header, /^25 more/)
})

test("markup and hostile values from a server stay inert", () => {
  const body = JSON.stringify({ records: [{
    status: "downloading", size: 10, sizeleft: 1,
    series: { title: "<img src=x onerror=1>", titleSlug: "../../etc/passwd; rm -rf ~" },
    episode: { seasonNumber: "x", episodeNumber: null, title: "$(reboot)" } }] })
  const state = M.applyResponse(M.emptyState(), "sonarr", "queue", body)
  const row = M.queueRows(state, ALL)[0]
  assert.equal(row.title, "<img src=x onerror=1>")   // shown as plain text by RowItem
  assert.equal(row.path, "/activity/queue")
  const cal = M.parseCalendar("sonarr", JSON.stringify([{ airDateUtc: at(1), title: "t",
    series: { title: "Show", titleSlug: "a b;c" } }]), { now: NOW, calendarDays: 7 })
  assert.equal(cal[0].path, "/calendar")             // unsafe slug falls back
  assert.deepEqual(M.parseQueue("sonarr", "<html>502</html>"), { items: [], total: 0 })
  assert.deepEqual(M.parseHealth("sonarr", "{}"), [])
  assert.equal(M.parseMissing("nope"), null)
})

test("formatters", () => {
  assert.equal(M.formatBytes(0), "0 B")
  assert.equal(M.formatBytes(1536), "1.5 KB")
  assert.equal(M.formatBytes(5368709120), "5.0 GB")
  assert.equal(M.formatTimeleft("00:00:20"), "<1m")
  assert.equal(M.formatTimeleft("02:05:00"), "2h 5m")
  assert.equal(M.formatTimeleft("1.03:00:00"), "1d 3h")
  assert.equal(M.formatTimeleft(""), "")
  assert.equal(M.dayLabel(at(0, 23), NOW), "Today")
  assert.equal(M.dayLabel(at(-1, 1), NOW), "Yesterday")
  assert.equal(M.timeAgo(at(0, 11), NOW), "1h ago")
})

test("probe status: app name and version", () => {
  assert.deepEqual(M.parseStatus(JSON.stringify({ appName: "Sonarr", version: "4.0.9.2244", instanceName: "Sonarr" })),
    { appName: "Sonarr", version: "4.0.9.2244", instanceName: "Sonarr" })
  assert.equal(M.parseStatus("<html>"), null)
  assert.equal(M.parseStatus("{}"), null)
})
