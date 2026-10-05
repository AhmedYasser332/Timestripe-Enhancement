import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx, defineManifest } from "@crxjs/vite-plugin";

const manifest = defineManifest({
  manifest_version: 3,
  name: "Timestripe Enhancement",
  description: "Projects, colors, bulk actions and templates for Timestripe.",
  version: "0.1.0",
  icons: {
    "16": "public/icons/icon16.png",
    "32": "public/icons/icon32.png",
    "48": "public/icons/icon48.png",
    "128": "public/icons/icon128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_icon: {
      "16": "public/icons/icon16.png",
      "32": "public/icons/icon32.png",
      "128": "public/icons/icon128.png",
    },
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://timestripe.com/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  host_permissions: ["https://timestripe.com/*"],
  permissions: ["storage"],
});

export default defineConfig({
  plugins: [react(), crx({ manifest })],
});
