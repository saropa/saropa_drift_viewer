# Saropa Drift Advisor — VS Code Extension

Full IDE integration for [saropa_drift_advisor](https://pub.dev/packages/saropa_drift_advisor), the debug-only SQLite/Drift database inspector for Flutter and Dart apps.

## Requirements

Your Flutter/Dart app must be running with the Drift debug server started. See the [Dart package README](https://pub.dev/packages/saropa_drift_advisor) for setup (two lines of code).

## Features

### Database Explorer

A **database icon** in the activity bar opens a tree view:

- Tables with row counts
- Columns with type icons (key, number, string, blob)
- Foreign key relationships
- Right-click: **View Data**, **Copy Name**, **Export CSV**, **Watch Table**
- Auto-refreshes when the app writes to the database

### Code Intelligence

Works in Dart files with Drift table definitions:

- **Go to Definition** (F12) — jump from SQL table/column names to their definitions
- **CodeLens** — row counts and quick actions on Drift table classes
- **Hover Preview** — see recent rows when hovering over table class names
- **Schema Linter** — diagnostics with quick-fix code actions for missing indexes and anomalies
- **File Badges** — row count badges on Drift table files in the explorer

### Query Tools

- **SQL Notebook** (`Ctrl+Shift+Q`) — multi-statement editor with autocomplete, results grid, and inline charts
- **EXPLAIN Panel** — color-coded query plan tree with index suggestions
- **Live Watch** — monitor queries with diff highlighting; persists across sessions

### Schema & Migration

- **Schema Diff** — compare code-defined tables vs runtime schema
- **Schema Diagram** — ER-style visualization of tables and FK relationships
- **Generate Dart** — scaffold Drift table classes from the runtime schema
- **Isar-to-Drift Generator** — scan workspace or pick files to convert Isar `@collection` classes (Dart source or JSON schema) to Drift table definitions with configurable embedded/enum strategies
- **Migration Preview** — preview migration DDL from database comparison

### Data Management

- **Import Data** — 3-step wizard for JSON, CSV, or SQL files
- **Data Editing** — track cell edits, row inserts/deletes; generate SQL from pending changes
- **Export SQL Dump** — full schema + data to `.sql`
- **Download Database** — save the raw `.db` file

### Debugging

- **Query Performance** — debug sidebar with slow query stats and timing
- **Snapshot Timeline** — capture snapshots, compare to current state, view diffs
- **Database Comparison** — diff two databases (schema match, row count differences)
- **Size Analytics** — storage dashboard with table sizes, indexes, journal mode
- **Terminal Links** — clickable SQLite error messages
- **Pre-launch Tasks** — health check, anomaly scan, index coverage

### Sessions

- **Share Session** — snapshot state, copy shareable URL
- **Open Session** — view a shared session by ID
- **Annotate Session** — add notes to shared sessions

## Configuration

| Setting | Default | Description |
|---|---|---|
| `driftViewer.enabled` | `true` | Master switch: when false, no server discovery or connection and all features are off |
| `driftViewer.host` | `127.0.0.1` | Debug server host |
| `driftViewer.port` | `8642` | Debug server port |
| `driftViewer.authToken` | *(empty)* | Bearer token for authenticated servers |
| `driftViewer.discovery.enabled` | `true` | Auto-scan for running servers |
| `driftViewer.discovery.portRangeStart` | `8642` | Scan range start |
| `driftViewer.discovery.portRangeEnd` | `8649` | Scan range end |
| `driftViewer.fileBadges.enabled` | `true` | Row count badges on table files |
| `driftViewer.hover.enabled` | `true` | Hover preview during debug |
| `driftViewer.hover.maxRows` | `3` | Rows shown in hover preview |
| `driftViewer.linter.enabled` | `true` | Schema linter diagnostics |
| `driftViewer.timeline.autoCapture` | `true` | Auto-capture snapshots on data change |
| `driftViewer.watch.notifications` | `false` | Desktop notifications for watch changes |
| `driftViewer.performance.slowThresholdMs` | `500` | Slow query threshold (ms) |

## Design: extension enablement

**Drift Advisor** has a master switch: `driftViewer.enabled` (default true). When false, the extension does not discover or connect to servers and all Drift Advisor features are off; the Database view shows “Saropa Drift Advisor is disabled” and the status bar shows “Drift: Disabled”. When true, activation is as before (`onLanguage:dart`); individual features can still be turned off via other settings. There is no “turn on = setup project” flow—flipping the switch on is enough.

By contrast, the **saropa_lints** extension is designed to have an explicit enabled/disabled switch and a “turn on = setup project” flow (e.g. add dev_dependency, run `dart run saropa_lints:init`, configure `analysis_options.yaml`). That distinction is intentional: Drift Advisor is a single master switch plus per-feature toggles; saropa_lints is opt-in at the project level with setup.

## Server Discovery

The extension automatically scans ports 8642-8649 for running debug servers. When no server is found and a Flutter/Dart debug session is active (e.g. app on Android emulator), it tries to forward the port with `adb forward` and retries discovery so the host can connect. You can also run **Saropa Drift Advisor: Forward Port (Android Emulator)** manually. When multiple servers are found, use **Saropa Drift Advisor: Select Server** from the command palette. The status bar shows connection state:

- **Drift: :8642** — connected to a single server
- **Drift: 3 servers** — multiple servers found (click to select)
- **Drift: Searching...** — scanning for servers
- **Drift: Offline** — no servers found (click to retry)

## Commands

All commands are available via the command palette (`Ctrl+Shift+P`):

| Command | Description |
|---|---|
| Open in Browser | Open web UI in default browser |
| Open in Editor Panel | Open web UI in VS Code tab |
| Schema Diff | Compare code vs runtime schema |
| Schema Diagram | ER-style table visualization |
| Open SQL Notebook | Multi-statement SQL editor |
| Explain Query Plan | EXPLAIN for selected SQL |
| Generate Dart from Schema | Scaffold Drift table classes |
| Export SQL Dump | Save schema + data as `.sql` |
| Download Database File | Save raw `.db` file |
| Preview Migration SQL | Show migration DDL |
| Compare Databases | Diff two databases |
| Database Size Analytics | Storage dashboard |
| Import Data | JSON/CSV/SQL import wizard |
| Capture Snapshot | Snapshot current database state |
| Share Debug Session | Create shareable session URL |
| Run Schema Linter | Manual linter scan |
| Show All Tables | QuickPick table selector |

## Development

```bash
cd extension && npm install && npm run compile
```

Run/debug: **Run > Run Extension** (F5) in VS Code.

```bash
cd extension && npm test
```
