/**
 * Build-time feature flags for the fork's optional features.
 *
 * The flag map is injected by Vite `define` (see `vite.config.ts`) as the
 * literal `__TERMIX_FEATURES__` object, produced from `VITE_FEATURE_<ID>`
 * env vars at build time. All flags default to `false`.
 *
 * Guards should close over `FEATURES` at module level (e.g.
 * `FEATURES.snippets === true ? lazy(...) : null`) so Rollup can drop the
 * lazy imports — and their chunks — of disabled features. There is no
 * runtime toggling: this is compile-time only.
 */
export type FeatureId =
  | "sftp"
  | "docker"
  | "split_terminal"
  | "history"
  | "snippets"
  | "macros"
  | "automations_panel"
  | "wake_on_lan"
  | "advanced_audit";

export type FeatureFlags = Record<FeatureId, boolean>;

export const FEATURES: FeatureFlags =
  __TERMIX_FEATURES__ as unknown as FeatureFlags;

/** Runtime helper for non-tree-shaking-sensitive call sites. */
export function isFeatureEnabled(id: FeatureId): boolean {
  return FEATURES[id] === true;
}
