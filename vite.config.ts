import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    hmr: {
      // The UI is reached through the nginx proxy on http://chat.localhost (port 80),
      // which forwards to this loopback dev server. Vite derives the HMR websocket
      // host from the page origin, but the port from this setting, so the browser
      // connects straight to 127.0.0.1:4173 (chat.localhost resolves there) and HMR
      // works without adding websocket-upgrade headers to the nginx config.
      clientPort: 4173,
    },
  },
  build: {
    target: "es2022",
  },
})