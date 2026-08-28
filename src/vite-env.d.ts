/// <reference types="vite/client" />

declare module "*.svg?react" {
  import type { FC, SVGProps } from "react";
  const ReactComponent: FC<SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}

/** Build-time feature flags injected by vite.config.ts `define`. */
declare const __TERMIX_FEATURES__: Record<string, boolean>;
declare const __TERMIX_FEATURE_SFTP__: boolean;
declare const __TERMIX_FEATURE_DOCKER__: boolean;
declare const __TERMIX_FEATURE_SPLIT_TERMINAL__: boolean;
declare const __TERMIX_FEATURE_HISTORY__: boolean;
declare const __TERMIX_FEATURE_SNIPPETS__: boolean;
declare const __TERMIX_FEATURE_MACROS__: boolean;
declare const __TERMIX_FEATURE_AUTOMATIONS_PANEL__: boolean;
declare const __TERMIX_FEATURE_WAKE_ON_LAN__: boolean;
declare const __TERMIX_FEATURE_ADVANCED_AUDIT__: boolean;
