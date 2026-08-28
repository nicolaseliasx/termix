# Persistent sessions

Phase 2 Batch 1 stores persistent tmux session lifecycle facts in `persistent_sessions` and redacted audit metadata in `persistent_session_events`. A row is owner- and host-scoped; active host/tmux names are unique. `ended_at` and `end_reason` derive terminal states, so the database never claims a session is attached based solely on stale metadata.

The runtime SQLite migration uses `CREATE TABLE/INDEX IF NOT EXISTS`; it is additive and runs at normal database startup. No production database was opened or migrated during this work.

Tmux names use the safe 64-character session-name contract. Working directories may be absolute, `~`, or `~/…`; home-relative paths expand `$HOME` while the remaining path stays shell-quoted.

The lifecycle REST API is mounted at `/api/v1`. All requests are authenticated
and data-unlock protected, and every row is selected through its owner id. The
resources are `persistent-sessions`, `persistent-session-adoptions`, and host
`persistent-session-reconciliations`. Lists return `{ data, meta }`; failures
return `{ error: { code, message, details? } }` without credentials, addresses,
or shell commands.

Remote operations use the existing resolved-host SSH credentials and connection
pool. Create and adoption write/confirm the Termix marker before writing the
local row. Rename and kill first prove the marker id; kill additionally verifies
that tmux no longer has the session. A local write failure deliberately does not
attempt a compensating remote kill. Refresh never marks rows missing until a
complete remote list succeeds, so an offline host is never destructive.

At backend readiness, maintenance starts reconciliation immediately and then
continues at a one-minute cadence. Reconciliation has at most four concurrent
hosts and never kills tmux: an unavailable host is offline, a missing session
is ended only after a successful list, marker-only sessions are recovered, and
unmarked tmux sessions are automatically adopted with a verified Termix marker.
Sessions never expire — they run until manually terminated; a startup
migration converts any legacy idle rows to manual, and ended rows/events are
kept only for 30 days before pruning. Shutdown clears all timers.

## Deployment verification

On 2026-08-26 the persistent-session build was started twice against a fresh
temporary SQLite data directory; both additive migration passes and health
checks succeeded. The production data volume was backed up before deployment,
then production was restarted on the verified image without recreating the
volume. `/api/v1/persistent-sessions` is reachable through HTTPS and returns
`401` when unauthenticated. No real remote tmux session was created, attached,
or killed by deployment smoke tests.

The later Sessions layout/reconciliation deployment passed a fresh-data
candidate smoke test and production health checks on `30001`, `8080`, and
`8443`; unavailable real hosts were reported as offline during the initial
reconciliation and no tmux session was killed.
