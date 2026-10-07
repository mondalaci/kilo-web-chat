# kilo-search

A small local service that adds **content search (FTS5 / BM25)** over Kilo
conversations — titles *and* message text, file references and tool errors —
without modifying the Kilo server.

It opens the Kilo SQLite database **read-only** (WAL allows many concurrent
readers) and keeps its own FTS5 index in a separate database file.

## Run

```bash
cd search-server
bun run start           # or: bun src/index.ts
```

Environment overrides:

| Variable | Default | Purpose |
|---|---|---|
| `KILO_DB` | `~/.local/share/kilo/kilo.db` | Kilo database (read-only) |
| `KILO_SEARCH_DB` | `search-server/data/search.db` | own FTS index |
| `KILO_SEARCH_PORT` | `27184` | HTTP port |
| `KILO_SEARCH_HOST` | `127.0.0.1` | bind address |
| `KILO_SEARCH_ORIGIN` | `*` | `Access-Control-Allow-Origin` |
| `KILO_SEARCH_POLL_MS` | `1000` | sync poll interval |

## API

```
GET /health
  -> { ok, parts, watermark, kiloDB }

GET /search?q=<terms>&limit=<1..50>
  -> { results: [{ sessionID, title, directory, updated, score, snippet }] }
```

`score` is FTS5 `bm25` — **more negative is better**. Results are aggregated to
one row per session (its best-matching part) and only sessions that still exist
are returned.

## How sync works

- On start (and whenever the Kilo db's `max(part.time_updated)` advances) parts
  with `time_updated` greater than the stored watermark are (re)indexed.
- The watermark advances even past non-indexable parts (`reasoning`, step
  markers, completed tools) so the scan window never grows.
- Deletions are not tracked; a deleted session simply disappears from results
  because session metadata is read live from the Kilo db.

The searchable text mirrors the server's own recall search: user/assistant
text (excluding synthetic/ignored), file references and tool errors.
