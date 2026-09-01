import { getUserPreferences, saveUserPreferences } from "@/api/open-tabs-api";

export type RailPreference =
  "pinAppRail" | "expandAppRailOnHover" | "appRailItemsExpanded";

const CHANGE_EVENT: Record<RailPreference, string> = {
  pinAppRail: "pinAppRailChanged",
  expandAppRailOnHover: "expandAppRailOnHoverChanged",
  appRailItemsExpanded: "appRailItemsExpandedChanged",
};

// pinAppRail and appRailItemsExpanded default off, expandAppRailOnHover
// defaults on, so each key needs its own read rather than a shared
// === "true" check.
const DEFAULT_OFF_KEYS: RailPreference[] = [
  "pinAppRail",
  "appRailItemsExpanded",
];

export function readRailPreference(key: RailPreference): boolean {
  const stored = localStorage.getItem(key);
  return DEFAULT_OFF_KEYS.includes(key)
    ? stored === "true"
    : stored !== "false";
}

/**
 * Single write path for the app rail display preferences. Persists to
 * localStorage, notifies every mounted listener so the rail and the settings
 * panel stay in step, then mirrors to the server when the user is on cloud
 * storage.
 */
export function setRailPreference(key: RailPreference, value: boolean): void {
  localStorage.setItem(key, String(value));
  window.dispatchEvent(new Event(CHANGE_EVENT[key]));
  void getUserPreferences()
    .then((preferences) => {
      if (preferences.storageMode === "cloud") {
        return saveUserPreferences({ [key]: value });
      }
    })
    .catch(() => {});
}
