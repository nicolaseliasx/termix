# Fork Deploy Notes

Current deployment of this fork on the LAN host (`192.168.15.4`, host alias `devhub`).

## Stack

- `docker/docker-compose.local.yml` — local compose profile:
  - `termix`: built from `docker/Dockerfile` (repo root context), ports `8080` (HTTP) and `8443` (HTTPS), env `ENABLE_SSL=true`, `SSL_DOMAIN=192.168.15.4`, `ALLOW_REGISTRATION=false`, `ENABLE_TELEMETRY=false`, `PUID/PGID=1001`, named volume `termix-data` mounted at `/app/data`.
  - `guacd`: `guacamole/guacd:1.6.0` (RDP/VNC/Telnet backend), shares `termix-data` for session recordings.
- Deploy with: `docker compose -f docker/docker-compose.local.yml up -d --build` (build the app image first with `npm run build` inside the Docker build, or rely on the Dockerfile steps).

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

- HTTPS is local self-signed (browser warning expected); access is LAN-only today.
- Future: expose via Tailscale (planned for a later phase; no work done yet).

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
