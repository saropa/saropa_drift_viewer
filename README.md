![Saropa Drift Advisor - SQLite/Drift](https://raw.githubusercontent.com/saropa/saropa_drift_advisor/main/assets/banner_v2.png)

<!-- # Saropa Drift Advisor -->

[![pub package](https://img.shields.io/pub/v/saropa_drift_advisor.svg)](https://pub.dev/packages/saropa_drift_advisor)
[![CI](https://github.com/saropa/saropa_drift_advisor/actions/workflows/main.yaml/badge.svg)](https://github.com/saropa/saropa_drift_advisor/actions/workflows/main.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Debug-only HTTP server + VS Code extension for inspecting SQLite/Drift databases in Flutter and Dart apps. Two ways to access your data — a browser-based web UI and a full-featured VS Code extension with IDE integration.

---

## How it works

Your app runs a lightweight debug server that exposes database tables over HTTP. You inspect the data using either a **browser** or the **VS Code extension** — both connect to the same server.

| | Browser | VS Code Extension |
|---|---|---|
| **Install** | None — open `localhost:8642` | Install from Marketplace |
| **Works with** | Any editor, CI, QA, mobile | VS Code / Cursor |
| **Best for** | Quick look, sharing URLs | Daily development workflow |

---

## Features

### HTTP Debug Server (core)

The Dart package starts a lightweight HTTP server that exposes your database over a REST API.

#### Data Browsing

- **Table list** with row counts
- **View rows** as JSON with pagination (limit/offset)
- **Client-side row filter** search
- **Foreign key navigation** — click FK values to jump to the referenced row, with breadcrumb trail
- **Data type display toggle** — raw SQLite values or human-readable (epoch → ISO 8601, 0/1 → true/false)
- **One-click cell copy** on hover with toast notification

#### Query Tools

- **Read-only SQL runner** with table/column autocomplete, templates, and query history
- **SQL bookmarks** — save, name, export/import as JSON
- **Visual query builder** — SELECT checkboxes, type-aware WHERE clauses, ORDER BY, LIMIT, live SQL preview
- **Natural language → SQL** — English questions (count, average, latest, group-by) converted via pattern matching
- **EXPLAIN QUERY PLAN** — color-coded tree (red = table scans, green = index lookups)

#### Data Visualization

- **Charts** — bar, pie, line/time-series, histogram from SQL results (pure inline SVG)
- **Data anomaly detection** — NULLs, empty strings, orphaned FKs, duplicates, numeric outliers with severity icons

#### Schema & Export

- **Collapsible schema** panel with CREATE statements
- **ER diagram** — tables and FK relationship lines; click to navigate
- **Export** — CSV per table, schema-only SQL, full dump (schema + data), raw SQLite file

#### Snapshots & Comparison

- **Snapshot / time travel** — capture all table state, compare to current, export diff as JSON
- **Database comparison** — diff vs another DB (schema match, row counts, migration preview DDL)

#### Live Features

- **Live refresh** via long-poll (`GET /api/generation`) when data changes
- **Collaborative sessions** — share viewer state as a URL with annotations (1-hour expiry, 50-session cap)

#### Data Import (opt-in)

- **Import** CSV, JSON, or SQL files into tables (requires `DriftDebugWriteQuery` callback)
- Auto-detect format, per-row error reporting, partial import support

#### Performance & Analytics

- **Query performance stats** — total queries, slow queries (>100 ms), patterns, recent queries
- **Storage size analytics** — table sizes, indexes, journal mode

#### Server Configuration

- **Port** — default 8642; configurable
- **Bind** — `0.0.0.0` by default; `loopbackOnly: true` for `127.0.0.1` only
- **CORS** — `'*'`, specific origin, or disabled
- **Auth** — optional Bearer token or HTTP Basic for dev tunnels
- **Health** — `GET /api/health` → `{"ok": true}`

#### Theme

- **Light/dark toggle** saved in localStorage

---

### Flutter Overlay (optional)

- **Floating button** in debug builds to open the viewer
- **Opens in browser** (url_launcher) or **in-app WebView** (webview_flutter)
- Customizable alignment and margin
- Auto-hides when the server stops

---

### VS Code Extension (separate install)

Install **Saropa Drift Advisor** (`saropa.drift-viewer`) from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=saropa.drift-viewer). See [extension/README.md](extension/README.md) for full configuration and command reference.

#### Database Explorer

- **Tree view** — tables with row counts, columns with type icons, FK relationships
- **Right-click menus** — view data, copy name, export CSV, watch, compare rows, profile column, seed, clear, pin, annotate
- **Status bar** — connection state, multi-server selector, auto-discovery (ports 8642–8649)
- **File decoration badges** — row counts on Drift table files in the Explorer

#### Code Intelligence

- **Go to Definition** (F12) / **Peek** (Alt+F12) — jump from SQL table/column names in Dart to Drift class definitions
- **CodeLens** — live row counts and quick actions ("View in Saropa Drift Advisor", "Run Query") on `class ... extends Table`
- **Hover preview** — see recent rows when hovering over table class names during debug
- **Schema linter** — real-time diagnostics for missing indexes, anomalies, constraint violations; quick-fix code actions
- **Terminal link integration** — clickable SQLite error messages in terminal output

#### Query Tools

- **SQL Notebook** (Ctrl+Shift+Q) — multi-statement editor with autocomplete, results grid, inline charts, history, bookmarks
- **EXPLAIN panel** — color-coded query plan tree with index suggestions
- **Watch panel** — monitor queries with live polling, diff highlighting, desktop notifications
- **SQL snippet library** — save, organize, and reuse queries
- **Global search** (Ctrl+Shift+D) — full-text search across all tables

#### Schema & Migration

- **Schema diff** — compare Drift table definitions in code vs runtime schema
- **Schema diagram** — ER-style visualization with FK relationship lines
- **Generate Dart from schema** — scaffold Drift table classes from runtime schema
- **Isar-to-Drift generator** — convert `@collection` classes to Drift tables (Dart source or JSON schema, configurable embedded/enum strategies)
- **Migration preview & code gen** — preview DDL, generate migration code
- **Constraint wizard** — interactive FK, unique, and check constraint builder
- **Schema documentation generator** — export Markdown docs from schema

#### Data Management

- **Data editing** — track cell edits, row inserts/deletes; undo/redo; generate SQL from pending changes
- **Import wizard** — 3-step flow for CSV, JSON, or SQL with auto-format detection and dependency-aware ordering
- **Seeder** — generate test data per table or bulk (configurable row count and NULL probability)
- **Clear table data** — delete rows individually, by table, by group, or all

#### Debugging & Performance

- **Query performance panel** — live in debug sidebar; slow query detection (>500 ms), timing stats, click to view full SQL
- **Data breakpoints** — break on table data conditions during debug sessions
- **Snapshot timeline** — capture snapshots via VS Code timeline, auto-capture on data change, generate changelog
- **Database comparison** — diff two databases (schema match, row count differences)
- **Size analytics dashboard** — table sizes, indexes, journal mode
- **Column profiler** — value distribution, type detection, NULL tracking
- **Sampling engine** — statistical row sampling for large tables
- **Row comparator** — side-by-side diff of two rows

#### Navigation

- **FK navigator** — click FK values to navigate to parent table with breadcrumb trail
- **Lineage tracer** — trace data through FK relationships; generate ordered DELETE statements

#### Sessions & Collaboration

- **Share session** — snapshot viewer state as a URL with annotations
- **Annotations panel** — notes on tables and columns; import/export as JSON

#### Pre-launch Health Checks

- **Task provider** — wire into `launch.json` as `preLaunchTask`
- Three checks: **Health Check** (connectivity), **Anomaly Scan** (data quality), **Index Coverage** (missing indexes)
- Exit code 1 blocks launch on errors; configurable for warnings
- Problem matcher routes output to the Problems panel

#### Integrations

- **Saropa Log Capture bridge** — unified timeline, session headers/summaries, three verbosity modes (off / slow-only / all)

#### Configuration

25+ settings under `driftViewer.*` — see [extension/README.md](extension/README.md) for the full reference.

---

## Quick start

### 1. Add the dependency

**From pub.dev:**

```yaml
# pubspec.yaml
dependencies:
  saropa_drift_advisor: ^0.1.0
```

**Path dependency (local or monorepo):**

```yaml
dependencies:
  saropa_drift_advisor:
    path: ../path/to/saropa_drift_advisor
```

Run `flutter pub get` or `dart pub get`.

### 2. Start the viewer

**Drift (one line):**

```dart
import 'package:saropa_drift_advisor/saropa_drift_advisor.dart';

await myDb.startDriftViewer(enabled: kDebugMode);
```

This package does **not** depend on `drift`; it uses runtime wiring (`customSelect(sql).get()`). For compile-time type safety, use the callback API below.

**Callback API (Drift or raw SQLite):**

```dart
import 'package:saropa_drift_advisor/saropa_drift_advisor.dart';

await DriftDebugServer.start(
  query: (String sql) async {
    final rows = await myDb.customSelect(sql).get();
    return rows.map((r) => Map<String, dynamic>.from(r.data)).toList();
  },
  enabled: kDebugMode,
);
```

### 3. Connect a client

**VS Code extension (recommended):** Install **Saropa Drift Advisor** (`saropa.drift-viewer`) from the Marketplace. It auto-discovers the running server — no configuration needed.

**Browser:** Open **http://127.0.0.1:8642**.

**Example app:** [example/](example/) — from repo root: `flutter run -d windows`, then connect via VS Code or browser. See [example/README.md](example/README.md).

### 4. View your data

Use the **VS Code extension** (recommended) or open **http://127.0.0.1:8642** in any browser.

---

## API summary

| API                                                    | Use when                                            |
| ------------------------------------------------------ | --------------------------------------------------- |
| **`db.startDriftViewer(enabled: ...)`**                | Drift app; one-line setup (runtime wiring).         |
| **`DriftDebugServer.start(query: ..., enabled: ...)`** | Drift or raw SQLite; you supply the query callback. |

### Common parameters

| Parameter                                     | Description                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| **`enabled`**                                 | Typically `kDebugMode`. If `false`, server is not started.                   |
| **`port`**                                    | Default `8642`.                                                              |
| **`loopbackOnly`**                            | Bind to loopback only (default `false`).                                     |
| **`corsOrigin`**                              | CORS header: `'*'`, specific origin, or `null` to disable.                   |
| **`authToken`**                               | Optional; requests require Bearer token or `?token=`. Use for tunnels.       |
| **`basicAuthUser`** / **`basicAuthPassword`** | Optional; HTTP Basic auth when both set.                                     |
| **`getDatabaseBytes`**                        | Optional; when set, `GET /api/database` serves raw SQLite file for download. |
| **`queryCompare`**                            | Optional; enables database diff vs another DB (e.g. staging).                |
| **`onLog`**, **`onError`**                    | Optional; for your logger or `debugPrint` / `print`.                         |

- Only one server per process; calling `start` again when running is a no-op. Use **`DriftDebugServer.stop()`** to shut down and restart (e.g. tests or graceful shutdown).
- **Health:** `GET /api/health` → `{"ok": true}`.
- **Live refresh:** `GET /api/generation`; use `?since=N` to long-poll until generation changes (30s timeout).

---

## Security

**Debug only.** Do not enable in production.

- Default bind: `0.0.0.0`; use **`loopbackOnly: true`** to bind to `127.0.0.1` only.
- Read-only: table listing and table data; SQL runner and EXPLAIN accept **read-only** SQL (`SELECT` / `WITH ... SELECT` only); writes and DDL are rejected. Table/column endpoints use allow-lists; table names and limit/offset are validated.

**Secure dev tunnel (ngrok, port forwarding):** use **`authToken`** or **`basicAuthUser`** / **`basicAuthPassword`**:

```dart
await DriftDebugServer.start(
  query: runQuery,
  enabled: kDebugMode,
  authToken: 'your-secret-token',  // open https://your-tunnel.example/?token=your-secret-token
  // or: basicAuthUser: 'dev', basicAuthPassword: 'pass',
);
```

With token auth, open `https://your-tunnel.example/?token=your-secret-token`; the page uses the token for all API calls. You can also send `Authorization: Bearer your-secret-token`.

---

## Publishing

From repo root:

```bash
python scripts/publish_pub_dev.py
```

**Manual:** Bump version in `pubspec.yaml`, then `git tag v0.1.0` and `git push origin v0.1.0`. GitHub Actions publishes to pub.dev.

- [Package on pub.dev](https://pub.dev/packages/saropa_drift_advisor)
