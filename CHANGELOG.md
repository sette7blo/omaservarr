# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/sette7blo/omaservarr/commits/main
