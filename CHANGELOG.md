# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [v0.1.3] - 2026-11-20

### Fixed
- Every request that carries an API key (panel, Test connection, command line) ignores
  `~/.curlrc` and refuses redirects, so the key is only ever sent to the saved address.
- After Save, polling waits until every service's key file was written. If one write fails,
  polling stays stopped instead of sending an older key to a new address.
- Test connection stops after 64 KB of answer and reports an address that answers with far
  more, or that redirects elsewhere.
- A Test connection answer is dropped when the address or key was changed while it ran,
  so it can no longer mark the changed values as connected.
- The library filter's text input exists only while the panel shows it, so a closed panel
  no longer reads clipboard offers from other apps.
- The optional add-title skill keeps its lookup in a private folder per title and adds the
  exact result the user confirmed, picked by its id, rather than the first result.

## [v0.1.2] - 2026-11-18

### Changed
- The screenshot is now `preview.png` at the top of the repository, so the plugin
  marketplace shows it, and the manifest description lists what the panel does.

## [v0.1.1] - 2026-11-18

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

[Unreleased]: https://github.com/sette7blo/omaservarr/compare/v0.1.3...HEAD
[v0.1.3]: https://github.com/sette7blo/omaservarr/compare/v0.1.2...v0.1.3
[v0.1.2]: https://github.com/sette7blo/omaservarr/compare/v0.1.1...v0.1.2
[v0.1.1]: https://github.com/sette7blo/omaservarr/compare/v0.1.0...v0.1.1
[v0.1.0]: https://github.com/sette7blo/omaservarr/releases/tag/v0.1.0
