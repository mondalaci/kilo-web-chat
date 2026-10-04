// PM2 process definitions for the Kilo Code server and the Kilo Chat web UI.
//
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup        # to relaunch on boot
//
// The chat UI is served from a static build, so run `bun run build` (or
// `npm run build`) before starting it. Logs go to ~/.pm2/logs by default.

const path = require("node:path")

const HOME = process.env.HOME || "/root"
const CHAT_DIR = __dirname

module.exports = {
  apps: [
    {
      name: "kilo-server",
      // `kilo` is the bash wrapper that execs the newest Kilo Code extension
      // binary, so it keeps working across extension upgrades.
      //
      // Port note: the VS Code extension starts its own server on 4096 while it
      // is running, so this always-on server uses 4097 to avoid an EADDRINUSE
      // crash-restart loop. The chat UI autodetects both.
      script: path.join(HOME, "bin", "kilo"),
      args: "serve --port 4097 --hostname 127.0.0.1",
      interpreter: "bash",
      cwd: HOME,
      env: {
        // Loopback-only server. Leave the password unset for a local,
        // unauthenticated server, or set it to require HTTP Basic auth
        // (username defaults to "kilo"):
        // KILO_SERVER_PASSWORD: "change-me",
        // Extra CORS origins are usually unnecessary for localhost, but if you
        // serve the UI from another host, add them via `--cors <origin>` above.
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: 10000,
      restart_delay: 2000,
      kill_timeout: 10000,
    },
    {
      name: "kilo-chat",
      cwd: CHAT_DIR,
      // Serve the production build (dist/) on a fixed port.
      script: path.join(CHAT_DIR, "node_modules", "vite", "bin", "vite.js"),
      args: "preview --host 127.0.0.1 --port 4173",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
    },
  ],
}
