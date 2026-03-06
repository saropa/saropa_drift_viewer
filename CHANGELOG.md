# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**pub.dev** — [saropa_drift_viewer](https://pub.dev/packages/saropa_drift_viewer)


## [Unreleased]

### Changed

- Publish tooling: `scripts/publish.py` now checks whether the package already exists on pub.dev before offering a local `dart pub publish` for first-time publishes.
- CI workflow: removed the one-time \"Add uploader\" workflow and inline step; maintainers can use `dart pub uploader` or the pub.dev UI directly when needed.
- Tooling docs: clarified in `analysis_options.yaml` comments that saropa_lints 6.x does not provide `analysis_options.yaml` as an include target.


## [0.2.2] - 2026-03-05

### Changed

- Bump for release.


## [0.2.1] - 2026-03-05

In this release we only updated the CHANGELOG link to point at the repo until the package was live on pub.dev.

### Changed

- CHANGELOG: link to GitHub until package was on pub.dev.

## [0.2.0] - 2026-03-05

In this release we focused on making the viewer more useful day to day: the table view now refreshes when data changes, you can run read-only SQL from the browser, and you can protect the viewer with a token or Basic auth when using a dev tunnel. We added a schema diagram, CSV export, snapshot/time travel, and a Flutter overlay so you can open the viewer from your app.

### Fixed

- **Lint and validation** — DriftDebugServer singleton uses nullable backing field + getter (no `late`) for avoid_late_keyword. POST /api/sql checks Content-Type before decoding; body decode/validation in `_parseSqlBody` (require_content_type_validation, require_api_response_validation). WebView route: `buildWebViewRoute` uses `Uri.tryParse` and allows only http/https; invalid URLs show a localized error screen with overflow-safe text. Load errors in WebView logged via `_logLoadError` in debug. POST /api/sql rejects non-`application/json` Content-Type with 400; unit test added. Bug reports filed for linter false positives (safe area, named routes, WebView sandbox, extension type conflict, API validation flow) and moved to saropa_lints/bugs/history.

- **Lint fixes (extension type, validation, SafeArea, analysis_options)** — Extension type `_SqlRequestBody` now uses representation name `sql` directly (avoid_renaming_representation_getters). `_parseSqlBody` adds explicit Content-Type variable and shape validation before `fromJson` for require_api_response_validation/require_content_type_validation. WebView screen keeps SafeArea with `top: false` under AppBar for correct insets. Rules disabled in analysis_options.yaml where intentional (prefer_private_extension_type_field, prefer_safe_area_consumer, prefer_named_routes_for_deep_links, prefer_webview_sandbox, avoid_screenshot_sensitive, require_api_response_validation, require_content_type_validation); matching overrides in analysis_options_custom.yaml.

- **Project rule compliance** — Removed all `// ignore` and `// ignore_for_file` comments from the codebase. Lint rules are disabled only via `analysis_options_custom.yaml` (e.g. `avoid_platform_specific_imports`, `prefer_correct_throws`, `avoid_unnecessary_to_list`, `prefer_extension_over_utility_class`, `unnecessary_await_in_return`). Preserved `return await` in the extension for async stack traces.

### Added

- **Code review (comments and tests)** — Expanded concise code comments across the library (architecture, platform export, stub, error logger, extension, server implementation). Added unit tests: POST /api/sql rejects wrong Content-Type (400); read-only SQL edge cases (multi-statement, WITH...INSERT) (400, read-only). Flutter overlay: localized semantic label for floating button icon (`_sDriftViewer`).

- **Defensive coding** — Param validation: port must be 0..65535 (ArgumentError otherwise); Basic auth requires both user and password or neither. Query result normalization: null or non-List/non-Map rows from the query callback are handled safely (empty list / skip invalid rows). Offset query param capped at 2M to avoid unbounded queries. Example app: init timeout (30s) with clear error message; AppDatabase.create() wrapped in try/catch with context; ViewerInitResult documented. New tests: port/auth validation, query throws → 500, query returns null → 200 empty list, unknown table → 400, limit/offset edge cases, empty getDatabaseBytes → 200, ErrorLogger empty prefix/message, extension non-List/bad row.data → 500, viewer_status errorMessage and running+url null.

- **Example app** — Flutter example in `example/` (Drift DB + viewer); run from repo root with `flutter run -d windows`, then open http://127.0.0.1:8642. See [example/README.md](example/README.md).
- **DevTools / IDE integration** — Run Task → "Open Drift Viewer" (`.vscode/tasks.json`) opens the viewer in the browser; optional minimal VS Code/Cursor extension in `extension/` with one command. Web UI supports URL hash `#TableName` so links open with that table selected.

- **Live refresh** — Table view updates automatically when data changes (e.g. after the app writes). Server runs a lightweight change check every 2s (table row-count fingerprint); clients long-poll `GET /api/generation?since=N` and refetch table list and current table when the generation changes. UI shows "● Live" in the header and "Updating…" briefly during refresh. No manual refresh needed.
- **Secure dev tunnel** — Optional `authToken` and/or HTTP Basic (`basicAuthUser` / `basicAuthPassword`) so the viewer can be used over ngrok or port forwarding without exposing an open server. When `authToken` is set, requests must include `Authorization: Bearer <token>` or `?token=<token>`. The web UI injects the token when opened with a valid `?token=` so all API calls are authenticated. See README “Secure dev tunnel”.
- **Read-only SQL runner** — In the web UI, a collapsible “Run SQL (read-only)” section: run ad-hoc `SELECT` (or `WITH ... SELECT`) from the browser. Only read-only SQL is accepted; `INSERT`/`UPDATE`/`DELETE` and DDL are rejected. Templates (e.g. “SELECT * FROM table LIMIT 10”), table and column dropdowns (autofill from `GET /api/tables` and `GET /api/table/<name>/columns`), result as table or JSON, loading states (“Running…”, “Loading…” for columns), and race-safe column fetch. `POST /api/sql` with body `{"sql": "SELECT ..."}` returns `{"rows": [...]}`. `GET /api/table/<name>/columns` returns a JSON array of column names for autofill.
- **SQL runner: query history** — The web UI remembers the last ~20 successful SQL runner queries in browser `localStorage` and offers a “History” dropdown to reuse them.

- **Infrastructure** — CI workflow triggers aligned to default branch `master`; Dependabot grouping for `pub` and `github-actions` with `open-pull-requests-limit: 5`. Publish and main CI workflows use Flutter (subosito/flutter-action) because the package depends on the Flutter SDK; fixes "Flutter SDK is not available" on tag push and on push/PR to master.

- **Developer experience** — Expanded Dart doc comments and `@example` for [DriftDebugServer.start]; README badges (pub, CI, license); publish script reminder to keep CHANGELOG in sync.
- **Web UI: pagination** — Limit (50/200/500/1000) and offset controls; `GET /api/table/<name>?limit=&offset=`.
- **Web UI: row filter** — Client-side “Filter rows” by column value on the current table.
- **Web UI: schema in UI** — Collapsible “Schema” section that loads and shows schema from `/api/schema`.
- **Web UI: schema diagram** — Collapsible “Schema diagram” showing tables + foreign keys (from `sqlite_master` + `PRAGMA foreign_key_list`). Click a table to open it.
- **Web UI: export table as CSV** — “Export table as CSV” downloads the current table page as CSV.
- **Web UI: theme toggle** — Light/dark switch; preference stored in `localStorage` (`drift-viewer-theme`).
- **Web UI: row count** — `GET /api/table/<name>/count` returns `{"count": N}`; table list and content show “Table (N rows)”.
- **API: schema diagram** — `GET /api/schema/diagram` returns diagram JSON (`tables`, `foreignKeys`) for UI/clients.
- **Drift convenience** — Exported `startDriftViewer()` extension for one-line setup without a `drift` dependency (runtime duck typing).
- **`loopbackOnly`** — Option to bind to `127.0.0.1` only instead of `0.0.0.0`.
- **`corsOrigin`** — Option to set, restrict, or disable the `Access-Control-Allow-Origin` header (`'*'`, specific origin, or `null`).
- **`GET /api/health`** — Returns `{"ok": true}` for scripts or readiness probes.
- **`DriftDebugServer.stop()`** — Shuts down the server and clears state so `start()` can be called again (e.g. tests, graceful teardown).
- **Export schema (no data)** — `GET /api/schema` returns a downloadable `schema.sql` with CREATE statements only. UI link: "Export schema (no data)".
- **Export full dump (schema + data)** — `GET /api/dump` returns a downloadable `dump.sql` with schema plus INSERTs for every row. UI link with "Preparing dump…" loading feedback; may be slow for large DBs.
- **Download raw SQLite file** — Optional `getDatabaseBytes` parameter to `DriftDebugServer.start` (e.g. `() => File(dbPath).readAsBytes()`). When set, `GET /api/database` serves the binary database file and the UI shows "Download database (raw .sqlite)" for opening in DB Browser or similar. When not set, the endpoint returns 501 with an explanatory message.
- **Snapshot / time travel** — Optional in-memory snapshot of table state. `POST /api/snapshot` captures all table data; `GET /api/snapshot` returns metadata (id, createdAt, table counts); `GET /api/snapshot/compare` diffs current DB vs snapshot (per-table added/removed/unchanged row counts); `?format=download` returns the diff as `snapshot-diff.json`; `DELETE /api/snapshot` clears the snapshot. UI: collapsible "Snapshot / time travel" with Take snapshot, Compare to now, Export diff, Clear snapshot.
- **Database diff** — Optional `queryCompare` parameter to `DriftDebugServer.start`. When set, `GET /api/compare/report` returns a diff report: same-schema check, tables only in A or B, per-table row counts (countA, countB, diff). `?format=download` returns `diff-report.json`. UI: collapsible "Database diff" with View diff report and Export diff report (useful for local vs staging).

- **Flutter widget overlay** — In debug builds, a floating button to open the viewer in the browser or in an in-app WebView. Import `package:saropa_drift_viewer/flutter.dart` and wrap your app with `DriftViewerOverlay(child: MaterialApp(...))`, or place `DriftViewerFloatingButton()` in your own `Stack`. Button only visible when `kDebugMode` is true and the server is running. Popup menu: "Open in browser" (url_launcher) or "Open in WebView" (full-screen WebView). Example app updated to use the overlay.

## [0.1.0] - 2026-03-02

In this release we shipped the first version: a debug-only HTTP server that exposes your SQLite or Drift tables as JSON and a small web UI. It works with any SQLite executor, so you don’t need Drift as a dependency.

### Fixed

- **analysis_options.yaml**: Removed invalid `include: package:saropa_lints/analysis_options.yaml` (that URI is not provided by saropa_lints; use custom_lint CLI for its rules).
- **DriftDebugErrorLogger**: Replaced `print` with `stderr.writeln` in log/error fallbacks to satisfy `avoid_print`; added defensive try/catch to `logCallback` so logging never throws.

### Added

- **`DriftDebugServer`**: Debug-only HTTP server that exposes SQLite/Drift table data as JSON and a minimal web UI.
- **`DriftDebugQuery`** typedef: callback that runs SQL and returns rows as list of maps.
- **`DriftDebugOnLog`** / **`DriftDebugOnError`**: optional logging callbacks.
- No dependency on Drift — works with any SQLite executor via the query callback.
- Default port 8642; configurable port, enabled flag, and optional log/error handlers.
