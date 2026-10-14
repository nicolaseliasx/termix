# Fork Deploy Notes

Current deployment of this fork on the LAN host (`devhub`) is Termix, exposed through
the public hostname `https://termix.ncls.cc` and protected by native authentication.

## Stack

- `docker/docker-compose.local.yml` — local compose profile:
  - `termix`: image `termix:latest`, built from `docker/Dockerfile` (repo root context),
    loopback HTTPS on port `8443`, env `ENABLE_SSL=true`,
    `SSL_DOMAIN=termix.ncls.cc`, `ALLOW_REGISTRATION=false`,
    `ENABLE_TELEMETRY=false`, `PUID/PGID=1001`, named volume `termix-data` mounted at
    `/app/data`.
  - `termix-guacd`: `guacamole/guacd:1.6.0` (RDP/VNC/Telnet backend), shares
    `termix-data` for session recordings.
- Local-only deploy: `docker compose -f docker/docker-compose.local.yml up -d --no-build`.
- LAN fallback deploy: add the ignored, machine-local
  `-f docker/docker-compose.lan.yml` override. It contains the private bind address and
  must never be committed.

## TLS / entrypoint changes (fork baseline)

`docker/entrypoint.sh` was modified so a self-signed certificate can be issued for an
IP-address domain (the LAN host has no DNS name):

- If `SSL_DOMAIN` is an IPv4 address, it is used as an `IP SAN` entry (`IP.4 = $DOMAIN`)
  instead of a `DNS SAN` entry; `localhost` stays as `DNS.1`.
- Extra SAN IPs can be added via the new `SSL_SAN_IPS` env var (comma-separated list,
  appended as `IP.5..IP.n`).

Relevant diff (see commit `chore(fork): local theme, SSL SAN for IP domain and compose baseline`):

```diff
+        IS_IPV4=false
+        if printf '%s' "$DOMAIN" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
+            IS_IPV4=true
+        fi
+        if [ "$IS_IPV4" = "true" ]; then
+            SAN_DNS_ENTRIES="DNS.1 = localhost"
+            SAN_IP_ENTRIES="IP.1 = 127.0.0.1
+IP.2 = ::1
+IP.3 = 0.0.0.0
+IP.4 = $DOMAIN"
...
+        for EXTRA_IP in $(echo "${SSL_SAN_IPS:-}" | tr ',' ' '); do
```

## Access

- Public URL: `https://termix.ncls.cc`, protected by Termix's native authentication.
  The origin is the loopback HTTPS listener through the user-level `cloudflared`
  connector; no plaintext Termix port is published. The optional LAN listener exists
  only in the ignored local override.
- See [REMOTE_ACCESS.md](REMOTE_ACCESS.md) for tunnel operations, diagnostics, backup,
  and rollback.

## Persistent-sessions deployment validation (2026-08-26)

- The web proxy explicitly forwards `/api/v1/` to the authenticated backend;
  this is required for the Sessions UI.
- Latest verified backup: `/home/admin/termix/backups/termix-data-20260826-120038.tar.gz`.
  It is a read-only-volume tar archive, verified with `tar -tzf`, owned by
  `admin:admin` and mode `0640`.
- Rollback image: `docker-termix:rollback-20260826-120038`. To roll back the
  application image without touching the data volume:

  ```sh
  docker tag docker-termix:rollback-20260826-120038 docker-termix:latest
  docker compose -f docker/docker-compose.local.yml up -d --no-build termix
  ```

- The current image passed health on `30001`, HTTPS/UI on `8443`, the Sessions
  asset check, and unauthenticated `/api/v1/persistent-sessions` returns `401`.

## Sessions layout and reconciliation deployment (2026-08-26)

- Backup: `/home/admin/termix/backups/termix-data-20260826-174225.tar.gz`
  (`sha256:b64364044e94a320b1b84d4eea14275101d5cc696d26a559c4b4489d6e911e86`,
  `admin:admin`, mode `0640`).
- Deployed image: `docker-termix:candidate-20260826-174225`
  (`sha256:5591d09ae9b8981bd2c16c66a280a9755c820b8308995e5ac96e46868c5ed19e`).
- Rollback image: `docker-termix:rollback-20260826-174225` (the image that was
  running immediately before this deploy). To roll back without altering the
  data volume:

  ```sh
  docker tag docker-termix:rollback-20260826-174225 docker-termix:latest
  docker compose -f docker/docker-compose.local.yml up -d --no-build termix
  ```

- The candidate was smoke-tested with a fresh temporary data directory; the
  production container then passed Docker health, backend health (`30001`),
  HTTP (`8080`), HTTPS (`8443`), Sessions asset discovery, and the unauthenticated
  persistent-sessions `401` boundary.

## Clean logs and sessions UX deploy (2026-08-28)

- Commit: `bb68e7f` (`feat(fork): persistent sessions, clean logs and sessions UX`),
  pushed to `origin/fork/baseline`.
- Backup: `/home/admin/termix/backups/termix-data-20260828-121715.tar.gz`
  (`sha256:f2fffed934f255541925966c1d13bc01fea6b26d3afbea3d4810ca1e451b067f`,
  `admin:admin`, mode `0640`).
- Deployed image: `docker-termix:candidate-20260828-121715`
  (`sha256:81ee88152d5221f97d1bbef3a6897e2628157ff7c1c39eb122d9ed8063d66ab4`).
- Rollback image: `docker-termix:rollback-20260828-121715` (the image that was
  running immediately before this deploy). To roll back without altering the
  data volume:

  ```sh
  docker tag docker-termix:rollback-20260828-121715 docker-termix:latest
  docker compose -f docker/docker-compose.local.yml up -d --no-build termix
  ```

- Validation: Docker health, backend health (`30001` → `{"status":"ok"}`),
  HTTP (`8080` → 301 to HTTPS), HTTPS (`8443` → 200), Sessions asset
  (`SessionsPanel-*.js` served), unauthenticated
  `/api/v1/persistent-sessions` → `401`, and startup logs confirmed emoji-free
  with plain `[LEVEL] [SERVICE]` tags.

## Persistent terminals, AI newline, and favicon deploy (2026-08-28)

- Commit: `0c3b8c5` (`feat(fork): keep persistent terminals and add chat newlines`).
- Backup: `/home/admin/termix/backups/termix-data-20260828-130446.tar.gz`
  (`sha256:4ceaf17374642a6bec9cd9ab90331aed5e92c72d1902fc87da44d7ae926ff277`,
  `root:root`, mode `0644`).
- Deployed image: `docker-termix:candidate-20260828-130446`
  (`sha256:ff854208b51703e91cf9a7099f7b199e29adeeff7b549a8a8d8c1c3d309b5657`).
- Rollback image: `docker-termix:rollback-20260828-130446`. To roll back
  without altering the data volume:

  ```sh
  docker tag docker-termix:rollback-20260828-130446 docker-termix:latest
  docker compose -f docker/docker-compose.local.yml up -d --no-build termix
  ```

- Validation: Docker health is `healthy`; backend health (`30001`) returns
  `{"status":"ok"}`; HTTPS serves `/favicon.svg` with `200`; HTTP (`8080`)
  redirects with `301`; unauthenticated `/api/v1/persistent-sessions` returns
  `401`.

## Sessions split, terminal input, and compact rail deploy (2026-09-01)

- Backup: `/home/admin/termix/backups/termix-data-20260901-140719.tar.gz`
  (`sha256:f24f36f56867122a44112b3817d69b7cbdc7c46dd5d86157c71e008fbdfa5365`,
  12,649,170 bytes, mode `0640`), created from the read-only `termix-data`
  volume and verified with `tar -tzf`.
- Deployed image: `termix:candidate-20260901-140719`
  (`sha256:fdf8356fbe81e240a6d75d0873d29dbc2da3ba04398b8f822b17c2565ce1a019`),
  built with `TERMIX_BUILD_PROFILE=custom` and
  `FEATURE_SPLIT_TERMINAL=true`.
- Rollback image: `termix:rollback-20260901-140719` (the image running
  immediately before this deploy). Roll back without changing persistent data:

  ```sh
  docker tag termix:rollback-20260901-140719 termix:latest
  docker compose -f docker/docker-compose.local.yml up -d --no-build termix
  ```

- An isolated candidate with a temporary volume passed Docker health, backend
  health, UI `200`, Sessions and SplitScreen assets, the enabled split feature,
  and unauthenticated persistent-sessions `401` before promotion.
- Production passed Docker health, backend health (`30001` → `{"status":"ok"}`),
  loopback HTTPS (`8443` → `200`), persistent-sessions auth (`401`), Sessions
  and SplitScreen asset discovery, preserved the `termix-data` mount, and had
  no startup error/fatal entries. Public validation was not available from the
  host because `termix.ncls.cc` did not resolve at deploy time.

## Session conflict and terminal performance deploy (2026-10-05)

- Backup: `backups/termix-data-20261005-before-conflict-fix.tar.gz`
  (`sha256:bcc94e380b40bdce5d95e60a14f90e0d4361062ad1383524735eb63064a10b4b`,
  41,342,394 bytes, `admin:admin`, mode `0600`), made from the read-only volume
  and verified with `tar -tzf`.
- Candidate and deployed image: `termix:candidate-20261005-conflict-fix`
  (`sha256:895ee4ad92c0439f1d5ed66c08216b0be3ecfff2f3b522a75acb21803614accb`),
  built with `TERMIX_BUILD_PROFILE=custom` and `FEATURE_SPLIT_TERMINAL=true`.
- Rollback image: `termix:rollback-20261005-conflict-fix`
  (`sha256:f8683077c1828d61332cc66a0352096e0bf91a3adba0b5c105d00b482ee887b1`).
- Isolated candidate passed Docker health, HTTPS `200`, backend health, Sessions
  and SplitScreen asset discovery, and unauthenticated Sessions API `401`.
- Production passed Docker health, backend health, public HTTPS `200`, Sessions
  API `401` without authentication, and retained the `termix-data` mount.

To roll back the application image without changing persistent data:

```sh
docker tag termix:rollback-20261005-conflict-fix termix:latest
docker compose -f docker/docker-compose.local.yml up -d --no-build termix
```

## Persistent-session mouse tracking fix (2026-10-05)

- Backup: `backups/termix-data-20261005-before-mouse-fix.tar.gz`
  (`sha256:8c3871d5e672680b47daf8a64fa132e0d7b09bed377d081a2c2e78561e9606a9`,
  41,608,986 bytes, mode `0600`), verified with `tar -tzf`.
- Deployed image: `termix:candidate-20261005-mouse-fix`
  (`sha256:db8ba39f5388c089d517fae207ccf95cf51e63f5468e15a473d8d339ee676630`),
  built with `TERMIX_BUILD_PROFILE=custom` and `FEATURE_SPLIT_TERMINAL=true`.
- Rollback image: `termix:rollback-20261005-mouse-fix`
  (`sha256:fe7f486575cb38f505a17bc9fbbd3fbd49860cf7c58ac8b1837d93fac1fc2e21`).
- Isolated candidate passed Docker health, backend health, HTTPS `200`, and unauthenticated
  Sessions API `401`. Production passed Docker health, local and public HTTPS `200`,
  local and public Sessions API `401`, and retained the `termix-data` mount.

To roll back the application image without changing persistent data:

```sh
docker tag termix:rollback-20261005-mouse-fix termix:latest
docker compose -f docker/docker-compose.local.yml up -d --no-build --force-recreate termix
```

## Sessions host availability fix (2026-10-10)

- `reachable` hosts now appear in the Sessions picker and allow create/attach;
  the SSH connection still validates credentials. The panel refreshes when a
  browser tab becomes visible after time in the background.
- Frontend-only image `termix:candidate-20261010-sessions-refresh`
  (`sha256:65b94757a43aac2f9725f74f1b79393ead24a3f9665d944db5c92096d5552e7d`)
  was built on the existing backend with the custom profile and split terminal
  enabled. All 15 Sessions panel tests passed.

## Persistent-session hibernation disabled (2026-10-10)

- The default idle hibernation limit is now `0` (disabled). This deployment also
  pins `PERSISTENT_SESSION_IDLE_HIBERNATE_HOURS=0` in Compose, so an older saved
  setting cannot turn it back on.
- Reconciliation sends `SIGCONT` to sessions previously marked hibernated and
  clears their hibernation timestamp. Attaching also resumes pane processes.
- Isolated startup passed Docker health, backend health, HTTPS `200`, and
  unauthenticated Sessions API `401`. Production passed the same checks, public
  page and new Sessions asset `200`, and retained `termix-data`.
- At the user's request, every `termix:*rollback*` and
  `docker-termix:*rollback*` image tag was removed. Earlier rollback commands in
  this document are historical and no longer work. Data backups were retained.

## Sessions host visibility regression fix (2026-10-10)

- The previous Sessions change still filtered out configured hosts when the
  status poll was empty, stale, or reported offline. The panel now always lists
  configured hosts and lets the SSH operation verify actual availability.
  Session and host requests update independently, so a session-list failure no
  longer prevents the host picker from loading.
- Frontend-only image `termix:candidate-20261010-sessions-fix`
  (`sha256:ae9437e527ab1d745103e8a2445229f179cc5ef2bd17731dd800ae18e3122666`)
  was built on the deployed backend. All 17 Sessions panel tests, targeted
  ESLint, and app TypeScript checks passed.
- Production Docker health is healthy; public page and new Sessions asset
  return `200`, unauthenticated Sessions API returns `401`, and the existing
  `termix-data` volume remains mounted. No rollback tag was created.

## Ctrl+V direct paste fix (2026-10-14)

- Plain Ctrl+V no longer reads the clipboard through
  `navigator.clipboard.read()`/`readText()`, which made Chrome open its
  clipboard picker panel on every paste. The keydown now lets the browser's
  native paste event fire; the existing capture-phase paste listener pastes
  text directly and uploads clipboard images as before. An explicit clipboard
  read remains only as a 250 ms fallback for browsers that suppress the
  native paste event.
- Image `termix:candidate-20261014-ctrlv-paste`
  (`sha256:aafe34481351b7a8eee1f79963a4218011bf5e1b9431d6da7cdc4c6b283b9999`),
  built with `TERMIX_BUILD_PROFILE=custom` and `FEATURE_SPLIT_TERMINAL=true`,
  the same profile as production. Frontend-only change; no data migration.
- Isolated startup passed Docker health, backend health, HTTPS `200`, and
  unauthenticated Sessions API `401`; the new Terminal chunk contains the
  reworked Ctrl+V branch. Production passed Docker health, local and public
  HTTPS `200`, new index asset `200`, Sessions API `401`, and retained the
  `termix-data` mount. No rollback tag was created.
