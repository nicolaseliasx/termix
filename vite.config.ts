import path from "path";
import fs from "fs";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
// Build-time feature flags for optional fork features. All default to false;
// enable individually with VITE_FEATURE_<ID>=true (e.g. VITE_FEATURE_SNIPPETS=true),
// or turn everything on with TERMIX_BUILD_PROFILE=full (an explicit
// VITE_FEATURE_<ID>=false still wins). Injected as the `__TERMIX_FEATURES__`
// literal consumed by src/ui/lib/features.ts.
const FEATURE_IDS = [
  "sftp",
  "docker",
  "split_terminal",
  "history",
  "snippets",
  "macros",
  "automations_panel",
  "wake_on_lan",
  "advanced_audit",
] as const;

const termixBuildProfile = process.env.TERMIX_BUILD_PROFILE;
if (
  termixBuildProfile !== undefined &&
  !["core", "full", "custom"].includes(termixBuildProfile)
) {
  throw new Error(
    `Invalid TERMIX_BUILD_PROFILE "${termixBuildProfile}". Expected core, full, or custom.`,
  );
}

const termixFeatures = Object.fromEntries(
  FEATURE_IDS.map((id) => {
    const override = process.env[`VITE_FEATURE_${id.toUpperCase()}`];
    if (override === "true") return [id, true];
    if (override === "false") return [id, false];
    return [id, termixBuildProfile === "full"];
  }),
) as Record<(typeof FEATURE_IDS)[number], boolean>;

const sslCertPath = path.join(process.cwd(), "ssl/termix.crt");
const sslKeyPath = path.join(process.cwd(), "ssl/termix.key");

const hasSSL = fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath);
const useHTTPS = process.env.VITE_HTTPS === "true" && hasSSL;
const apiProxyPorts = [
  30001, 30002, 30003, 30004, 30005, 30006, 30007, 30008, 30009, 30010, 30011,
  30012,
];
const apiProxy = Object.fromEntries(
  apiProxyPorts.map((port) => [
    `/__termix_api/${port}`,
    {
      target: `http://127.0.0.1:${port}`,
      changeOrigin: true,
      ws: true,
      rewrite: (requestPath: string) =>
        requestPath.replace(new RegExp(`^/__termix_api/${port}`), ""),
    },
  ]),
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as { version?: string };

const manualChunkGroups: Record<string, string[]> = {
  "react-vendor": ["react", "react-dom"],
  "ui-vendor": [
    "@radix-ui/react-dialog",
    "@radix-ui/react-dropdown-menu",
    "@radix-ui/react-select",
    "@radix-ui/react-tabs",
    "@radix-ui/react-switch",
    "@radix-ui/react-tooltip",
    "@radix-ui/react-scroll-area",
    "@radix-ui/react-separator",
    "lucide-react",
    "clsx",
    "tailwind-merge",
    "class-variance-authority",
  ],
  monaco: ["@monaco-editor/react", "monaco-editor"],
  "terminal-vendor": [
    "@xterm/addon-clipboard",
    "@xterm/addon-fit",
    "@xterm/addon-unicode11",
    "@xterm/addon-web-links",
    "@xterm/xterm",
    "react-xtermjs",
  ],
  codemirror: [
    "@uiw/react-codemirror",
    "@codemirror/view",
    "@codemirror/state",
    "@codemirror/language",
    "@codemirror/commands",
    "@codemirror/search",
    "@codemirror/autocomplete",
    "@codemirror/theme-one-dark",
    "@uiw/codemirror-extensions-langs",
    "@uiw/codemirror-theme-github",
  ],
  "remote-desktop-vendor": ["guacamole-common-js"],
  "graph-vendor": ["cytoscape", "react-cytoscapejs"],
  "file-preview-vendor": [
    "react-pdf",
    "pdfjs-dist",
    "react-photo-view",
    "react-h5-audio-player",
    "react-markdown",
    "react-syntax-highlighter",
    "remark-gfm",
  ],
};

function getManualChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;

  const normalizedId = id.replaceAll("\\", "/");

  for (const [chunkName, packages] of Object.entries(manualChunkGroups)) {
    if (
      packages.some((packageName) =>
        normalizedId.includes(`/node_modules/${packageName}/`),
      )
    ) {
      return chunkName;
    }
  }

  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss(), svgr()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(
      packageJson.version || "0.0.0",
    ),
    __TERMIX_BUILD_PROFILE__: JSON.stringify(termixBuildProfile ?? "core"),
    __TERMIX_FEATURES__: JSON.stringify(termixFeatures),
    ...Object.fromEntries(
      FEATURE_IDS.map((id) => [
        `__TERMIX_FEATURE_${id.toUpperCase()}__`,
        JSON.stringify(termixFeatures[id]),
      ]),
    ),
  },
  resolve: {
    alias: {
      "@/types": path.resolve(__dirname, "./src/types"),
      "@": path.resolve(__dirname, "./src/ui"),
    },
  },
  base: process.env.VITE_BASE_PATH || "./",
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: getManualChunk,
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    https: useHTTPS
      ? {
          cert: fs.readFileSync(sslCertPath),
          key: fs.readFileSync(sslKeyPath),
        }
      : false,
    port: 5173,
    host: "localhost",
    proxy: apiProxy,
  },
});
