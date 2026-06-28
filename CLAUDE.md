## Development

```bash
# TypeScript backend — run from repo root
bun test             # run all tests (backend + frontend, scanned recursively)
bun typecheck        # tsc on backend + frontend
bun lint             # biome lint on backend + frontend
bun format           # prettier format on backend + frontend
bun run build        # compile curator-server binary (backend only)
bun db:generate      # generate Drizzle migrations (requires DB_URL)
```

## Dev Mock Auth

Set `DEV_MOCK_AUTH=true` in the backend environment to bypass Commons OAuth. Every request without an active session is automatically authenticated as a mock user (default username: `DaxServer`, sub: `dev-user-1`). Override with `DEV_MOCK_USERNAME` and `DEV_MOCK_SUB`. Uploads and WebSocket connections are disabled (no real access token). The frontend shows an amber banner when running under Vite dev mode with mock auth active.

## TypeScript Backend Notes

- `@elysiajs/static` default prefix is `/public` — use `prefix: "/"` to serve assets at root
- Drizzle `datetime` has no `.onUpdateNow()` — use `timestamp` for auto-update columns
- `bun install` hard-errors if a workspace member in `"workspaces"` doesn't exist yet
- Bun workspace catalog defined in `package.json` under `workspaces.catalog` — all package deps use `catalog:` protocol
- Elysia guard plugins: use `as: 'scoped'` (not `'local'`) — `'local'` silently skips the guard when consumed via a parent `.use()`
- `config.*` values are frozen at module import time — guards should read from `config`, and tests should seed sessions/state matching the config defaults rather than injecting env vars
- `vue-tsc` is stricter than `tsc` — it catches `T | undefined` from `.then(r => r[0])` that backend-only typecheck passes; run `bun typecheck` (runs both) before committing
- mysql2 returns GROUP BY column values as strings even for INTEGER columns — use `Number(r.col)` as Map keys in aggregation results to avoid silent lookup misses (`statsMap.get(367)` fails when key is `"367"`)
