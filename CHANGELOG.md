# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- The launcher (`omaservarr.desktop`) runs the plugin's own `bin/omaservarr` instead of `~/.local/bin/omaservarr`,
  which may belong to another program when the installer left it alone. Launchers written by earlier versions are rewritten on the next load.
  If the plugin folder's path holds characters a launcher cannot carry safely, no
  launcher is made.

## [v0.1.0] - 2026-11-18

### Fixed
- The installer no longer moves an existing `~/.local/bin/omaservarr`, `omaservarr.desktop` or agent
  skill aside to put its own link there. A path that is already taken is left as it is,
  and the plugin works without the link. The uninstaller removes only links that point
  into the plugin. Backups made by earlier versions (`*.bak.<date>`) are not touched.

### Added
- Bar widget for Sonarr, Radarr and Lidarr with the number of active downloads, and a
  colour change when a service is down or reports an error.
- Panel with Queue, Upcoming, Recent, Library and Health tabs across all three services.
  Rows open the item in the service's web UI.
- Library tab filters by title, by missing items and by service: press a service's totals
  line to show that service alone, press it again to show all.
- Settings view with an address and API key per service and a connection test.
- `omaservarr` command line tool, a launcher and five agent skills (queue, upcoming,
  library, health, add).
- Installing is one command: `omarchy plugin add https://github.com/sette7blo/omaservarr.git --enable`.
  The plugin finishes its own setup the first time it loads.

### Changed
- The agent skills are opt-in. The plugin no longer links them into `~/.claude`,
  `~/.codex`, `~/.agents` or `~/.copilot` when it loads. Settings has a button to install
  or remove them, and `install.sh --skills` and `uninstall.sh --skills` do the same. Links made by an earlier version stay
  until you remove them.
- The manifest names a Monero address for tips (`"funding": { "monero": "..." }`).

[Unreleased]: https://github.com/sette7blo/omaservarr/compare/v0.1.0...HEAD
[v0.1.0]: https://github.com/sette7blo/omaservarr/releases/tag/v0.1.0
