# Roadmap

## Where we are

First working version, on GitHub since 2026-11-15, not yet released. Installs with
`omarchy plugin add`; the Omarchy menu entries were dropped. Reads Sonarr, Radarr and
Lidarr; the only write path is the `omaservarr-add` agent skill.

## Next, in order

1. Check every tab against real Sonarr, Radarr and Lidarr data and fix what the fixtures
   in `tests/` got wrong.
2. Release v0.1.0.
3. Translations: move the panel strings into `i18n/en.json`.

## Ideas, not scheduled

- Prowlarr and a download client (SABnzbd, qBittorrent) for speeds.
- Add and search from the panel instead of only from the agent skill.
- Poster art in the Upcoming and Library tabs.

## Standing constraints

- The panel and the service only read. Anything that changes a library needs an explicit
  confirmation.
- API keys stay in the mode-600 connection file and header files; never in a process
  listing, a log or the bar config.
- Text from a server is untrusted: plain text in the UI, separate arguments in commands.
