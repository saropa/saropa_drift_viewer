# saropa_drift_viewer — Roadmap

This document captures improvement ideas from a full project review: gaps to fix, incremental enhancements, and “wow” ideas that could make the package stand out.

---

## Project summary

**What it is:** A debug-only HTTP server that exposes SQLite/Drift table data as JSON and a minimal web UI. Apps pass a query callback (e.g. from Drift’s `customSelect` or any SQLite executor); the server lists tables and serves table rows and schema.

**Current state:** Single package, zero runtime dependencies, strict analysis, CI (analyze + format + test) on `master`, publish workflow and a detailed Python publish script. The web UI includes: table list with row counts, pagination (limit/offset), client-side filter, collapsible schema panel, export table as CSV, light/dark theme (localStorage), read-only SQL runner with templates/autofill, export schema (no data) and full dump (schema + data), live refresh (long-poll), and optional auth (token or HTTP Basic) for secure dev tunnels. Dependabot is configured for pub and github-actions.

---

## Fixes and gaps (do first)

| Priority | Item | Notes |
|----------|------|--------|
| **P0** | **Implement or correct `startDriftViewer`** | README documents `myDb.startDriftViewer(enabled: kDebugMode)` and an extension on `GeneratedDatabase`, but this API does not exist in the package (no Drift dependency, no such function). Either: (1) add an optional Drift dependency and an extension that wires `customSelect` into `DriftDebugServer.start`, or (2) remove/adjust README so it only documents `DriftDebugServer.start(query: ...)`. |
| **P1** | **Example app** | No `example/` in the repo. A small Flutter or Dart example (e.g. Drift app that starts the viewer) would help pub.dev and onboarding. |

---

## Incremental improvements

### API and server

*(Bind address, CORS, health endpoint, and shutdown hook are implemented.)*

### Web UI

*(Pagination, search/filter, schema in UI, export CSV, theme toggle, and row count are implemented.)*

### Developer experience

- **Dart doc** — Expand doc comments and ensure public API is well documented; consider `@example` for `DriftDebugServer.start` and the Drift extension (once it exists).
- **Changelog discipline** — Keep CHANGELOG.md in sync with every release (already encouraged by publish script).

### Infrastructure

*(Dependabot and branch consistency are implemented.)*

---

## “Wow” ideas

High-impact or differentiator features that could make the package memorable and widely used.

| Idea | Description |
|------|-------------|
| **Schema diagram** | Visualize tables and relationships (e.g. from `sqlite_master` + PRAGMA foreign_key_list). Click a table to see its data. |
| **DevTools / IDE integration** | Flutter DevTools plugin or VS Code / Cursor extension: “Open Drift viewer” or a sidebar that lists tables and opens the browser at the right URL. Feels native to the toolchain. *(Implemented: Run Task → "Open Drift Viewer" in repo; optional minimal extension in `extension/` with one command.)* |
| **Database diff** | Compare two databases (e.g. local vs staging): same schema, diff of row counts or row content per table. Export diff report. *(Implemented: optional `queryCompare` at startup; GET /api/compare/report with schema + count diff; export diff-report.json; UI "Database diff" section.)* |
| **Snapshot / time travel** | Optional “snapshot” of table state at a point in time (e.g. in-memory or file); later, “compare to now” to see what changed. *(Implemented: POST/GET/DELETE /api/snapshot, GET /api/snapshot/compare; export snapshot-diff.json; UI section.)* |
| **Flutter widget overlay** | In debug builds, a small floating button that opens the viewer in the browser (or an in-app WebView). One tap from the app. |
| **Query history** | If read-only SQL is added, keep a short history of queries and results in the UI or in `localStorage` for repeat checks. *(SQL runner exists; history not yet.)* |

*(Live refresh, read-only SQL runner, secure dev tunnel (auth), and export raw SQLite file (getDatabaseBytes / GET /api/database) are implemented.)*

---

## Suggested order

1. **Short term:** Fix P0 (implement `startDriftViewer` or adjust README to callback-only API). Add P1 example app.
2. **Next:** Developer experience (Dart doc, changelog discipline).
3. **Later:** Pick 1–2 “wow” items (e.g. schema diagram, DevTools/IDE integration, or export full DB) and ship them as major/minor features.

---

*Generated from a full project review. Treat this as a living list: re-prioritize and add/remove items as the project evolves.*
