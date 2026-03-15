# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**pub.dev** — [pub.dev / packages / saropa_drift_advisor](https://pub.dev/packages/saropa_drift_advisor)

**VS Code marketplace** - [marketplace.visualstudio.com / items ? itemName=Saropa.drift-viewer](https://marketplace.visualstudio.com/items?itemName=Saropa.drift-viewer)

**Open VSX Registry** - [open-vsx.org / extension / saropa / drift-viewer](https://open-vsx.org/extension/saropa/drift-viewer)

Each version (and [Unreleased]) has a short commentary line in plain language—what this release is about for humans. Only discuss user-facing features; vary the phrasing.

---

## [1.3.4]

Export your database as a shareable, self-contained HTML report — open it in any browser with zero dependencies. Detects when queries slow down across debug sessions and alerts you before regressions become production issues.

### Added

- **Query Performance Regression Detector** — Tracks per-query performance baselines across debug sessions using exponential moving average. When a debug session ends, compares current query durations against historical baselines and shows a VS Code warning if any query exceeds the configurable threshold (default 2x slower). Baselines adapt over time (capped at 20 samples) and persist in workspace state. Configurable via `driftViewer.perfRegression.enabled` and `driftViewer.perfRegression.threshold`. Reset baselines via Command Palette: _Reset Query Performance Baseline_ (individual) or _Reset All Performance Baselines_.
- **Portable Snapshot Report** — Command palette → _Export Portable Report_: select tables, collect data with progress, save as a single HTML file. The report includes a table sidebar with row counts, paginated data view (50 rows/page), client-side search/filter, light/dark theme toggle, optional schema SQL and anomaly summary, and a generation timestamp footer. Configurable via `driftViewer.report.defaultMaxRows`, `.includeSchema`, `.includeAnomalies`. Tables with 10,000+ rows are auto-deselected. XSS-safe HTML escaping throughout. Also available as a toolbar icon in the Database Explorer view.
- **Schema Compliance Rules** — Define team-wide schema conventions in a `.drift-rules.json` config file. The extension validates the live database against naming conventions (snake_case, camelCase, PascalCase, UPPER_SNAKE for tables and columns), FK column naming patterns (`{table}_id`), required columns (with optional type enforcement and per-table exclusions), and four built-in structural rules: `no-text-primary-key`, `require-pk`, `max-columns`, `no-nullable-fk`. Violations appear as VS Code diagnostics on Dart table class files with severity overrides. Quick-fix actions to disable individual rules or open the config file. JSON Schema provides autocomplete and validation for `.drift-rules.json`. File watcher auto-refreshes diagnostics on config changes. Toggle via `driftViewer.diagnostics.categories.compliance`.

### Maintenance

- **Modularization (final 18 files)** — All 18 TypeScript source files that exceeded the 300-line quality gate are now within limits. Source splits: `api-client-sessions.ts` (session/import HTTP methods), `health-metrics-secondary.ts` (table-balance, schema-quality, recommendations), `data-narrator-describe.ts` (narrative description helpers), `import-history-format.ts` (entry formatting). Mock splits: `vscode-mock-diagnostics.ts`, `vscode-mock-extras.ts` (debug/extensions/tasks). Test helpers consolidated: `diagnostic-test-helpers.ts` shared across 3 provider tests; 5 test files split to extract utility/batch tests. Zero violations; all 1570 tests pass.

---

## [1.3.4]

Implemented a master switch to turn the extension off, and an “Add package to project” flow.

### Added

- **Master switch (driftViewer.enabled)** — Extension can be turned off entirely via Settings → Saropa Drift Advisor → **Enable** (`driftViewer.enabled`, default true). When false: no server discovery or connection, watcher stopped, status bar shows "Drift: Disabled", Database view shows a welcome with [Open Settings]. Toggling back on starts discovery (if enabled), watcher, and refreshes tree/codelens/diagnostics.
- **Add package to project** — Installing the extension should install the package, and vice versa. Command **Saropa Drift Advisor: Add package to project** adds `saropa_drift_advisor` to the project’s `pubspec.yaml` (dependencies) and runs `dart pub get` / `flutter pub get`. Welcome view (when no server connected) includes [Add package to project]; command also in Command Palette and Database Explorer view.

### Maintenance

- **Modularization (Phases 6–7 and remaining files)** — Health scorer split into `health-metrics.ts` (all 6 metric scorers) and slim `health-scorer.ts`; test fixtures under `test/fixtures/health-test-fixtures.ts` and health tests split into `health-scorer-grade.test.ts`, `health-panel.test.ts`, `health-scorer.test.ts`. Clipboard import: `clipboard-import-actions.ts` (validation/import flow, `executeImportFlow`), `checkSchemaFreshnessForImport` in schema-freshness; panel under 300 lines. Debug commands split into `debug-commands-types.ts`, `debug-commands-perf.ts`, `debug-commands-panels.ts`, `debug-commands-vm.ts` with slim orchestrator. Import: `import-sql-helpers.ts` (`escapeSqlValue`, `findExistingRow`, `insertRow`, `updateRow`); `import-executor.ts` under 300 lines. Engines: `relationship-engine-cache.ts` (TTL-cached FK/schema fetchers); `relationship-engine.ts` under 300 lines. `api-client.ts` trimmed. Aligns with `plans/modularization-plan.md`; no source file exceeds 300 lines except api-client (301).
- **Pub.dev score checks in publish script** — The Dart publish pipeline (`python scripts/publish.py dart`) now runs pub.dev score verification: downgrade check (`flutter pub downgrade` then `flutter analyze lib/`), restore with `flutter pub upgrade`, then outdated check (`dart pub outdated --no-dev-dependencies --no-dependency-overrides`). Ensures lower-bound compatibility and up-to-date constraints before publish. Plan 68 (fix pub score) archived to `plans/history/20250314/fix-pub-score.md`.

---

## [1.3.2]

Health Score, schema linter, and timeline now work over the VM Service—so you can use them on an emulator without HTTP.

### Added

- **Extension entry point modularization (Batch 5)** — `extension.ts` split into focused setup modules: `extension-providers.ts` (tree, language, file decoration providers), `extension-diagnostics.ts` (diagnostic manager and disable/clear/copy commands), `extension-editing.ts` (change tracker, editing bridge, pending changes), `extension-commands.ts` (all command registration). Main `extension.ts` stays ~125 lines; activate/deactivate orchestrate setup in sequence. Aligns with modularization plan Phase 5.
- **Index suggestions over VM Service (Plan 68)** — When connected via VM only (e.g. emulator debug), Health Score, health commands, schema linter, and timeline no longer fail: `indexSuggestions()` now uses VM RPC `getIndexSuggestions`. Dart: `AnalyticsHandler.getIndexSuggestionsList()` + `Router.getIndexSuggestionsList()` + `VmServiceBridge` handler; extension: `VmServiceClient.getIndexSuggestions()`, `DriftApiClient` VM branch; HTTP response parsing fixed for `{ suggestions, tablesAnalyzed }` shape.
- **Stale override checker script** — `scripts/check_stale_overrides.py` classifies `dependency_overrides` as required vs stale by running a version solve with each override removed. Addresses false positives from tools that report overrides as "safe to remove" without re-solving (see `bugs/history/20260313/stale_override_false_positive.md`). Unit tests in `scripts/tests/test_check_stale_overrides.py`.

### Changed

- **Connection log disposal** — Output channel "Saropa Drift Advisor" is now registered in `context.subscriptions` so it is disposed on deactivate.

---

## [1.2.0]

Debug sessions can connect over the Dart VM Service instead of HTTP—no port forwarding or discovery needed when you’re already debugging.

### Added

- **VM Service as debug channel (Plan 68)** — When a Dart or Flutter debug session is active, the extension tries to connect via the Dart VM Service WebSocket (same channel as the debugger) instead of HTTP port discovery. No adb forward or port scan needed on emulators: connection “just works” when debugging. The app registers `ext.saropa.drift.*` RPCs (getHealth, getSchemaMetadata, getTableFkMeta, runSql) that mirror the HTTP API; the extension uses them when the VM Service URI is available from the debug session. HTTP and discovery remain for “Open in browser” and when not debugging.
- **VM Service nice-to-haves** — Status bar shows "VM Service" when connected via VM; hot restart clears VM state and refreshes UI (no stuck state); panel and "Open in browser" show a clear fallback/info message when only VM is reachable (no HTTP); performance, anomalies, and explain SQL work over VM; unit tests for `parseVmServiceUriFromOutput`; Plan 68 doc updated with manual test steps.
- **Connection robustness (Plan 68)** — VM Service URI validated before connect; **Output > Saropa Drift Advisor** logs connection attempts, success, and failure reasons; after hot restart, next VM URI from debug output auto-retriggers connect; welcome view points to Output for troubleshooting when debugging Flutter/Dart.

### Fixed

- **Anomaly scan (HTTP)** — Extension now calls `/api/analytics/anomalies` (matches server) and accepts both `{ anomalies: [...] }` and array responses.

---

## [1.3.0]

Android emulator users get automatic port forwarding when debugging, so the extension can reach the Drift server inside the emulator.

### Added

- **Android emulator connection** — When no Drift server is found and a Flutter/Dart debug session is active, the extension automatically runs `adb forward tcp:8642 tcp:8642` (or the configured port) and retries discovery so the host can reach the server running inside the emulator. Throttled to one attempt per 60 seconds per workspace.
- **Forward Port (Android Emulator) command** — Manual command and welcome-view link to run `adb forward` and retry discovery. Shows a progress notification while forwarding. Useful when auto-forward did not run or failed (e.g. adb not on PATH).

### Changed

- **Disconnected welcome view** — Troubleshooting now includes Android emulator: explains that the extension will try to forward the port automatically when debugging, and offers the Forward Port (Android Emulator) action and the manual `adb forward` command. Corrected server setup wording to `startDriftViewer()` / `DriftDebugServer.start()`.

---

## [1.0.4]

No user-visible changes; changelog order corrected.

### Fixed

- The changelog now has the correct version sequence

---

## [1.1.0]

A welcome screen when disconnected and richer VS Code Marketplace metadata—smoother first run and easier to find the extension.

### Added

- **Disconnected Welcome View** — When no Drift debug server is connected, the Database panel now shows a helpful welcome screen instead of a bare "Disconnected" message. Includes troubleshooting checklist (app running, DriftDbViewer initialized, port config, firewall), action buttons (Retry Connection, Select Server), and resource links (Getting Started guide, Report Issue). Uses VS Code's native viewsWelcome API for consistent styling.

### Changed

- **VS Code Marketplace metadata** — Added rich marketplace metadata: categories (Debuggers, Visualization), 15 searchable keywords (dart, drift, flutter, sqlite, database, orm, schema, debug, visualization, data viewer, moor, query, sql, table viewer, database explorer), homepage link, issues link, and gallery banner. The extension listing now shows Project Details with GitHub activity, and Resources links to Issues, Repository, Homepage, License, and Changelog.
- **Dependabot Configuration** — `.github/dependabot.yaml` extended to keep npm dependencies up to date; weekly schedule with grouped minor/patch updates for both root and extension directories.

---

## [1.0.1]

Clipboard import, interactive ER diagrams, data stories, custom dashboards, and invariant checking—a big feature drop.

### Fixed

- **VS Code extension test isolation** — Fixed missing mock methods in `vscode-mock.ts` (`workspace.onDidSaveTextDocument`, `workspace.onDidChangeTextDocument`, `statusBarItem.hide()`) that caused test cascade failures when running the full test suite via CLI. Tests passed individually in Test Explorer but failed in batch due to incomplete stub cleanup when `beforeEach` threw.

### Added

- **Clipboard Import** — Paste tabular data from Excel, Google Sheets, or CSV directly into any database table. Right-click a table and select "Paste from Clipboard". Auto-detects format (TSV, CSV, HTML tables), auto-maps columns by name, and shows a preview before import. Four import strategies: Insert only, Skip conflicts, Upsert (insert or update), and Dry run (preview without changes). Pre-import validation checks types, NOT NULL constraints, and foreign key references. All imports run in transactions with automatic rollback on failure. Full undo support—revert any import from history. Schema freshness checking warns if table structure changed since you copied data.
- **ER Diagram** — Auto-generate an interactive entity-relationship diagram from the live schema. Tables render as boxes with column lists (PK with 🔑, FK with 🔗), relationships as connecting arrows. Three layout modes: Auto (force-directed), Hierarchical (parent tables on top), and Clustered (grouped by FK relationships). Drag tables to rearrange, zoom with scroll wheel, pan by dragging canvas. Right-click a table for quick actions (View Data, Seed, Profile). Export to SVG or Mermaid markdown. Auto-refreshes when schema changes. Access via Command Palette or the tree view title bar icon.
- **Data Story Narrator** — Right-click any table and select "Tell This Row's Story" to generate a human-readable narrative that follows FK relationships. Enter a primary key value and see a paragraph-style description: the root entity with notable columns, parent relationships ("Belongs to User Alice via user_id"), and child relationships ("Has 3 orders: ..."). Supports truncated results for large datasets, detects name columns automatically (name, title, email, etc.), and outputs both plain text and Markdown. Copy narrative to clipboard or regenerate. Loading spinner and error states included.
- **Custom Dashboard Builder** — Drag-and-drop dashboard with resizable widget tiles. Choose from 10+ widget types (row counts, health score, query stats, anomaly list, etc.). Save/load named layouts per workspace. Real-time data via the shared API client.
- **Data Invariant Checker** — Define SQL-based invariants (e.g. "user.email must be unique", "order.total > 0") and run them on demand or continuously. Violations surface as VS Code diagnostics with severity levels. Invariant templates for common patterns (uniqueness, referential integrity, range checks).
- **Centralized Diagnostic Manager** — Unified diagnostic pipeline that merges schema linter, anomaly detection, and invariant violations into a single Problems panel view with consistent severity mapping and quick-fix actions.
- **Health Score + Pre-Launch Integration** — The pre-launch health check task now computes and displays the overall health grade (A+–F) with per-metric breakdown. Terminal output includes clickable "View Health Score Dashboard" link.
- **Quick Actions for Health Metrics** — Health Score dashboard cards are now clickable. Index coverage opens the Query Cost Analyzer with suggestions; anomaly count opens the anomaly scan panel.
- **Profile-Informed Seeding** — Test data seeder uses column profiling stats (min/max, patterns, distributions) to generate more realistic fake data that matches your actual data characteristics.

## [0.4.1]

Database health score, query cost analysis with index suggestions, saved filters, and row impact analysis—analytics and insights land here.

### Added

- **Database Health Score** — Overall database health grade (A+–F) computed from six weighted metrics: index coverage, FK integrity, null density, query performance, table balance, and schema quality. Webview dashboard with color-coded cards, per-metric scores, and actionable recommendations.
- **Query Cost Analyzer** — Run any SQL query and see its execution plan visualized as a color-coded tree. Highlights full table scans, missing indexes, and temporary sorts. Suggests CREATE INDEX statements based on WHERE, JOIN, and ORDER BY analysis. Click "Run" to create an index and re-analyze to see the improvement. Access via Command Palette: "Saropa Drift Advisor: Analyze Query Cost".
- **Saved Filters** — Save named filter/sort/column-visibility configurations per table and switch between them instantly. A sticky toolbar in the data panel provides a dropdown of saved filters with Apply, Save As, Clear, and Delete controls. Filters persist in workspace state and execute via the existing SQL endpoint.
- **Row Impact Analysis** — Right-click any table and select "Analyze Row Impact" to see what breaks if you delete a row. Shows outbound dependencies (parents), inbound dependents grouped by table with counts, cascade delete summary, and generates safe DELETE SQL in correct FK order.

## [0.4.0]

Smaller bundle for apps that ship the package: in-app Flutter overlay removed; use the VS Code extension or browser instead.

### Removed

- **In-app Flutter overlay** — Removed `DriftViewerOverlay`, `DriftViewerFloatingButton`, and `lib/flutter.dart`. The VS Code extension and browser already provide the same functionality without shipping native code in consumer APKs.
- **6 dependencies** — Removed `webview_flutter`, `webview_flutter_android`, `url_launcher`, `intl`, `meta`, `collection`, and the `flutter` SDK dependency. The package is now pure Dart with a single dependency (`crypto`).

### Added

- Marketplace icon for the VS Code extension (128×128 database + delta symbol with pink-to-cyan gradient).
- View-level icons for Schema Search, Database, Pending Changes, and Drift Queries sidebar entries.

### Changed

- Added MIT license for Open VSX release.
- Refactored extension source to enforce 300-line file limit: split `extension.ts` (1359→300 lines) into 9 command modules plus a status-bar utility, split `vscode-mock.ts` (719→299 lines) into 3 files, extracted `seeder-html-shell.ts` from `seeder-html.ts`, and extracted shared test fixtures from 7 test files.
- Renamed all user-facing display text from "Drift Viewer" to "Saropa Drift Advisor" across extension commands, activity bar, status bar, generated code comments, documentation, and example app.

## [0.3.0]

Package renamed to `saropa_drift_advisor`—update `pubspec.yaml` and imports; APIs are unchanged. Also: visual query builder, smarter data formatting, per-table state, and one-click cell copy.

### Added

- **VS Code extension: Isar-to-Drift schema generator** — Convert Isar `@collection` classes to Drift table definitions. Scan the workspace to auto-discover all `@collection` / `@embedded` files, or manually pick Dart source files or Isar JSON schema exports. The parser extracts collections, embedded objects, links, indexes, and enum fields. Type mapper converts Isar types to Drift column types, generates foreign key columns for `IsarLink`, junction tables for `IsarLinks`, and supports configurable strategies for embedded objects (JSON serialization or column flattening) and enums (ordinal int or name text). Interactive webview panel shows a live preview of the generated Drift code with options to copy, open as editor tab, or save to file. New files: `isar-gen/isar-gen-types.ts`, `isar-gen/isar-parser.ts`, `isar-gen/isar-json-parser.ts`, `isar-gen/isar-type-mapper.ts`, `isar-gen/isar-drift-codegen.ts`, `isar-gen/isar-gen-panel.ts`, `isar-gen/isar-gen-html.ts`, `isar-gen/isar-gen-commands.ts`, `isar-gen/isar-workspace-scanner.ts`.

- **VS Code extension: Pre-launch health check tasks** — Register VS Code tasks ("Drift: Health Check", "Drift: Anomaly Scan", "Drift: Index Coverage") that can be wired into `launch.json` as `preLaunchTask` to automatically scan for database issues every time you press F5. Tasks use `CustomExecution` with a `Pseudoterminal` for formatted terminal output showing connection status, index coverage gaps, and data anomalies with severity icons. Exit code 1 blocks launch when errors are found; warnings pass by default (configurable via `driftViewer.tasks.blockOnWarnings`). A `drift-health` problem matcher routes task output to the Problems panel. New API client methods: `indexSuggestions()`, `anomalies()`. New files: `tasks/drift-task-provider.ts`, `tasks/health-check-runner.ts`.

- **VS Code extension: Peek / Go to Definition for SQL names** — Place the cursor on a table or column name inside a raw SQL string in Dart code, then press Alt+F12 (Peek Definition) or F12 (Go to Definition) to jump to the corresponding Drift table class or column getter. Table names are resolved via snake_case-to-PascalCase conversion (e.g. `users` → `class Users extends Table`), and column names match both snake_case and camelCase getters (e.g. `created_at` → `get createdAt`). Schema metadata is cached from the API with 30-second TTL and auto-cleared on generation changes. New files: `definition/drift-definition-provider.ts`, `definition/sql-string-detector.ts`.

- **VS Code extension: CodeLens on Drift table classes** — Inline annotations appear above `class ... extends Table` definitions in Dart files. Each table class shows a live row count from the running server (e.g. "42 rows"), a "View in Saropa Drift Advisor" action that opens the webview panel, and a "Run Query" action that executes `SELECT *` and opens the results as JSON in a side editor. Row counts update automatically via the generation watcher. When the server is offline, lenses show "not connected". Dart PascalCase class names are mapped to SQL snake_case table names with case-insensitive fallback. New files: `codelens/drift-codelens-provider.ts`, `codelens/table-name-mapper.ts`. New commands: `driftViewer.viewTableInPanel`, `driftViewer.runTableQuery`.

- **VS Code extension: Query Performance Panel in Debug sidebar** — Live-updating tree panel appears in the Run & Debug sidebar during active Dart debug sessions when the Drift server is connected. Shows aggregate stats (query count, total/avg duration), slow queries (>500ms with flame icon, >100ms with watch icon), and recent queries in collapsible categories. Click any query to view full SQL with duration, row count, and timestamp in a readonly editor. Auto-refreshes every 3 seconds (configurable via `driftViewer.performance.refreshIntervalMs`). Panel visibility controlled by compound `when` clause (`inDebugMode && driftViewer.serverConnected`) with server health check on debug session start. Toolbar buttons for manual refresh and clearing stats. Concurrency guard prevents overlapping refresh calls. New files: `debug/performance-items.ts`, `debug/performance-tree-provider.ts`. New commands: `driftViewer.refreshPerformance`, `driftViewer.clearPerformance`, `driftViewer.showQueryDetail`. New settings: `driftViewer.performance.slowThresholdMs`, `driftViewer.performance.refreshIntervalMs`.

- **VS Code extension: Saropa Log Capture integration** — Optional bridge to the Saropa Log Capture extension for unified log timeline visibility. When `saropa.saropa-log-capture` is installed, registers as an integration provider contributing session-start headers (server URL, slow threshold) and session-end summaries (query stats, top slow queries). Connection lifecycle events are written via `writeLine()`. Supports three verbosity modes via `driftViewer.performance.logToCapture` setting: `off`, `slow-only` (default), and `all`. No hard dependency — all methods are no-ops when the extension is absent. New file: `debug/log-capture-bridge.ts`.

- **Web UI: visual query builder** — Collapsible "Query builder" section appears below table metadata when viewing any table. Build SQL queries visually with SELECT column checkboxes, type-aware WHERE clause builder (text: contains/equals/starts-with; numeric: comparison operators; blob: null checks only), ORDER BY column/direction picker, and LIMIT control. Live SQL preview updates as selections change. "Run query" executes via `POST /api/sql` with loading state feedback; "Reset to table view" returns to raw data. Query builder state is persisted per table via localStorage. Column types sourced from existing `/api/schema/metadata` endpoint — no new server endpoints.
- **Web UI: copy cell to clipboard** — Hover over any data table cell to reveal a copy button. Click copies the raw cell value via `navigator.clipboard.writeText()` with a brief "Copied!" toast notification (auto-dismisses after 1.2s). Works alongside FK navigation links without interference (copy button uses `stopPropagation`). Copy buttons are preserved during search highlighting.
- **Web UI: filter state caching per table** — Table view state (row filter text, pagination limit/offset, display format preference, query builder configuration) is automatically saved to localStorage when switching tables and restored when returning. "Clear state" button in the pagination bar resets all cached state for the current table. localStorage key pattern: `drift-viewer-table-state-{tableName}`.
- **Web UI: data type display toggle** — "Display: Raw / Formatted" dropdown in the table toolbar toggles between raw SQLite values and human-readable formatting. Epoch timestamps (seconds or milliseconds after year 2000) in date-named columns display as ISO 8601 strings. Integer 0/1 in boolean-named columns (`is_*`, `has_*`, `*_enabled`, etc.) display as `true`/`false`. Formatted cells show the raw value below in muted text and in the tooltip, both individually copyable. Preference is saved per table as part of filter state caching.

---

## [0.2.4]

Charts, natural-language queries, anomaly detection, session sharing, and a query performance monitor—the web UI gets a serious upgrade.

### Added

- **Collaborative debug sessions** — Share the current viewer state (selected table, SQL query, filters, pagination) as a URL. Click the "Share" button in the header, optionally add a note, and the URL is copied to the clipboard. Teammates open the URL to see the exact same view with an info bar and any text annotations. Server stores sessions in memory with 1-hour auto-expiry and a 50-session cap. Three new endpoints: `POST /api/session/share`, `GET /api/session/{id}`, `POST /api/session/{id}/annotate`. Session business logic is extracted into a dedicated `DriftDebugSessionStore` class (`lib/src/drift_debug_session.dart`) for clean separation from HTTP handling. Client-side JS is modularized into seven named functions for state capture, clipboard handling, UI restoration, and annotation rendering.
- **Web UI: SQL bookmarks** — Save, name, and organize frequently used SQL queries. Bookmarks persist in `localStorage` and appear in a dropdown below the history selector. Save current query with a custom name, delete selected bookmarks, export all as JSON for version control, and import from JSON with automatic deduplication. Purely client-side — no server changes.
- **Web UI: EXPLAIN QUERY PLAN viewer** — "Explain" button next to Run in the SQL runner. Sends `POST /api/sql/explain` to visualize SQLite's query execution plan as an indented tree. Full table scans are highlighted red with a warning; index lookups are highlighted green. Read-only SQL validation is enforced before explaining. Server handler reuses shared body-reading/validation helper (`_readAndValidateSqlBody`) to avoid duplication with the Run SQL handler. Run and Explain buttons disable each other during requests to prevent race conditions.
- **Web UI: data charts** — Bar, pie, line/time-series, and histogram charts rendered as inline SVG from SQL query results. Chart type selector, X/Y axis pickers, and Render button appear after SQL results. Large datasets (>500 rows) are automatically sampled for SVG performance. Pie chart groups slices below 2% into "Other" and handles single-slice (100%) rendering. All chart colors use CSS variables for theme support. Zero new dependencies (pure inline SVG).
- **Web UI: natural language to SQL** — "Ask in English" input converts plain English questions (e.g. "how many users", "latest 5 orders", "average price") to SQL via pattern matching. New `GET /api/schema/metadata` endpoint provides table names, column names/types, primary keys, and row counts. Schema metadata is cached client-side. Supports count, average, sum, min/max, distinct, latest/oldest, and group-by patterns. Converted SQL is editable before running. No external API keys or dependencies.
- **Web UI: interactive table relationships** — Click any foreign key value in the data table to navigate directly to the referenced row in the parent table. New `GET /api/table/{name}/fk-meta` endpoint returns FK metadata from `PRAGMA foreign_key_list`. FK columns display an arrow icon (↗) in the header and values render as clickable links (→). Navigation breadcrumb trail tracks the path through tables with a Back button. FK metadata is cached per table. Loading indicator shown during first FK fetch. Data renders as an HTML table (replacing JSON `<pre>` blocks) in all view modes. Zero new dependencies.
- **Web UI: data anomaly detection** — One-click "Scan for anomalies" analyzes all tables for data quality issues: NULL values in nullable columns (with percentage), empty strings in text columns, orphaned foreign key references, duplicate rows, and numeric outliers (max > 10× average). Results display as a severity-coded list (error/warning/info) with colored border indicators. Server-side analysis via `GET /api/analytics/anomalies` using pure SQL heuristics — no AI/ML dependencies. Table row count is cached per-table to avoid redundant queries. Five modular detection methods keep the handler clean.
- **Web UI: data import (debug only)** — Import CSV, JSON, or SQL files into any table during debug sessions via `POST /api/import`. Opt-in: requires passing the new `DriftDebugWriteQuery` callback to `DriftDebugServer.start()`; returns 501 if not configured. Collapsible UI section with table selector, format selector, file picker with preview, and confirmation dialog. Auto-detects format from file extension. Per-row error reporting with partial import support. Import logic extracted into modular `DriftDebugImportProcessor` class (`lib/src/drift_debug_import.dart`) and `DriftDebugImportResult` value class (`lib/src/drift_debug_import_result.dart`). CSV parser handles quoted fields, escaped quotes, CR+LF line endings, and UTF-8 BOM. Column names are SQL-escaped to prevent injection. Live-refresh triggers immediately after import via generation bump.
- **Web UI: live query performance monitor** — Track execution time of every SQL query passing through the debug server. Collapsible "Query performance" panel with Refresh and Clear buttons. `GET /api/analytics/performance` returns summary stats (total queries, total/avg duration), slow queries (>100ms, top 20 sorted by duration), query patterns (grouped by first 60 chars, top 20 by total time), and recent queries (last 50). `DELETE /api/analytics/performance` clears the timing buffer. Query callback is wrapped with `Stopwatch` at `start()` so all queries (including internal ones) are timed automatically. 500-entry ring buffer with automatic eviction. Color-coded durations in the UI (red >100ms, orange >50ms). Auto-fetches data on first expand. `QueryTiming` data class in `server_types.dart`; route constants in `server_constants.dart`; JS in `html_content.dart`.

### Fixed

- **Mixin corruption** — Removed JavaScript `initPerformance` code that was accidentally inserted into the `DriftDebugServer.start()` Dart parameter list across multiple prior commits, causing analyzer errors.

## [0.2.3]

No user-facing changes; tooling and documentation updates.

### Fixed

- CI workflow: trigger branch changed from `master` to `main` to match the repository default branch; PRs and pushes now correctly run CI.
- Static analysis: added curly braces to three bare `if`-body statements in `drift_debug_server_io.dart` (lint: `always_put_control_body_on_new_line`).
- Static analysis: wrapped three doc-comment URL paths containing angle brackets in backticks to prevent HTML interpretation (lint: `unintended_html_in_doc_comment`).
- Dependency lower bounds: bumped `webview_flutter` from `^4.12.0` to `^4.13.0` so the minimum version includes `onSslAuthError`/`SslAuthError` (added in 4.13.0), fixing the downgrade analysis failure.

### Changed

- Added a banner image to the [README](/README.md)
- Publish tooling: `scripts/publish.py` now checks whether the package already exists on pub.dev before offering a local `dart pub publish` for first-time publishes.
- CI workflow: removed the one-time \"Add uploader\" workflow and inline step; maintainers can use `dart pub uploader` or the pub.dev UI directly when needed.
- Tooling docs: clarified in `analysis_options.yaml` comments that saropa_lints 6.x does not provide `analysis_options.yaml` as an include target.
- Upgraded `saropa_lints` from 6.2.2 to 8.0.7 (professional tier: 1649 → 1666 rules enabled).

## [0.2.2]

No user-facing changes; package metadata corrected.

### Changed

- Bump for release.

## [0.2.1]

No user-facing changes; CHANGELOG link updated for the repo.

### Changed

- CHANGELOG: link to GitHub until package was on pub.dev.

## [0.2.0]

Viewer gets more useful day to day: live table refresh, read-only SQL from the browser, and optional token or Basic auth for dev tunnels. Plus schema diagram, CSV export, snapshot/time travel, and a Flutter overlay to open the viewer from your app.

### Fixed

- **Lint and validation** — DriftDebugServer singleton uses nullable backing field + getter (no `late`) for avoid_late_keyword. POST /api/sql checks Content-Type before decoding; body decode/validation in `_parseSqlBody` (require_content_type_validation, require_api_response_validation). WebView route: `buildWebViewRoute` uses `Uri.tryParse` and allows only http/https; invalid URLs show a localized error screen with overflow-safe text. Load errors in WebView logged via `_logLoadError` in debug. POST /api/sql rejects non-`application/json` Content-Type with 400; unit test added. Bug reports filed for linter false positives (safe area, named routes, WebView sandbox, extension type conflict, API validation flow) and moved to saropa_lints/bugs/history.

- **Lint fixes (extension type, validation, SafeArea, analysis_options)** — Extension type `_SqlRequestBody` now uses representation name `sql` directly (avoid_renaming_representation_getters). `_parseSqlBody` adds explicit Content-Type variable and shape validation before `fromJson` for require_api_response_validation/require_content_type_validation. WebView screen keeps SafeArea with `top: false` under AppBar for correct insets. Rules disabled in analysis_options.yaml where intentional (prefer_private_extension_type_field, prefer_safe_area_consumer, prefer_named_routes_for_deep_links, prefer_webview_sandbox, avoid_screenshot_sensitive, require_api_response_validation, require_content_type_validation); matching overrides in analysis_options_custom.yaml.

- **Project rule compliance** — Removed all `// ignore` and `// ignore_for_file` comments from the codebase. Lint rules are disabled only via `analysis_options_custom.yaml` (e.g. `avoid_platform_specific_imports`, `prefer_correct_throws`, `avoid_unnecessary_to_list`, `prefer_extension_over_utility_class`, `unnecessary_await_in_return`). Preserved `return await` in the extension for async stack traces.

### Added

- **Code review (comments and tests)** — Expanded concise code comments across the library (architecture, platform export, stub, error logger, extension, server implementation). Added unit tests: POST /api/sql rejects wrong Content-Type (400); read-only SQL edge cases (multi-statement, WITH...INSERT) (400, read-only). Flutter overlay: localized semantic label for floating button icon (`_sDriftViewer`).

- **Defensive coding** — Param validation: port must be 0..65535 (ArgumentError otherwise); Basic auth requires both user and password or neither. Query result normalization: null or non-List/non-Map rows from the query callback are handled safely (empty list / skip invalid rows). Offset query param capped at 2M to avoid unbounded queries. Example app: init timeout (30s) with clear error message; AppDatabase.create() wrapped in try/catch with context; ViewerInitResult documented. New tests: port/auth validation, query throws → 500, query returns null → 200 empty list, unknown table → 400, limit/offset edge cases, empty getDatabaseBytes → 200, ErrorLogger empty prefix/message, extension non-List/bad row.data → 500, viewer_status errorMessage and running+url null.

- **Example app** — Flutter example in `example/` (Drift DB + viewer); run from repo root with `flutter run -d windows`, then open http://127.0.0.1:8642. See [example/README.md](example/README.md).
- **DevTools / IDE integration** — Run Task → "Open Saropa Drift Advisor" (`.vscode/tasks.json`) opens the viewer in the browser; optional minimal VS Code/Cursor extension in `extension/` with one command. Web UI supports URL hash `#TableName` so links open with that table selected.

- **Live refresh** — Table view updates automatically when data changes (e.g. after the app writes). Server runs a lightweight change check every 2s (table row-count fingerprint); clients long-poll `GET /api/generation?since=N` and refetch table list and current table when the generation changes. UI shows "● Live" in the header and "Updating…" briefly during refresh. No manual refresh needed.
- **Secure dev tunnel** — Optional `authToken` and/or HTTP Basic (`basicAuthUser` / `basicAuthPassword`) so the viewer can be used over ngrok or port forwarding without exposing an open server. When `authToken` is set, requests must include `Authorization: Bearer <token>` or `?token=<token>`. The web UI injects the token when opened with a valid `?token=` so all API calls are authenticated. See README “Secure dev tunnel”.
- **Read-only SQL runner** — In the web UI, a collapsible “Run SQL (read-only)” section: run ad-hoc `SELECT` (or `WITH ... SELECT`) from the browser. Only read-only SQL is accepted; `INSERT`/`UPDATE`/`DELETE` and DDL are rejected. Templates (e.g. “SELECT \* FROM table LIMIT 10”), table and column dropdowns (autofill from `GET /api/tables` and `GET /api/table/<name>/columns`), result as table or JSON, loading states (“Running…”, “Loading…” for columns), and race-safe column fetch. `POST /api/sql` with body `{"sql": "SELECT ..."}` returns `{"rows": [...]}`. `GET /api/table/<name>/columns` returns a JSON array of column names for autofill.
- **SQL runner: query history** — The web UI remembers the last ~20 successful SQL runner queries in browser `localStorage` and offers a “History” dropdown to reuse them.

<!-- cspell:ignore subosito -->

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

## [0.1.0]

First release: a debug-only HTTP server that exposes your SQLite or Drift tables as JSON and a small web UI. Works with any SQLite executor—no Drift dependency required.

### Fixed

- **analysis_options.yaml**: Removed invalid `include: package:saropa_lints/analysis_options.yaml` (that URI is not provided by saropa_lints; use custom_lint CLI for its rules).
- **DriftDebugErrorLogger**: Replaced `print` with `stderr.writeln` in log/error fallbacks to satisfy `avoid_print`; added defensive try/catch to `logCallback` so logging never throws.

### Added

- **`DriftDebugServer`**: Debug-only HTTP server that exposes SQLite/Drift table data as JSON and a minimal web UI.
- **`DriftDebugQuery`** typedef: callback that runs SQL and returns rows as list of maps.
- **`DriftDebugOnLog`** / **`DriftDebugOnError`**: optional logging callbacks.
- No dependency on Drift — works with any SQLite executor via the query callback.
- Default port 8642; configurable port, enabled flag, and optional log/error handlers.
