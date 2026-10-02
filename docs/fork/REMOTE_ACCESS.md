# Termix remote access

## Architecture

`https://termix.ncls.cc` is a proxied Cloudflare DNS CNAME to the remotely managed
tunnel `termix`. Cloudflare sends it to `https://127.0.0.1:8443`; the tunnel's loopback
origin uses `noTLSVerify=true` only for this self-signed local certificate. Termix is
public at the Cloudflare boundary and relies on its native authentication. The connector
is a user-level systemd service and is persistent across logout because `Linger=yes` is
enabled for `admin`.

Active deployment names:

- Compose project: `termix`
- Application container/image: `termix` / `termix:latest`
- Guacamole container: `termix-guacd`
- Volume/network: `termix-data` / `termix-net`
- Connector unit: `cloudflared-termix.service`
- Runtime token: `/home/admin/.config/cloudflared/termix.token` (mode `0600`)
- Connector binary: `/home/admin/.local/bin/cloudflared`
- Local metrics: `127.0.0.1:20241`

There is no direct SSH route. Databases, Redis, and TeamSpeak remain excluded. The same
tunnel also carries three explicitly named web applications:

- `https://mercado.ncls.cc` -> `http://127.0.0.1:8081`, public at Cloudflare and
  protected by the application's own password login. This exception exists so the
  owner's father can use it without the email OTP gate.
- `https://gym.ncls.cc` -> `http://127.0.0.1:18081`, protected by Cloudflare Access.
- `https://licitacoes.ncls.cc` -> `http://127.0.0.1:8000`, protected by Cloudflare
  Access. This exposes the API and Swagger documentation; the project has no separate
  frontend.

The final ingress rule is always `http_status:404`; there is no wildcard hostname or
generic TCP route.

## TeamSpeak DNS

TeamSpeak is intentionally not added to the HTTP tunnel. Voice traffic uses UDP and
file transfer uses raw TCP, so `familiasacana.ncls.cc` is a DNS-only Cloudflare `A`
record pointing to the current public IPv4 address. The router/firewall remains
responsible for forwarding the TeamSpeak ports to the VM.

`scripts/update_cloudflare_ddns.py` refreshes only that exact record. It reads its API
token from the machine-local `/home/admin/.config/cloudflare/ddns.token` file, which
must use mode `0600`; neither the token nor the resolved address belongs in this
repository. The updater runs from `cloudflare-ddns.timer` every five minutes. Its API
token should be limited to `Zone / DNS / Edit` for the `ncls.cc` zone and must remain
valid for as long as dynamic DNS is required.

The former DuckDNS updater is not part of the active configuration. The old DuckDNS
name may continue to resolve at that provider until it is removed from the DuckDNS
account, but this VM no longer updates or depends on it.

## LAN fallback

Termix remains available without Cloudflare or Internet through the VM's LAN address:

`https://<TERMIX_LAN_ADDRESS>:8443`

Docker publishes port `8443` separately on loopback for the tunnel and on the exact LAN
address configured in the ignored `docker/docker-compose.lan.yml` override; it is not
bound to every interface or to a public address.
The native Termix login remains mandatory. Because the local certificate is generated
for `termix.ncls.cc`, a browser using the IP address can show a certificate-name warning;
this is expected for emergency LAN access. A clean certificate experience during an
Internet outage requires split-horizon DNS on the LAN router, mapping `termix.ncls.cc`
to the private Termix LAN address.

The fallback depends on the VM retaining its private address. Reserve it in the router
and update the ignored LAN override if the address changes. Never commit the real value.

Proxmox already has its own independent LAN fallback at
`https://<PROXMOX_LAN_ADDRESS>:8006`. It was verified over HTTPS from this VM and is
intentionally not routed through the Termix tunnel. Keep its real address only in local
operator notes, never in this repository.

## Access policy and future apps

The exact self-hosted Access applications `gym` and `licitacoes` each have a `720h`
session. Their policy is `owner-only`: decision `allow`, precedence `1`, and
the exact email `nicolaselias@pm.me`; One-Time PIN is the configured identity provider.
Organization team name is `termix-ncls` because the requested `termix` team name was
unavailable. There is intentionally no Access application or bypass policy for
`termix.ncls.cc` or `mercado.ncls.cc`; authentication happens inside each application.

To add a future private web app, create and verify its Cloudflare Access application
and least-privilege policy first, then add exactly one hostname ingress rule and its
proxied DNS record. Do not add a route, SSH service, or broad identity selector before
the Access policy and security review are complete.

The idempotent maintenance helper is `scripts/configure_cloudflare_apps.py`. It only
manages the four hostnames listed above, prompts for the API token without storing or
printing it, and removes Access applications from the two public-by-design hostnames.
Run it with:

```sh
python3 scripts/configure_cloudflare_apps.py
```

The API token used during the initial expansion reports an expiry of
`2026-08-31T23:59:59Z`. Its expiry does not interrupt the connector, existing DNS
records, or published apps, because tunnel runtime uses a separate token. The same API
token is temporarily used by the TeamSpeak DDNS updater, however, so its expiry must be
removed or the local DDNS token must be replaced before that timestamp. If it expires,
the last DNS value remains published but no longer follows a later public-IP change. The
durable replacement should grant only `Zone / DNS / Edit` for `ncls.cc`.

## Application-specific limitations

Mercado Livre runs as the system service `mercado-livre-control.service` with automatic
restart. Its Java process currently listens on all interfaces at port `8081`; the tunnel
targets loopback, but host firewall/bind hardening is still recommended separately.

Gym currently runs as a manually launched development instance. Port `18081` is healthy
and serves the SPA, while the duplicate instance on `18080` returns application errors.
The healthy instance still uses an in-memory H2 database and has no owner bootstrap
credentials configured. Cloudflare Access protects the hostname, but the Gym deployment
must be promoted to PostgreSQL with an explicit owner password before it is considered
durable production. The tunnel configuration does not stop or replace either process.

Licitações already publishes its API on loopback only at port `8000`. Cloudflare Access
is the external authentication boundary; scripts that need unattended external API
access will require a separately scoped Access service token.

## Service operations and diagnostics

```sh
systemctl --user status cloudflared-termix.service
systemctl --user restart cloudflared-termix.service
systemctl --user is-active cloudflared-termix.service
curl -fsS http://127.0.0.1:20241/ready
curl -fsS http://127.0.0.1:20241/metrics
journalctl --user -u cloudflared-termix.service -e
docker compose -f docker/docker-compose.local.yml ps
docker logs --tail 200 termix
docker logs --tail 200 termix-guacd
ss -ltnp
```

Investigate connector reconnect loops, TLS/origin errors, `ws_pong_timeout`, and
persistent-session errors in the connector and Termix logs. Metrics must remain bound
to loopback only. Verify that Docker publishes only `127.0.0.1:8443->8443/tcp`.

For token rotation, issue a new tunnel-specific token from the Cloudflare dashboard/API,
write only that token to `/home/admin/.config/cloudflared/termix.token` with mode
`0600`, then restart and verify the service and tunnel health. Never place the Cloudflare
API token in this file or in the repository.

## Backup and migration record

The legacy `docker_termix-data` volume was stopped and copied read-only to `termix-data`.
The legacy volume and its `termix`/`guacd` containers remain intact for rollback. The
verified cold backup is:

`/home/admin/termix/backups/termix-data-pre-termix-20260830-122334.tar.gz`

SHA-256: `f9cfe5d66ef44db7d9e24fd5b5f7ed25fd3b752fb8058cbd5935056cc0aa0bbf`;
owner `admin:admin`, mode `0640`. The copied database and persistent files matched in
count, bytes, and SHA-256. Only the new volume's `ssl/termix.crt` and `ssl/termix.key`
were removed so Termix could generate its `termix.ncls.cc` certificate; the legacy
files were not changed.

## Exact rollback

If post-cutover validation fails:

```sh
docker compose -f docker/docker-compose.local.yml down
systemctl --user stop cloudflared-termix.service
docker start guacd
docker start termix
docker inspect termix guacd
```

Confirm the legacy containers' health and old port bindings. Keep both data volumes for
diagnosis; never copy data backward automatically. The pre-cutover image is
`docker-termix:rollback-pre-termix-20260830-122334`, and the untouched rollback volume
is `docker_termix-data`. Do not delete the legacy containers, volume/network, rollback
image, or verified backup without a separate explicit request.
