/**
 * Compatibility shim kept from an earlier iteration of the build-flag work.
 * Prefer importing from `@/lib/features` directly.
 */
export { FEATURES, isFeatureEnabled } from "./features";
export type { FeatureFlags, FeatureId } from "./features";
