---
name: omaservarr-health
description: Check that Sonarr, Radarr and Lidarr are up and report their health warnings (indexers, download clients, disk space, updates). Trigger on "is sonarr up", "arr health", "any problems with my media server", "why isn't anything downloading".
---

# Omaservarr: status and health

```sh
omaservarr status    # which services answer, and their versions
omaservarr health    # each service's own health checks
```

`health` prints one line per issue, tab-aligned: service, level (`error`,
`warning`, `notice`), message. A service with no issues prints `ok`.

A service missing from `status` output, or one that prints
`request failed`, is unreachable or rejected the API key. Say which, and
suggest checking the address and key in the plugin's Settings view (bar
icon, then the gear).

For more context on a single issue:

```sh
omaservarr api sonarr GET /health      # includes a wikiUrl per issue
omaservarr api sonarr GET /diskspace   # free space per mount
```

## Rendering

Errors first, then warnings. Quote the message as the service wrote it and
add one line on what it usually means when that is not obvious. If
everything is healthy, say so in one line.

## No mutations

This skill only reads. Do not restart services, change settings or test
indexers unless the user asks for that specific action.
