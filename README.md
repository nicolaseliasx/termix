# Termix

Termix is a self-hosted web application for managing SSH terminals, persistent tmux
sessions, remote desktops, files, Docker workloads, metrics, alerts, and automations.

The production deployment is intentionally private-by-default:

- HTTPS is terminated through a named Cloudflare Tunnel route.
- Termix's native authentication remains mandatory.
- Registration and telemetry are disabled in the local deployment profile.
- The tunnel origin and operational metrics bind to loopback.
- Optional LAN fallback is configured only in an ignored machine-local Compose override.

No private IP addresses, API tokens, credentials, backups, or machine-specific agent
plans belong in this repository.

## Local development

Requirements: Node.js 22.12 or newer and npm 11 or newer.

```sh
npm install
npm run dev
```

Useful verification commands:

```sh
npm run type-check
npm test
npm run build
```

## Container deployment

The versioned local profile keeps the application origin on loopback:

```sh
docker compose -f docker/docker-compose.local.yml up -d --build
```

For an emergency LAN fallback, create the ignored
`docker/docker-compose.lan.yml` override with a bind address appropriate for the local
machine and include it as a second Compose file. Never commit that override.

Operational details, rollback notes, and remote-access policy are documented in
[docs/fork/DEPLOY.md](docs/fork/DEPLOY.md) and
[docs/fork/REMOTE_ACCESS.md](docs/fork/REMOTE_ACCESS.md).

## Compatibility

Termix is derived from the open-source Termix project. Some internal database names,
API routes, environment variables, theme keys, and migration identifiers intentionally
retain their historical names so existing installations and stored data continue to
work. User-facing branding and new deployment identifiers use Termix.

See [LICENSE](LICENSE) for licensing information.
