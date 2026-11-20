# Termix (ncls) (personal fork of Termix)

This fork is upstream Termix **v26.10.6** with the explicitly approved recovery SDK extension described below, plus own plugins in `plugins/`, deploy configuration and documentation. The user's global instructions live in `~/.claude/CLAUDE.md`; these project rules take precedence.

## Main rule: module work ships as a plugin

- Any new feature or behavior change of a module (terminal, sessions, panels, tabs, integrations) **becomes a plugin**, living in `plugins/<id>/` of this repository as a standalone npm package (own `package.json` and lock, not a root workspace). `plugins/sessions` is the reference. Do not edit the core `src/` for that.
- Plugins are TypeScript on `@termix-ssh/plugin-sdk` (backend `activate(ctx)`, frontend `activate(app)`). Rust only as WebAssembly in a worker, and only for heavy work; there is none today.
- Reuse what Termix already has before writing code: the official `ssh-terminal` already pastes images (Ctrl+V, SFTP) and opens `terminal` attached to tmux with `openTab(host, "terminal", { data: { tmuxSession } })`. Pasting images into Claude/Codex running on a host builds on that.
- Install with **Install from file** of the `.tmxplug`, with Plugin developer mode on. No signing, no registry submission. When a plugin changes, bump the version in `manifest.json`, `package.json` and `CHANGELOG.md` (a section with `### Fixed/Added`).
- Change the core only if the SDK cannot do it at all, with an explicit decision from the user recorded here.

## Brand and license

- Product: **Termix** (this fork is called "Termix (ncls)"). Upstream branding, translations and identifiers are kept as shipped; do not rebrand or rename anything.
- Keep upstream translations (`src/ui/locales/`) untouched.
- **Apache 2.0:** keep `LICENSE` untouched and the original credits. Every change to an upstream file goes in `MODIFICATIONS.md` (list with `git diff --name-only v26.10.6 -- . ':!plugins'`).
- When bringing in a newer upstream version, merge it as is and run the suite.

## Plugins and state

- Which plugins are on is **database** state of each instance, not part of the image. On a new instance repeat the onboarding. Current policy: **Off**, never Remove, until a period of use; see `docs/modernizacao/04-remocao-futura-plugins-off.md`.
- On today: SSH Terminal, Proxmox (not configured), Host Status, TOTP, Workspaces, Classic Layout, Classic Themes, plus `sessions` (own plugin, in `plugins/sessions`).
- `ssh-terminal` ships in the image. Do not install another copy in `data/plugins` (it logs "update ... not newer than the bundled").

## Testing without touching production

- Run the image on an `--internal` Docker network with a **copy** of the volume (`PUID=0 PGID=0`) and a throwaway sshd/tmux (`ListenAddress` off loopback, or share the network namespace). Never point it at `termix.ncls.cc` or at real hosts.
- Browser: `playwright-core` with `/usr/bin/chromium`, in a directory outside the repository. Rail items: `button:has(span:text-is("Sessions"))`.
- Production is on LXC 101 (`192.168.15.41:8443`), image `termix:26.10.6-ncls.7` (no local rollback image or backup kept; older images are in the GitHub releases), compose `/home/admin/termix-migration/docker-compose.lxc.yml`, next to `termix-guacd`. The devhub containers remain stopped as an older rollback. Promote only with authorization, a backup taken with the service stopped, and the steps and rollback in `docs/modernizacao/PRODUCTION.md`. Run the promotion from the Proxmox node shell with `pct exec 101 -- systemd-run`, never from inside Termix; a `nohup` job inside `pct exec` dies when it returns.
- On SQLite every save rewrites the whole encrypted database file (~20 MB in production). Background or per-minute writes (telemetry, audit rows, timestamp touches) must only call `DatabaseSaveTrigger.markDirty()` (or `persist({ lazy: true })` in plugins) and join the 5-minute periodic flush; `triggerSave` still rewrites the file at most every 30 s, which kept LXC 101 writing ~117 GB/day.

## Gotchas

- tmux-resurrect must preserve `@termix_*` ownership markers as well as layout/processes. The authorized local patch and helper are documented in [power-loss recovery](./docs/modernizacao/05-boot-recovery.md). Recheck this integration after upgrading resurrect. Never recover identity solely by session name or loosen the attachment UUID check.

- `applications` is installed on the LXC 101 instance; `homepage` is off. Its read-only inventory collector runs as the devhub user service `applications-collector`, with a TLS endpoint restricted to the LXC and an admin-configured secret in Termix. Source and tests are in `plugins/applications/collector/`; deployment is `/srv/apps/applications-collector/current`. The retired app-hub backup is in `~/_releases/app-hub/retired-20261103/`. Never print or commit the collector token or private key.
- Plugins cannot read legacy core tables (`ctx.db` only sees its own tables): migrate data through an import route (`POST /plugin-api/sessions/import`), not SQL.
- `ctx.db` has no partial indexes: enforce conditional uniqueness in code.
- Timer work needs `ctx.asUser(userId, fn)`; inside a route the actor is already the caller.
- Plugin tests need the native `better-sqlite3` binary (`npm rebuild better-sqlite3`); `termix-plugin validate` rejects `$schema` and a `CHANGELOG` section without a type heading.
- `termix-plugin pack` packs the existing `dist/` and does not rebuild: run `build` first and inspect the `.tmxplug`. Builds and tests need Node 24 (`.nvmrc`).
- tmux tests: inside a tmux session `$TMUX` outranks `TMUX_TMPDIR`, so an "isolated" test server is silently the real one and `kill-server` kills the user's sessions (happened 2026-11-06). Delete `TMUX` from the child env, assert `#{socket_path}` is inside the temp dir, and only then `kill-server`.
- tmux drops DECSET 2026 (synchronized output) unless the client's `terminal-features` include `sync`; Codex wraps every frame in it, so menus repaint half-drawn in xterm.js. Sessions 0.2.6 enables it in `lifecycle.attachment` (idempotent, best effort; needs tmux >= 3.4). Verified on tmux 3.5a only; the browser effect was not measured.
- `useShell().split.handleAction` acts on a tab by id in the shell's internal state: after `openTab`, wait a moment before splitting.

## Approved recovery SDK exception (2026-11-02)

The user explicitly approved the minimum core/SDK changes for Sessions browser recovery:
pre-mount restoration, scoped layout capture/merge, live tab payload updates, and
disposable per-tab unload exemptions. Connection-confirmed close skips only the
connection prompt; other guards remain. Policy, browser cache and tmux lifecycle
stay in `plugins/sessions`; transport and clipboard work stay in the standalone
`plugins/ssh-terminal` fork. Do not add Sessions-specific rules to core.
See [recovery design and verification](./plugins/sessions/docs/recovery.md).

## Approved health monitor exception (2026-11-04)

The user explicitly authorized correcting the core database health monitor to
accept structured plugin errors without throwing or masking the original error.
This is a generic error-handling fix, not a relaxation of Sessions identity checks.
