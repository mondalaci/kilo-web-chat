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
      // Port note: the VS Code extension starts its own server with `--port 0`
      // (a random free port), so a low/common port can occasionally be taken.
      // Use an uncommon high port to avoid collisions; the chat UI autodetects
      // it (see DEFAULT_PORTS in src/api/discovery.ts).
      //
      // CORS: the server only allows origins matching http://localhost:* and
      // http://127.0.0.1:* by default, so a reverse-proxied host needs an
      // explicit origin. Add one `--cors <origin>` per host that serves the UI.
      script: path.join(HOME, "bin", "kilo"),
      args: "serve --port 27183 --hostname 127.0.0.1 --cors http://chat.localhost",
      interpreter: "bash",
      cwd: HOME,
      env: {
        // PM2 is the supervisor here, not an editor client, so disable the
        // server's parent-watchdog. If KILO_PARENT_PID leaks in from the shell
        // that launched pm2, the watchdog watches a dead PID and kills the
        // server ~1s after startup (crash-restart loop). "0" disables it.
        KILO_PARENT_PID: "0",
        // Loopback-only server. Leave the password unset for a local,
        // unauthenticated server, or set it to require HTTP Basic auth
        // (username defaults to "kilo"):
        // KILO_SERVER_PASSWORD: "change-me",
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: 10000,
      exp_backoff_restart_delay: 100,
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
