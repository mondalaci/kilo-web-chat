// PM2 process definition for the OpenCode Chat web UI.
//
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup        # to relaunch on boot
//
// The UI runs the Vite dev server so edits under src/ are picked up live via
// HMR (http://chat.localhost -> nginx -> 127.0.0.1:4173). Logs go to ~/.pm2/logs
// by default.
//
// The opencode v2 server this UI talks to is supervised separately, in
// ~/.config/opencode/ecosystem.config.cjs (`opencode serve --service`). It is
// deliberately not defined here: `serve --service` registers that process as
// the single shared background service, so the TUI and every other client reuse
// it, and only one supervisor should own it.

const path = require("node:path")

const CHAT_DIR = __dirname

module.exports = {
  apps: [
    {
      name: "opencode-chat",
      cwd: CHAT_DIR,
      // Vite dev server: serves src/ directly and hot-reloads on file changes,
      // so the UI is always up to date without rebuilding dist/.
      script: path.join(CHAT_DIR, "node_modules", "vite", "bin", "vite.js"),
      args: "--host 127.0.0.1 --port 4173",
      interpreter: "node",
      env: {
        NODE_ENV: "development",
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
    },
  ],
}
