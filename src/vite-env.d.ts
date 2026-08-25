/// <reference types="vite/client" />

declare module "*.svg?react" {
  import type { FC, SVGProps } from "react";
  const ReactComponent: FC<SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}

/** Build-time feature flags injected by vite.config.ts `define`. */
declare const __TERMIX_FEATURES__: Record<string, boolean>;
