# Fork Deploy Notes

Current deployment of this fork on the LAN host (`devhub`) is Termix, exposed through
the public hostname `https://tserver.ncls.cc` and protected by native authentication.

## Stack

- `docker/docker-compose.local.yml` — local compose profile:
  - `tserver`: image `tserver:latest`, built from `docker/Dockerfile` (repo root context),
    loopback HTTPS on port `8443`, env `ENABLE_SSL=true`,
    `SSL_DOMAIN=tserver.ncls.cc`, `ALLOW_REGISTRATION=false`,
    `ENABLE_TELEMETRY=false`, `PUID/PGID=1001`, named volume `tserver-data` mounted at
    `/app/data`.
  - `tserver-guacd`: `guacamole/guacd:1.6.0` (RDP/VNC/Telnet backend), shares
    `tserver-data` for session recordings.
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

- Public URL: `https://tserver.ncls.cc`, protected by Termix's native authentication.
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

- Backup: `/home/admin/termix/backups/tserver-data-20260901-140719.tar.gz`
  (`sha256:f24f36f56867122a44112b3817d69b7cbdc7c46dd5d86157c71e008fbdfa5365`,
  12,649,170 bytes, mode `0640`), created from the read-only `tserver-data`
  volume and verified with `tar -tzf`.
- Deployed image: `tserver:candidate-20260901-140719`
  (`sha256:fdf8356fbe81e240a6d75d0873d29dbc2da3ba04398b8f822b17c2565ce1a019`),
  built with `TERMIX_BUILD_PROFILE=custom` and
  `FEATURE_SPLIT_TERMINAL=true`.
- Rollback image: `tserver:rollback-20260901-140719` (the image running
  immediately before this deploy). Roll back without changing persistent data:

  ```sh
  docker tag tserver:rollback-20260901-140719 tserver:latest
  docker compose -f docker/docker-compose.local.yml up -d --no-build tserver
  ```

- An isolated candidate with a temporary volume passed Docker health, backend
  health, UI `200`, Sessions and SplitScreen assets, the enabled split feature,
  and unauthenticated persistent-sessions `401` before promotion.
- Production passed Docker health, backend health (`30001` → `{"status":"ok"}`),
  loopback HTTPS (`8443` → `200`), persistent-sessions auth (`401`), Sessions
  and SplitScreen asset discovery, preserved the `tserver-data` mount, and had
  no startup error/fatal entries. Public validation was not available from the
  host because `tserver.ncls.cc` did not resolve at deploy time.
