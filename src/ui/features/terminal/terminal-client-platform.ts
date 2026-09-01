type NavigatorIdentity = Pick<
  Navigator,
  "maxTouchPoints" | "platform" | "userAgent"
>;

/**
 * All browsers on iOS use WebKit, including standalone home-screen apps.
 * iPadOS can identify itself as macOS, so touch capability is part of the
 * detection instead of relying only on the user-agent string.
 */
export function isIOSWebKitClient(
  identity: NavigatorIdentity | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator,
): boolean {
  if (!identity) return false;

  const isIOSDevice =
    /iPhone|iPad|iPod/i.test(identity.userAgent) ||
    (identity.platform === "MacIntel" && identity.maxTouchPoints > 1);

  return isIOSDevice && /AppleWebKit/i.test(identity.userAgent);
}
