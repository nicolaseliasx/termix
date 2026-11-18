# Changelog

## 0.2.9

### Fixed

- Declare `users:impersonate`. The background pass acts as each session's owner through `ctx.asUser`, which core refused every minute: reconciliation and idle hibernation never ran from the timer, and each refusal wrote an audit row (with the SQLite backend, a rewrite of the whole database file).

## 0.2.8

### Fixed

- Accept SSH Terminal 1.2.1-ncls.5, so Sessions is not blocked once the image bundling it is promoted.

## 0.2.7

### Fixed

- Accept SSH Terminal 1.2.1-ncls.4. Sessions 0.2.6 was blocked ("requires ssh-terminal ... ncls.3, but ncls.4 is installed") once the image bundling ncls.4 was promoted. A test now checks that the dependency range includes the SSH Terminal version in this repository.

## 0.2.6

### Fixed

- Terminal TUIs such as Codex no longer repaint half-drawn frames when selecting from a menu: before each attach the plugin lets tmux forward synchronized-output markers (`terminal-features` `sync`) to the browser. It is idempotent, never blocks the attach, and does nothing on a tmux without the feature (older than 3.4).

## 0.2.5

### Changed

- The terminate question opens right under the card being ended, full width, instead of at the bottom of the panel.

## 0.2.4

### Changed

- Row actions are a three-dot menu (Open in split, Rename) plus the trash button, following the Termix menu pattern.

## 0.2.3

### Changed

- The terminate question is pinned to the bottom of the panel, full width, instead of squeezed into the row.
- The session name field shows its placeholder as an example ("e.g. codex-termix").

## 0.2.2

### Changed

- Row actions (split, rename, terminate) are always visible instead of appearing on hover, and clicking a row attaches the session.
- Host status uses a fixed green for online and red for offline, whatever the theme accent is.
- Terminating a session asks inside its row instead of in a centered dialog, including the force-remove question.
- The sidebar opens on Sessions when the shell is ready.

## 0.2.1

### Fixed

- Accept SSH Terminal 1.2.1-ncls.2 as well as 1.2.1-ncls.1 so the background output scheduling fix can be installed without disabling Sessions.

## 0.2.0

### Added

- Browser restoration of per-window tabs and splits, stable session identity, validated reconnects, and synchronized rename/termination across all session views.

## 0.1.4

### Changed

- The repository link points to nicolaseliasx/termix.

## 0.1.3

### Fixed

- Split now acts after the shell has registered the new tab, so the terminal lands in a pane.

## 0.1.1

### Fixed

- Split puts the attached terminal in a pane: it fills an empty pane, grows a split that has room, or starts a new split.

## 0.1.0

### Added

- First release: persistent tmux sessions with a rail panel, lifecycle (create, rename, terminate, force) and attach through the official SSH Terminal.
