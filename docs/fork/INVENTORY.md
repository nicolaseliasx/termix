# Fork Inventory

## Firewall/Package/Cron managers

These are on-demand Host Metrics manager cards, not the regular metrics collectors.

### Frontend

- `src/ui/features/host-metrics/cards/managers/FirewallManagerCard.tsx:17`
- `src/ui/features/host-metrics/cards/managers/CronManagerCard.tsx:18`
- `src/ui/features/host-metrics/cards/managers/PackageManagerCard.tsx:17`
- `src/ui/features/host-metrics/cards/index.tsx:21-24,150-168` imports and registers
  the three manager cards.

### Backend routes

- Firewall: `GET /host-metrics/managers/firewall/:id`, `POST .../rule`, and
  `POST .../persist` in `src/backend/hosts/metrics/managers/firewall.ts:51-104`.
- Cron: `GET` and `POST /host-metrics/managers/cron/:id` in
  `src/backend/hosts/metrics/managers/cron.ts:85-94`.
- Packages: `GET /host-metrics/managers/packages/:id` and `POST .../action` in
  `src/backend/hosts/metrics/managers/packages.ts:96-111`.
- All three are mounted by `src/backend/hosts/metrics/managers/index.ts:56-59`.

### Dependency and removal verdict

The managers use the Host Metrics SSH connection helpers and platform detection, but
are not polled collectors. Keep `src/backend/hosts/metrics/widgets/*` (including the
core `FirewallCard`) and the Host Metrics transport; they also power dashboard widgets.
The manager cards and their three route registrations can be removed together in Phase
4 after their card IDs/default preferences are migrated or ignored. Do not remove the
shared manager framework or metrics collectors with them.

## Consolidated future-removal inventory

- Phase 4: Guacamole/guacd, serial, Termix ID, LDAP, vault, ACME SSL, homepage/widgets,
