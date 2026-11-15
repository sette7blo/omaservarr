---
name: omaservarr-library
description: Check whether a show, movie or artist is in the user's Sonarr, Radarr or Lidarr library, how complete it is, and how much is missing overall. Trigger on "do I have X", "is X in my library", "how many episodes of X do I have", "what am I missing", "how big is my library".
---

# Omaservarr: library

All requests go through the CLI, which holds the addresses and API keys.
Paths are relative to the API root; the CLI adds `/api/v3` (Sonarr, Radarr)
or `/api/v1` (Lidarr). Never ask for or print an API key.

## Is a title in the library

```sh
omaservarr search sonarr "severance"
omaservarr search radarr "dune part two"
omaservarr search lidarr "radiohead"
```

Each result line ends with `in library` or `not added`. The lookup searches
the upstream database, so a result that says `not added` exists but is not
in the user's library.

## How complete is one title

The full lists are large. Filter them with `jq` rather than reading them
whole:

```sh
omaservarr api sonarr GET /series | jq '.[] | select(.title | test("severance"; "i"))
  | {title, year, monitored, episodes: .statistics.episodeCount,
     have: .statistics.episodeFileCount, sizeOnDisk: .statistics.sizeOnDisk}'

omaservarr api radarr GET /movie | jq '.[] | select(.title | test("dune"; "i"))
  | {title, year, monitored, hasFile, sizeOnDisk}'

omaservarr api lidarr GET /artist | jq '.[] | select(.artistName | test("radiohead"; "i"))
  | {artistName, monitored, albums: .statistics.albumCount,
     tracks: .statistics.trackCount, have: .statistics.trackFileCount}'
```

## What is missing

```sh
omaservarr missing
```

One line per service with the number of monitored items that have no file
(episodes for Sonarr, movies for Radarr, albums for Lidarr). To list them:

```sh
omaservarr api sonarr GET '/wanted/missing?page=1&pageSize=20&sortKey=airDateUtc&sortDirection=descending&includeSeries=true'
omaservarr api radarr GET '/wanted/missing?page=1&pageSize=20'
omaservarr api lidarr GET '/wanted/missing?page=1&pageSize=20&includeArtist=true'
```

## Rendering

Sizes are bytes; show them as GB. Answer the question asked: "do I have
Severance" wants one line, not a table.

## No mutations

This skill only reads. To add a title use the `omaservarr-add` skill.
