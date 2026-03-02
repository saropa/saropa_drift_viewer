# saropa_drift_viewer

[![pub package](https://img.shields.io/pub/v/saropa_drift_viewer.svg)](https://pub.dev/packages/saropa_drift_viewer)
[![CI](https://github.com/saropa/saropa_drift_viewer/actions/workflows/main.yaml/badge.svg)](https://github.com/saropa/saropa_drift_viewer/actions/workflows/main.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Debug-only HTTP server that exposes SQLite/Drift table data as JSON and a minimal web UI. Use from any Flutter/Dart app that has a Drift (or other SQLite) database.

## Setup

### 1. Add the dependency

**From pub.dev:**

```yaml
# pubspec.yaml
dependencies:
  saropa_drift_viewer: ^0.1.0
```

**Path dependency (local or monorepo):**

```yaml
dependencies:
  saropa_drift_viewer:
    path: ../path/to/saropa_drift_viewer
```

Then run `flutter pub get` or `dart pub get`.

### 2. Start the viewer (Drift apps)

After your Drift database is initialized, call `startDriftViewer` on it (e.g. in `main()` or right after DB init):

```dart
import 'package:saropa_drift_viewer/saropa_drift_viewer.dart';

// After your database is ready (e.g. AppDatabase, or your GeneratedDatabase subclass):
await myDb.startDriftViewer(enabled: kDebugMode);
```

### 3. Open in a browser

Open **http://127.0.0.1:8642**. From VS Code/Cursor: **Run Task → Open Drift Viewer** (uses `.vscode/tasks.json` in this repo). Or install the **Drift Viewer** extension (`extension/`) for a command-palette shortcut. You'll see a list of tables (with row counts); click one to view its rows as JSON. The UI supports **live refresh** (table view updates when data changes, no manual refresh), **pagination** (limit/offset), **client-side row filter**, a **collapsible schema** panel, **export table as CSV**, and a **light/dark theme** (saved in the browser). A **read-only SQL runner** lets you run ad-hoc `SELECT` queries with table/column autofill and templates; results can be shown as a table or JSON. You can **export schema (no data)** as `schema.sql`, **export a full dump (schema + data)** as `dump.sql`, or **download the raw SQLite file** (binary `.sqlite`) to open in DB Browser or similar—the download option requires passing `getDatabaseBytes` when starting the server (see below). **Snapshot / time travel**: take an in-memory snapshot of all tables, then "Compare to now" to see added/removed/unchanged rows per table and export the diff as JSON. **Database diff**: when you pass `queryCompare` at startup (e.g. a second DB such as staging), the UI can show a diff report (schema + per-table row counts) and export it.

---

## Drift: one-line setup

For Drift apps, the extension on `GeneratedDatabase` is the simplest option:

```dart
import 'package:saropa_drift_viewer/saropa_drift_viewer.dart';

// One call after DB is initialized:
await myDb.startDriftViewer(enabled: kDebugMode);
```

Optional parameters:

- **`port`** — default `8642`.
- **`loopbackOnly`** — if `true`, bind to `127.0.0.1` only; if `false`, bind to `0.0.0.0`.
- **`corsOrigin`** — `'*'` (default), a specific origin, or `null` to omit CORS.
- **`authToken`** — optional. When set, every request must include `Authorization: Bearer <token>` or `?token=<token>`. Use for secure dev tunnels (e.g. ngrok).
- **`basicAuthUser`** and **`basicAuthPassword`** — optional. When both set, HTTP Basic auth is accepted (alternative to token).
- **`getDatabaseBytes`** — optional. When set, the UI offers "Download database (raw .sqlite)" and `GET /api/database` serves the file (e.g. `() => File(yourDbPath).readAsBytes()`). Open the downloaded file in DB Browser or similar.
- **`onLog`** — e.g. `(msg) => debugPrint(msg)`.
- **`onError`** — e.g. `(err, stack) => debugPrint('$err\n$stack')`.

Example with logging:

```dart
await myDb.startDriftViewer(
  enabled: kDebugMode,
  onLog: (String message) => debugPrint(message),
  onError: (Object error, StackTrace stack) => debugPrint('$error\n$stack'),
);
```

---

## Callback-based API (non-Drift or custom)

If you don't use Drift or want to plug in another SQL source, use `DriftDebugServer.start` with a `query` callback:

```dart
import 'package:saropa_drift_viewer/saropa_drift_viewer.dart';

await DriftDebugServer.start(
  query: (String sql) async {
    // Run [sql] with your executor and return rows as list of maps.
    final rows = await yourExecutor.customSelect(sql).get();
    return rows.map((r) => Map<String, dynamic>.from(r.data)).toList();
  },
  enabled: kDebugMode,
  onLog: debugPrint,
  onError: (e, s) => debugPrint('$e\n$s'),
);
```

---

## API summary

| API | Use when |
|-----|----------|
| **`db.startDriftViewer(enabled: ...)`** | You have a Drift `GeneratedDatabase` (one-line setup). |
| **`DriftDebugServer.start(query: ..., enabled: ...)`** | You use raw SQLite, or want to supply the query callback yourself. |

Common parameters:

- **`enabled`** — typically `kDebugMode`. If `false`, the server is not started.
- **`port`** — default `8642`.
- **`loopbackOnly`** — bind to loopback only (default `false`).
- **`corsOrigin`** — CORS header: `'*'`, specific origin, or `null` to disable.
- **`authToken`** — optional; when set, requests require Bearer token or `?token=`. Use for tunnels (ngrok, port forwarding).
- **`basicAuthUser`** / **`basicAuthPassword`** — optional; when both set, HTTP Basic auth is accepted.
- **`getDatabaseBytes`** — optional; when set, `GET /api/database` serves the raw SQLite file for download (e.g. open in DB Browser). Use e.g. `() => File(dbPath).readAsBytes()`.
- **`queryCompare`** — optional; when set, enables database diff: compare the main DB with another (e.g. staging) via the UI or `GET /api/compare/report` (schema + per-table row count diff; export as JSON).
- **`onLog`**, **`onError`** — optional; for your logger or `debugPrint` / `print`.

Only one server can run per process; calling start again when already running is a no-op. Use **`DriftDebugServer.stop()`** to shut down the server so you can call **`start`** again (e.g. in tests or graceful shutdown).

**Health:** `GET http://127.0.0.1:8642/api/health` returns `{"ok": true}` for scripts or probes.

**Live refresh:** `GET http://127.0.0.1:8642/api/generation` returns `{"generation": N}`. Use `?since=N` to long-poll until the generation changes (or 30s timeout); the UI uses this to refresh when data changes.

---

## Security

**Debug only.** Do not enable in production. By default the server binds to `0.0.0.0`; use **`loopbackOnly: true`** to bind to `127.0.0.1` only. It serves read-only table listing and table data. The SQL runner accepts arbitrary **read-only** SQL (`SELECT` / `WITH ... SELECT` only); all write and DDL statements are rejected. Table and column endpoints use allow-lists; table names and limit/offset are validated.

**Secure dev tunnel:** When exposing the viewer over a tunnel (e.g. ngrok) or port forwarding, use **`authToken`** or **`basicAuthUser`** / **`basicAuthPassword`** so the server is not open to the internet. Example:

```dart
await DriftDebugServer.start(
  query: runQuery,
  enabled: kDebugMode,
  authToken: 'your-secret-token',  // open https://your-tunnel.example/?token=your-secret-token
  // or: basicAuthUser: 'dev', basicAuthPassword: 'pass',
);
```

With token auth, open the viewer at `https://your-tunnel.example/?token=your-secret-token`; the page will use the token for all API calls. You can also send `Authorization: Bearer your-secret-token` on requests.

---

## Publishing

**Publish script (from repo root):**

```bash
python scripts/publish_pub_dev.py
```

**Manual:** Bump version in `pubspec.yaml`, then `git tag v0.1.0` and `git push origin v0.1.0`. GitHub Actions publishes to pub.dev.

- [Package on pub.dev](https://pub.dev/packages/saropa_drift_viewer)
