# Fork Handover Log

Contract between agents: every task appends an entry here (date, phase, task, what
was done, files touched, how to revert). Keep it current at the end of EACH task.

## Approved decisions (fixed, decided by the user)

1. Fork is **web-server-only**: Electron/desktop, remote-sync, local-terminal and
   API keys will be REMOVED in future phases (not yet).
2. API keys (`tmx_`) + `/host/enroll`: remove in a future phase.
3. i18n: reduce to `en` only in a future phase.
4. Persistent Sessions: attach via PTY per device, viewers with `tmux attach -r`,
   no control-mode (future phase).
5. Local commits authorized (one per task/group, repo-style messages).
   `git push` and any GitHub remote writes are FORBIDDEN.

## Prior analysis (summary)

Full-codebase analysis was performed before execution #1 (see plan
`20260825-193738-termix-fork-phase0-1`). In short: Termix upstream v2.7.1 is a
Vite+React+TS frontend (`src/ui`, `src/main.tsx`) with a Node/Express backend
(`src/backend`, compiled by tsc to `dist/`), SQLite storage, and Docker deploy
(`docker/`). The fork keeps the web server only; all optional features are being
gated behind build-time (frontend) and boot-time (backend) feature flags before
any removal. Key references:

- Backend route mounting: `src/backend/database/database.ts:1742-1768`
  (`app.use` block; snippets 1748, automations 1763, audit 1765).
- Service startup: `src/backend/starter.ts:298-305` (file-manager/docker imports)
  and `:319-338` (guacamole conditional pattern, automation scheduler).
- Command history routes: `src/backend/database/routes/terminal.ts:358-640`
  (POST /command_history 358, GET /:hostId 470, POST /delete 533, DELETE /:hostId 592).
- Wake-on-LAN route: `src/backend/database/routes/host-network-routes.ts:94`
  (`POST /db/host/:id/wake`).
- Lazy panels: `src/ui/AppShell.tsx:47-130`; fullscreen apps: `src/main.tsx:24-80`;
  rail navigation: `src/ui/sidebar/rail-items.ts`.
- Tab surfaces (file-manager/docker in tabs): `src/ui/shell/tabUtils.tsx:70-79,167-171,494-527`.
- Homepage widgets statically importing feature UIs:
  `src/ui/features/homepage/HomepageCanvas.tsx:49-50` (FileManagerWidget,
  DockerWidget).
- Terminal WS :30002 (nginx `/ssh/websocket/`), session-manager singleton,
  detach-timeout 30 min, MAX_SESSIONS_PER_USER=10 silent evict.
- tmux-monitor REST :30010 with SSH pool (3 conns/host, idle 10 min).
- Alerts = automations engine (scheduler 15 s); legacy alert-engine.ts inactive.
- Proxmox: SSH+pvesh, no VM actions yet. Tailscale: single list-devices endpoint.
- Auth core to preserve: AuthManager, SystemCrypto/DEK, TOTP, passkeys,
  users.ts setup-required/create.

Roadmap for later phases (do NOT execute now): P2 persistent sessions, P3 UI
sessions/machines, P4 removals (guacamole, serial, termix-id, LDAP, vault,
acme-ssl, homepage/widgets, network-graph, AI, fleets, opkssh, port-knock,
session-sharing, firewall/pkg/cron manager UI), P5 auth slim, P6 UI 5 items,
P7 dep cleanup, P8 hardening/tests.

---

## Entries

### 2026-08-25 — Phase 0 / T0.1 — Baseline commit

- What: created branch `fork/baseline` from `main`; committed the user's local
  uncommitted changes (theme, SSL SAN-for-IP entrypoint, manifest, index.html,
  `docker/docker-compose.local.yml`) as `d5944a0`.
- Files: 18 modified theme/SSL/manifest files + `docker/docker-compose.local.yml`
  (see commit). `.opencode/` and `.codex/` intentionally NOT committed (local
  agent config).
- Deviation: plan message `fork: ...` was rejected by commitlint (type-enum);
  used `chore(fork): ...` instead. Also, the worktree contained feature-flag WIP
  from an earlier uncommitted attempt (created ~16:37, before this plan):
  `src/shared/features.ts`, `src/ui/lib/build-features.ts`,
  `scripts/features.test.ts`, `scripts/validate-feature-profile.ts` + diffs in
  `package.json`, `vite.config.ts`, `src/backend/starter.ts`, `tsconfig.*.json`.
  Those were NOT part of the user theme baseline and were left out of this commit;
  they are absorbed into the T1.1/T1.2 flag commits instead (nothing was reverted).
- Revert: `git rebase --onto main` / drop commit `d5944a0` on `fork/baseline`.

### 2026-08-25 — Phase 0 / T0.2 — Deploy docs + this log

- What: created `docs/fork/DEPLOY.md` (compose local profile, guacd 1.6.0, ports
  8080/8443, ENABLE_SSL=true, SSL_DOMAIN set locally, ALLOW_REGISTRATION=false,
  PUID/PGID 1001, termix-data volume, entrypoint SAN-IP diff, self-signed HTTPS
  LAN note, future Tailscale) and `docs/fork/LOG.md` (this handover log).
- Files: `docs/fork/DEPLOY.md`, `docs/fork/LOG.md`.
- Revert: delete both files (commit `docs(fork): add fork deploy notes and agent handover log`).

### 2026-08-25 — Phase 1 / T1.1 — Frontend build-time feature flags

- What: introduced build-time feature flags (all default false) for
  `sftp, docker, split_terminal, history, snippets, macros, automations_panel,
wake_on_lan, advanced_audit`. Flags are injected by Vite `define` as
  `__TERMIX_FEATURES__` (from `VITE_FEATURE_<ID>=true/false` env vars, or
  `TERMIX_BUILD_PROFILE=full`), and consumed via `src/ui/lib/features.ts`
  (`FEATURES`, `isFeatureEnabled`). Guards are module-level
  (`FEATURES.x === true ? lazy(...) : null`) so disabled lazy imports are
  tree-shaken (verified: optional chunks absent from default bundle).
- Guards added:
  - `rail-items.ts`: new `FEATURE_RAIL_ITEMS` filter (snippets/macros/history/
    split-screen/workspaces/automations); derived ID lists + visibleRailItems use it.
  - `AppShell.tsx`: lazy panels SnippetsPanel/MacrosPanel/HistoryPanel/
    AutomationsPanel/SplitScreenPanel/WorkspacesPanel conditional; render sites
    null-guarded; split-tab restore in applyWorkspace gated by split_terminal.
    SessionLogsPanel/AlertsPanel untouched (core).
  - `main.tsx`: FileManagerApp→sftp, DockerApp→docker (fullscreen apps).
  - `CommandPalette.tsx`: navigation list uses FEATURE_RAIL_ITEMS; host file/docker
    actions, snippet fetch/group, and file_manager/docker recent-activity entries gated.
  - `tabUtils.tsx`: FileManager/DockerManager lazy + preloaders + tab render gated
    (EmptyState fallback).
  - `Tab.tsx`: terminal-toolbar file-manager button gated (sftp).
  - `HostItem.tsx`: files/docker tab actions, copy-URL menu entries (sftp/docker),
    Wake-on-LAN tray button (wake_on_lan).
  - `HomepageCanvas.tsx`: FileManagerWidget/DockerWidget now feature-gated dynamic
    imports with a registry re-render tick (avoids statically pulling SFTP/Docker UI
    into the homepage chunk).
  - `AdminSettingsPanel.tsx`: AdminAuditLogSection render gated (advanced_audit).
- Absorbed prior uncommitted flag WIP (see T0.1 deviation): `src/shared/features.ts`
  (env-name list, renamed FEATURE_AUTOMATIONS→FEATURE_AUTOMATIONS_PANEL per plan),
  `src/ui/lib/build-features.ts` (now a shim over `@/lib/features`),
  `scripts/features.test.ts`, `scripts/validate-feature-profile.ts`, package.json
  feature scripts, tsconfig `src/shared` includes, `vite.config.ts` define
  (reworked to the plan convention: VITE_FEATURE_* per-flag envs; profile full).
- Validation: `npm run type-check` passed (needed
  `NODE_OPTIONS=--max-old-space-size=1400` on the 2GB host; plain run OOMs).
  Bundle evidence recorded after full build in the Validation section below.
- Revert: revert commit `feat(fork): build-time feature flags for optional frontend features`.

### 2026-08-26 — Phase 1 / T1.2 — Backend boot-time feature flags

- What: added default-off `FEATURE_*` guards for snippets, command-history,
  advanced-audit, automations CRUD, Wake-on-LAN, SFTP and Docker services.
- Files: `src/backend/utils/features.ts`, `database.ts`, `terminal.ts`,
  `host-network-routes.ts`, and `starter.ts`.
- Revert: remove these guarded registrations/imports; no schema or data migration ran.

### 2026-08-26 — Phase 1 / T1.3 — Manager inventory

- What: documented the Firewall/Package/Cron manager UI, routes, dependencies, and
  Phase 4 removal verdict; no manager code changed.

## Validation — 2026-08-26

- `NODE_OPTIONS=--max-old-space-size=1400 npm run type-check`: passed.
- `npm run build:backend` with a 1536 MB heap: passed; output is
  `dist/backend/backend/starter.js` (not the path stated in the plan).
- Full Vite build completed, but optional chunks were still emitted (`FileManager`,
  `DockerManager`, `SnippetsPanel`, `MacrosPanel`, `AutomationsPanel`, and others).
  The T1.1 static-guard/tree-shaking acceptance criterion therefore remains unmet.
- Smoke boot and `npx vitest run src/ui/tests` are blocked before application tests by
  the host dependency/runtime error `webidl.util.markAsUncloneable is not a function`
  from `undici` under Node v20.19.2. The host lacks `curl`, so HTTP endpoint checks

### 2026-08-26 — Phase 1 closeout

- Test corrections: `rail-items.test.ts` now asserts the default-off feature
  contract (core rail destinations remain, optional snippets/macros/history/
  automations/split-screen/workspaces are absent, and derived lists stay
  consistent). `HostItem.test.tsx` likewise expects Wake-on-LAN to be absent by
  default and uses the core Tunnel action rather than optional SFTP Files.
- Node 24.19.0 Docker validation (worktree mounted as UID/GID 1001): targeted
  rail test passed (16/16); corrected HostItem test passed (15/15). The affected
  shell/sidebar run passed after those stale default-on expectations were fixed;
  it emitted existing React `act(...)` warnings only.
- Backend build used Node 24 with `NODE_OPTIONS=--max-old-space-size=1536` and
  produced `dist/backend/backend/starter.js`.
- Isolated backend smoke used container `termix-phase1-smoke`, Node 24,
  read-only worktree mount, `DATA_DIR=/tmp/termix-phase1-smoke-data`, host port
  `18091` mapped to the actual hard-coded backend port `30001`, and every
  `FEATURE_*` value explicitly `false`. `GET /users/setup-required` returned
  `200 {"setup_required":true}`. `GET /snippets` returned `401` before route
  resolution because global auth covers the `/snippets` path (see
  `src/backend/utils/auth-manager.ts`); this is the documented permitted
  alternative to 404. Startup had no disabled SFTP/Docker/optional-service
  errors. The smoke container was removed; production `termix` remained healthy.
- Bundle evidence: prior Node 24 builds established that the core profile omits
  named optional chunks, snippets-only restores `SnippetsPanel-*.js`, and the
  final `dist/` was restored to the core build. The executor intentionally made
  no commit, push, staging action, or production-container change.
- Manual local commits suggested: `test(fork): align default-off feature tests`;
  `feat(fork): gate optional backend services and routes`; and
  `docs(fork): add Phase 1 manager inventory and closeout evidence`.
- Revert: revert the three Phase 1 changesets, or locally restore the two test
  files plus backend feature guards; no migration or production data changed.

# Phase 2 Batch 1 (persistent session foundation)

- Added additive, idempotent SQLite runtime tables and canonical/generated Drizzle schemas for persistent session metadata and redacted lifecycle events.
- Added the owner-scoped persistence repository and safe tmux working-directory validation (`/`, `~`, and `~/…` only).
- Schema generation/check and Node 24 type-check were run without using production data. WebSocket attachment, scheduled reconciliation/expiry, lifecycle gateway, REST resources, and UI remain Batch 2/3 work.
- Revert guidance: disable the future consumers first; the additive tables can remain until a separately approved, backed-up forward migration removes them.

### 2026-08-26 — Phase 2 / Task 001 — Persistent session lifecycle REST

- Added the pooled SSH lifecycle gateway, typed redacted public errors,
  owner-scoped lifecycle service, and authenticated `/api/v1` REST resources.
- Create/adopt confirm remote markers before persistence; rename/kill require a
  matching marker and kill verifies removal. Refresh is non-destructive on an
  unavailable or incomplete remote listing.
- Files: persistent-session route, repository additions, and
  `src/backend/hosts/sessions/{errors,gateway,lifecycle,tmux-adapter,index}.ts`.
- Revert: unmount the route and remove the lifecycle consumers; existing
  additive persistent-session tables may remain until a separate migration.

### 2026-08-26 — Phase 2 / Task 002 — Persistent session WebSocket bridges

- Added authenticated, owner-scoped persistent-session WebSocket attachment
  backed by one SSH/PTy per browser device. The first explicit writer gets a
  normal tmux attach; viewers use `tmux attach-session -r` and server-side
  input checks reject forged viewer input.
- Takeover destroys the old writer PTY before promoting the requester, then
  reconnects the former writer as a viewer. WebSocket close, detach and
  backend WebSocket shutdown only close local SSH/PTy bridges; none invoke a
  tmux lifecycle kill.
- Added future-tab metadata and focused fake-SSH coverage for writer conflict,
  viewer input, takeover, resize and non-destructive detach.
- Revert: remove the persistent attachment manager and the terminal protocol
  branches; remote tmux sessions are unaffected by this integration.

### 2026-08-26 — Phase 2 / Task 003 — Reconciliation and expiry

- Added delayed startup reconciliation (60s, concurrency four, no overlap) and
  minute-based idle expiry with in-process claims, DB/tmux rechecks, attached
  postponement, guarded marker verification and thirty-day DB retention.
- Reconciliation treats SSH failure as offline, recovers marker-only sessions,
  reports unmarked sessions as discovered, and never issues a tmux kill.
- Shutdown stops maintenance timers before database persistence. Production was
  not started or changed during this task.

### 2026-08-26 — Phase 2 / Task 004 — Sessions-first UI

- Added the core Sessions rail destination as the authenticated default on desktop and mobile.
- Added the persistent-session API client and responsive panel for create, attach, view, takeover, rename, adopt, refresh and guarded remote termination.
- Persistent terminal tabs now carry the session id, stable client id, role and takeover intent. Closing a tab remains a local WebSocket detach and never calls the lifecycle DELETE endpoint.
- Production was not changed during this task.

### 2026-08-26 — Phase 2 / Task 005 — Validated deployment

- Node 24.19.0 isolated validation passed: schema check, type-check, targeted
  persistent-session backend tests (19 tests), affected UI tests, core build,
  lint, and `git diff --check`. A type-only React import in `SessionsPanel` was
  corrected during validation.
- Fixed Docker feature-argument propagation (`FEATURE_*` to the Vite
  `VITE_FEATURE_*` names), excluded agent state/backups/core dumps from the
  Docker context, and proxied authenticated `/api/v1/` resources through both
  HTTP and HTTPS Nginx templates.
- Recovery point: `/home/admin/termix/backups/termix-data-20260826-120038.tar.gz`
  (verified with `tar -tzf`, `admin:admin`, mode 0640); rollback image:
  `docker-termix:rollback-20260826-120038`
  (`sha256:a1af1b51783760e7b951dfc1a1ff1014a3445c195eb08eedcc2a68df650d9457`).
- Candidate image was smoke-tested with a fresh temporary data directory, twice
  through additive migration/startup, health/UI assets, and unauthenticated REST
  rejection. Production then deployed image
  `sha256:9710c965be0d06841eba64f2f958ea14cdbdf158ee57652d270548e7edecb607`
  without volume recreation. Health, HTTPS/UI, published 8080/8443, and the
  public `/api/v1/persistent-sessions` auth boundary passed.
- Rollback: `docker tag docker-termix:rollback-20260826-120038 docker-termix:latest && docker compose -f docker/docker-compose.local.yml up -d --no-build termix`.

### 2026-08-26 — Sessions layout and global reconciliation deploy

- Shipped the Sessions UI simplification: square Termix-ID-style cards, a
  green writer Attach action with tab reuse, a larger terminal navigation icon,
  and no View/Take control controls in this panel.
- Shipped user-scoped global reconciliation with four-host concurrency,
  immediate maintenance startup, automatic verified adoption of unmarked tmux
  sessions, and per-host offline status for Sessions.
- Node 24 validation passed schema check, type-check, lint, formatting, core
  build, and 26 affected backend/UI/API tests. A fresh-data candidate passed
  health, UI asset, and unauthenticated API checks before production rollout.
- Recovery point: `/home/admin/termix/backups/termix-data-20260826-174225.tar.gz`
  (SHA-256 `b64364044e94a320b1b84d4eea14275101d5cc696d26a559c4b4489d6e911e86`);
  rollback image: `docker-termix:rollback-20260826-174225`.
- Production now runs image
  `sha256:5591d09ae9b8981bd2c16c66a280a9755c820b8308995e5ac96e46868c5ed19e`.
  Docker health, backend health, HTTP, HTTPS, Sessions asset discovery, and
  the `/api/v1/persistent-sessions` authentication boundary all passed.

### 2026-09-01 — Sessions split and terminal UX deploy

- Added Sessions split attach, Shift+Enter multiline terminal input, reliable
  selection copying, a compact expandable application rail, eager shell state
  persistence without a browser leave prompt, and `devhub (default)` host
  preselection.
- Node 24 type-check, ESLint, diff checks, and the production Docker build
  passed. The focused UI run passed 78 tests; one pre-existing Radix
  AlertDialog/JSDOM accessibility test remained failing and was reproduced on
  the baseline implementation.
- Recovery point: `/home/admin/termix/backups/termix-data-20260901-140719.tar.gz`
  (SHA-256 `f24f36f56867122a44112b3817d69b7cbdc7c46dd5d86157c71e008fbdfa5365`);
  rollback image: `termix:rollback-20260901-140719`.
- Candidate `sha256:fdf8356fbe81e240a6d75d0873d29dbc2da3ba04398b8f822b17c2565ce1a019`
  passed isolated smoke tests and now runs healthy in production with the
  original `termix-data` volume. Local HTTPS, backend health, Sessions/Split
  assets and the unauthenticated `401` boundary passed; public DNS resolution
  was unavailable from the deployment host during validation.

### 2026-10-02 — Idle-hibernation fixes: standby UX, force removal, freeze healing

- Shipped the idle-hibernation follow-up (the 2026-09-22 deploy froze panes but
  the UI never showed it and deletion was impossible for dead hosts):
  - Sessions cards now show `standby · frozen Xh · up Yd` (with a snowflake)
    instead of an ever-ticking `HH:MM:SS` runtime clock; ages are coarse
    (m/h/d/w) so nothing counts seconds forever.
  - `DELETE /api/v1/persistent-sessions/:id?force=true` plus a "Force remove"
    action in the terminate dialog (appears after an unreachable-host failure):
    ends the local record best-effort when the SSH host is gone or the marker
    mismatched, never killing a remote session the record no longer owns.
  - Reconciler heals stale hibernation: quick attach+detach between passes
    cleared nothing before (row stayed "frozen" while panes ran, and was never
    re-frozen). Recent activity now clears the flag; prolonged idle re-asserts
    the SIGSTOP idempotently.
  - Freeze/thaw sweep now signals every process group in each pane leader's
    session, so interactive jobs (own pgids) stop too, not just the shell.
  - `vitest.setup.ts` registers jest-dom matchers globally; previously only
    tests lucky enough to share a worker with `TerminalToolbar.test.tsx` had
    them (isolated runs failed with `Invalid Chai property`).
- Validation on Node 24 (docker `node:24-bookworm`; host node is 20 and the
  `/usr/local/bin/node` nvm symlink is dangling — see `codex.bak` links):
  `tsc -b --force`, targeted ESLint, Prettier, and the affected suites
  (lifecycle, reconciler, tmux-adapter, SessionsPanel, persistent-sessions-api,
  attachment-manager, tab cache). Two failures are pre-existing and reproduce
  on the pristine HEAD: the Radix AlertDialog/JSDOM dialog-name flake and the
  attachment-manager lease-race test.
- Recovery point: `/home/admin/termix/backups/termix-data-20261002-025154.tar.gz`
  (SHA-256 `5f5c8c5796155458f0223ce6dab49f4ff6cadecd4e4ea3eba88d7bfe995f793a`,
  verified with `tar -tzf`); rollback image: `termix:rollback-20261002-025154`
  (`sha256:872cd2e156c2c4b014f4b7da1efb66f6ea2458d798636b7dce337eefacaa7abd`).
- Candidate `sha256:6fe69965f82b88990d1cc04abbd39e50b82761b5adc166e1ed7b4ed35422e072`
  passed the isolated smoke run (healthy, HTTPS 200, unauthenticated API 401,
  new code present in the image, no fatals) and now runs in production with the
  original `termix-data` volume. Production verification after promotion:
  container healthy, loopback HTTPS 200, `401` auth boundary, public
  `https://termix.ncls.cc` 200, clean startup logs.

### 2026-10-02 — Upstream 2.8.0 integration, conflict fix and performance

- Production upgraded from the fork baseline to upstream 2.8.0 (`fef8a5f`)
  with the persistent-session module, split terminal, custom build flags and
  local fork changes retained. Integration worktree: `/home/admin/termix-upgrade-28`
  (branch `merge-28`; merge intentionally uncommitted pending review).
- Fixed `409 Conflict` on markerless tmux sessions: after guarded termination
  fails, Force remove is offered for all errors; for a remote session with no
  owner marker it kills by name and ends the local row. A session with a
  foreign marker is never killed remotely. This prevents a removed card from
  being immediately re-adopted by the reconciler.
- Both `/favicon.svg` and `/favicon.ico` now contain the current Termix logo,
  with a cache-busting link in `index.html` for browser tabs and bookmarks.
  The public unversioned `/favicon.svg` is still cached by Cloudflare for up to
  30 days; the versioned link and public `/favicon.ico` serve the new logo.
- Root filesystem was 100% full (290 MB available). Reclaimed ~59 GB of
  disposable Docker build cache, leaving ~47 GB free before rebuilding.
  Termix was using ~255–376 MB RAM and ~1–2% CPU; one local tmux session was
  visible. The disk pressure was the strongest measured contributor to the
  progressive slowdown. Added json-file log rotation (10 MB × 3) to the
  Termix compose service so verbose SSH logs cannot grow indefinitely.
- MySQL and PostgreSQL upstream migrations 0015+ were renumbered after the
  fork migration 0015, with monotonically increasing journal timestamps and
  persistent session table metadata carried into snapshots. SQLite uses the
  separate idempotent persistent session migration. Its migration was tested
  against an isolated copy of the encrypted production volume.
- Validation: TypeScript build, generated dialect schema check, targeted ESLint,
  Drizzle migration checks for MySQL and PostgreSQL,
  42 passing targeted tests (the two known baseline failures reproduced),
  Docker build, and isolated candidate startup with a copy of production data
  on `--network none` (healthy, schema migration completed, root 200, session
  API unauthenticated 401). Production after promotion: healthy, public 200,
  API 401, new favicon hash, clean migration logs.
- Pre-upgrade backup: `/home/admin/termix/backups/termix-data-20261002-221223.tar.gz`
  SHA-256 `53a979841469748cd70864aa2bfa8e9392345ca1801ea2d02a5ec8a16bf8d1ea`.
  Candidate image `sha256:2d7754fad9d3904c762a7734778b0726b2fd574a94caeb12e32e3ed9dc7f1373`.
  Rollback image: `termix:rollback-20261002-221223`; restoring the backup
  volume is required before rollback because 2.8.0 applies DB migrations.
- Upstream 2.9.0 (`307667c`) was assessed separately in
  `/home/admin/termix-upgrade-29-wip`: it moves SSH terminal and other features into
  plugins. A direct merge leaves about 100 TypeScript errors after building the
  new SDK, including the persistent session module and terminal UI. It has not
  been deployed; porting the module to the new plugin architecture remains.
