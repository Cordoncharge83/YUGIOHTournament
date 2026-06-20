import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const appTarget = mode === "public" ? "public" : "desktop";
  const targetApp = appTarget === "public"
    ? "./src/apps/PublicApp.jsx"
    : "./src/apps/DesktopApp.jsx";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@target-app": fileURLToPath(new URL(targetApp, import.meta.url)),
      },
    },
    define: {
      "import.meta.env.VITE_APP_TARGET": JSON.stringify(appTarget),
    },
  };
});
