export const FEATURE_ENV_NAMES = [
  "FEATURE_SFTP",
  "FEATURE_DOCKER",
  "FEATURE_SPLIT_TERMINAL",
  "FEATURE_HISTORY",
  "FEATURE_SNIPPETS",
  "FEATURE_MACROS",
  "FEATURE_AUTOMATIONS_PANEL",
  "FEATURE_WAKE_ON_LAN",
  "FEATURE_ADVANCED_AUDIT",
] as const;

export type FeatureEnvName = (typeof FEATURE_ENV_NAMES)[number];
export type TermixBuildProfile = "core" | "full" | "custom";
export type TermixFeatureFlags = Readonly<Record<FeatureEnvName, boolean>>;

export type FeatureEnvironment = Readonly<Record<string, string | undefined>>;

export type ResolvedTermixFeatures = Readonly<{
  profile: TermixBuildProfile;
  flags: TermixFeatureFlags;
}>;

const CORE_FEATURES: TermixFeatureFlags = Object.freeze({
  FEATURE_SFTP: false,
  FEATURE_DOCKER: false,
  FEATURE_SPLIT_TERMINAL: false,
  FEATURE_HISTORY: false,
  FEATURE_SNIPPETS: false,
  FEATURE_MACROS: false,
  FEATURE_AUTOMATIONS_PANEL: false,
  FEATURE_WAKE_ON_LAN: false,
  FEATURE_ADVANCED_AUDIT: false,
});

const FULL_FEATURES: TermixFeatureFlags = Object.freeze(
  Object.fromEntries(FEATURE_ENV_NAMES.map((name) => [name, true])) as Record<
    FeatureEnvName,
    boolean
  >,
);

function parseProfile(value: string | undefined): TermixBuildProfile {
  const profile = value ?? "core";
  if (profile === "core" || profile === "full" || profile === "custom") {
    return profile;
  }
  throw new Error(
    'Invalid TERMIX_BUILD_PROFILE "' +
      profile +
      '". Expected core, full, or custom.',
  );
}

function parseBoolean(name: FeatureEnvName, value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    "Invalid " + name + ' "' + value + '". Expected true or false.',
  );
}

export function resolveTermixFeatures(
  environment: FeatureEnvironment,
): ResolvedTermixFeatures {
  const profile = parseProfile(environment.TERMIX_BUILD_PROFILE);
  const overrides = FEATURE_ENV_NAMES.filter(
    (name) => environment[name] !== undefined && environment[name] !== "",
  );

  if (profile !== "custom" && overrides.length > 0) {
    throw new Error(
      "Feature overrides require TERMIX_BUILD_PROFILE=custom: " +
        overrides.join(", "),
    );
  }

  const flags: Record<FeatureEnvName, boolean> = {
    ...(profile === "full" ? FULL_FEATURES : CORE_FEATURES),
  };

  for (const name of overrides) {
    flags[name] = parseBoolean(name, environment[name]!);
  }

  return Object.freeze({ profile, flags: Object.freeze(flags) });
}

export function isTermixFeatureEnabled(
  flags: TermixFeatureFlags,
  feature: FeatureEnvName,
): boolean {
  return flags[feature];
}
