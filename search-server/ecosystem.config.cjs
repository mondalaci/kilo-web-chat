// PM2 process definition for the Kilo Chat search service.
//
//   pm2 start search-server/ecosystem.config.cjs
//   pm2 save
//
// A small Bun service that provides FTS5/BM25 content search over Kilo
// conversations. It opens the Kilo database read-only and keeps its own index
// under search-server/data/, so the Kilo server is never modified.

const path = require("node:path")

const HOME = process.env.HOME || "/root"

module.exports = {
  apps: [
    {
      name: "kilo-search",
      cwd: __dirname,
      script: "src/index.ts",
      // bun:sqlite and Bun.serve require the Bun runtime.
      interpreter: path.join(HOME, ".bun", "bin", "bun"),
      env: {
        KILO_SEARCH_ORIGIN: "http://chat.localhost",
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
    },
  ],
}
