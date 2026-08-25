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
