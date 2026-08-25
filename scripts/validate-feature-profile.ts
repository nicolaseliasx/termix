import { resolveTermixFeatures } from "../src/shared/features";

const { profile, flags } = resolveTermixFeatures(process.env);

console.log(
  JSON.stringify(
    {
      profile,
      enabled: Object.entries(flags)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name),
    },
    null,
    2,
  ),
);
