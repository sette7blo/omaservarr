---
name: omaservarr-queue
description: Show what Sonarr, Radarr and Lidarr are downloading or importing right now. Trigger on "what's downloading", "download queue", "is it done yet", "why is this download stuck", "arr queue".
---

# Omaservarr: download queue

Report the combined download queue of the user's Sonarr, Radarr and Lidarr.

## How to read it

Run the CLI the plugin installs. It reads the addresses and API keys from
`~/.local/state/omarchy/omaservarr/credentials.json`, so never ask the user
for a key and never print one.

```sh
omaservarr queue
```

One line per item, tab-aligned: service, state, percent done, time left,
title.

For details the table leaves out (error messages, download client, release
name), read the raw queue. Paths are relative to the API root, which the CLI
adds (`/api/v3` for Sonarr and Radarr, `/api/v1` for Lidarr):

```sh
omaservarr api sonarr GET '/queue?page=1&pageSize=50&includeSeries=true&includeEpisode=true'
omaservarr api radarr GET '/queue?page=1&pageSize=50&includeMovie=true'
omaservarr api lidarr GET '/queue?page=1&pageSize=50&includeArtist=true&includeAlbum=true'
```

Fields worth reading in each record:

- `status`: `downloading`, `queued`, `paused`, `completed`, `warning`,
  `failed`, `delay`, `downloadClientUnavailable`
- `trackedDownloadState`: `downloading`, `importPending`, `importing`,
  `importBlocked`, `failedPending`, `failed`
- `trackedDownloadStatus`: `ok`, `warning`, `error`
- `size`, `sizeleft` (bytes), `timeleft` (`hh:mm:ss`)
- `errorMessage`, and `statusMessages[].messages[]` for the reason an import
  is blocked

## Rendering

Keep it short. Lead with what is actively downloading, then anything stuck:

```
Downloading
  Severance - S02E04          62%   8m left   (Sonarr)
  Dune: Part Two (2024)       12%   41m left  (Radarr)

Needs attention
  Blade Runner 2049 - import blocked: not an upgrade for existing file
```

If the queue is empty, say so in one line. If a service fails to answer,
name it and carry on with the others.

## No mutations

This skill only reads. Do not remove, retry or blocklist queue items unless
the user asks for that specific action and confirms it.
