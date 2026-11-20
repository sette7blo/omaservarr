---
name: omaservarr-add
description: Add a TV series to Sonarr, a movie to Radarr or an artist to Lidarr and start searching for it. Trigger on "add X to sonarr", "download the show X", "get the movie X", "add the artist X", "I want to watch X".
---

# Omaservarr: add a title

Adding changes the user's library and starts downloads. Always show what
will be added and get a yes before the POST.

All requests go through the CLI. Paths are relative to the API root; the
CLI adds `/api/v3` (Sonarr, Radarr) or `/api/v1` (Lidarr). Never ask for or
print an API key.

## Steps

1. Pick the service: series -> `sonarr`, movie -> `radarr`, artist ->
   `lidarr`. If it is unclear whether a title is a show or a film, ask.

2. Look it up into a new private folder made for this one title, never a
   fixed path such as `/tmp/lookup.json`:

   ```sh
   work="$(mktemp -d)"
   omaservarr api sonarr GET '/series/lookup?term=severance' > "$work/lookup.json"
   omaservarr api radarr GET '/movie/lookup?term=dune%20part%20two' > "$work/lookup.json"
   omaservarr api lidarr GET '/artist/lookup?term=radiohead' > "$work/lookup.json"
   ```

   URL-encode the term. If several results are plausible (remakes, same
   title in different years), list title and year and ask which one.

   Then keep only the chosen result, picked by its stable id, never by its
   position in the list (`tvdbId` for Sonarr, `tmdbId` for Radarr,
   `foreignArtistId` for Lidarr):

   ```sh
   jq -e --argjson id 371980 '[.[] | select(.tvdbId == $id)] | if length == 1 then .[0] else error("no single match") end' \
     "$work/lookup.json" > "$work/chosen.json"
   jq -e --argjson id 693134 '[.[] | select(.tmdbId == $id)] | if length == 1 then .[0] else error("no single match") end' \
     "$work/lookup.json" > "$work/chosen.json"
   jq -e --arg id a74b1b7f-71a5-4011-9441-d0b5e4122711 '[.[] | select(.foreignArtistId == $id)] | if length == 1 then .[0] else error("no single match") end' \
     "$work/lookup.json" > "$work/chosen.json"
   ```

   If `jq` fails, stop and look the title up again. If the chosen object
   has `id` greater than 0 it is already in the library: say so and stop.

3. Read the choices the POST needs:

   ```sh
   omaservarr api <service> GET /rootfolder        # .[].path
   omaservarr api <service> GET /qualityprofile    # .[] | {id, name}
   omaservarr api lidarr GET /metadataprofile      # Lidarr only
   ```

   With one root folder and one profile, use them. With several, ask the
   user, or follow what they already said ("in 4K", "to the kids folder").

4. Confirm in one line, with the title and year read from
   `$work/chosen.json`, for example
   `Add Severance (2022) to Sonarr in /data/shows with profile HD-1080p and search now?`
   If the user then picks another result, go back to step 2 for it and
   confirm again.

5. POST the chosen object with these fields added:

   Sonarr, `POST /series`:

   ```json
   { "qualityProfileId": 1, "rootFolderPath": "/data/shows", "monitored": true,
     "seasonFolder": true,
     "addOptions": { "monitor": "all", "searchForMissingEpisodes": true } }
   ```

   Radarr, `POST /movie`:

   ```json
   { "qualityProfileId": 1, "rootFolderPath": "/data/movies", "monitored": true,
     "minimumAvailability": "released",
     "addOptions": { "searchForMovie": true } }
   ```

   Lidarr, `POST /artist`:

   ```json
   { "qualityProfileId": 1, "metadataProfileId": 1, "rootFolderPath": "/data/music",
     "monitored": true,
     "addOptions": { "monitor": "all", "searchForMissingAlbums": true } }
   ```

   Build the body with `jq` from `$work/chosen.json`, the object that was
   confirmed, so it is passed through intact:

   ```sh
   body="$(jq -c '. + {qualityProfileId: 1, rootFolderPath: "/data/shows",
     monitored: true, seasonFolder: true,
     addOptions: {monitor: "all", searchForMissingEpisodes: true}}' "$work/chosen.json")"
   omaservarr api sonarr POST /series "$body"
   rm -rf -- "$work"
   ```

6. Report the result: the title, where it was added, and that the search
   has started. On an error, show the message the service returned.

## Rules

- One title per confirmation. Do not add a batch on a single yes.
- Never delete or unmonitor anything from this skill.
- Sonarr `addOptions.monitor` also accepts `future`, `missing`, `existing`,
  `firstSeason`, `lastSeason`, `pilot` and `none`; use one when the user
  asks for it ("only new episodes" -> `future`).
