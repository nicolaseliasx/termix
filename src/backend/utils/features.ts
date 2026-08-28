/**
 * Boot-time feature flags for the fork's optional features.
 *
 * Each flag is read from the environment as `FEATURE_<ID>`:
 *
 * - FEATURE_SFTP — SFTP file manager service and UI entry points
 * - FEATURE_DOCKER — Docker management service and UI entry points
 * - FEATURE_SPLIT_TERMINAL — split-screen / workspaces UI
 * - FEATURE_HISTORY — terminal command history routes
 * - FEATURE_SNIPPETS — snippet CRUD routes and UI
 * - FEATURE_MACROS — macro UI (client-side storage; flag mirrors the UI gate)
 * - FEATURE_AUTOMATIONS_PANEL — automations CRUD routes and management UI
 *   (the automation engine/scheduler and Alerts ALWAYS run; they are core)
 * - FEATURE_WAKE_ON_LAN — Wake-on-LAN route and UI actions
 * - FEATURE_ADVANCED_AUDIT — audit log HTTP routes and admin UI section
 *   (internal audit-log recording in middleware is core and always on)
 *
 * Every flag defaults to false: any value other than the exact string "true"
 * keeps the feature off. Flags are evaluated at boot; gated routes/services
 * are never registered when off.
 */
export type FeatureId =
  | "SFTP"
  | "DOCKER"
  | "SPLIT_TERMINAL"
  | "HISTORY"
  | "SNIPPETS"
  | "MACROS"
  | "AUTOMATIONS_PANEL"
  | "WAKE_ON_LAN"
  | "ADVANCED_AUDIT";

export function isFeatureEnabled(id: FeatureId): boolean {
  return process.env[`FEATURE_${id}`] === "true";
}
