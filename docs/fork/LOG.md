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
  8080/8443, ENABLE_SSL=true, SSL_DOMAIN=192.168.15.4, ALLOW_REGISTRATION=false,
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
