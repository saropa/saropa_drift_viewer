![Saropa Drift Viewer - SQLite/Drift](https://raw.githubusercontent.com/saropa/saropa_drift_viewer/main/assets/banner_v2.png)

<!-- # Saropa Drift Viewer -->

[![pub package](https://img.shields.io/pub/v/saropa_drift_viewer.svg)](https://pub.dev/packages/saropa_drift_viewer)
[![CI](https://github.com/saropa/saropa_drift_viewer/actions/workflows/main.yaml/badge.svg)](https://github.com/saropa/saropa_drift_viewer/actions/workflows/main.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Debug-only HTTP server that exposes SQLite/Drift table data as JSON and a minimal web UI. Use from any Flutter/Dart app that has a Drift (or other SQLite) database.

---

## Features

- **Table list** with row counts; click a table to view rows as JSON
- **Pagination** (limit/offset) and client-side filter
- **Collapsible schema** panel; export table as CSV
- **Light/dark theme** (saved in localStorage)
- **Read-only SQL runner** with table/column autofill, templates, and query history (localStorage)
- **Data charts** — Bar, pie, line/time-series, and histogram from SQL results (inline SVG, no dependencies)
- **Export** schema-only (`schema.sql`), full dump (schema + data), or raw SQLite file (when `getDatabaseBytes` is set)
- **Live refresh** via long-poll when data changes
- **Snapshot / time travel** — in-memory snapshot, compare to now, export diff
- **Database diff** — compare to another DB (e.g. staging) when `queryCompare` is set; schema + row count diff, export report
- **Optional auth** — token or HTTP Basic for secure dev tunnels
- **Bind address** (loopback or any), CORS, health endpoint (`GET /api/health`), and `DriftDebugServer.stop()`

**Editor integration:** Run Task → **Open Drift Viewer** (VS Code/Cursor) or use the **Drift Viewer** extension in `extension/`.

**Flutter overlay:** In debug builds, wrap your app with [DriftViewerOverlay](https://pub.dev/documentation/saropa_drift_viewer/latest/flutter/DriftViewerOverlay-class.html) to show a floating button that opens the viewer in the browser or in an in-app WebView. See [Flutter overlay](#flutter-overlay) below.

---

## Quick start

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

Run `flutter pub get` or `dart pub get`.

### 2. Start the viewer

**Drift (one line):**

```dart
import 'package:saropa_drift_viewer/saropa_drift_viewer.dart';

await myDb.startDriftViewer(enabled: kDebugMode);
```

This package does **not** depend on `drift`; it uses runtime wiring (`customSelect(sql).get()`). For compile-time type safety, use the callback API below.

**Callback API (Drift or raw SQLite):**

```dart
import 'package:saropa_drift_viewer/saropa_drift_viewer.dart';

await DriftDebugServer.start(
  query: (String sql) async {
    final rows = await myDb.customSelect(sql).get();
    return rows.map((r) => Map<String, dynamic>.from(r.data)).toList();
  },
  enabled: kDebugMode,
);
```

### 3. Open in a browser

Open **http://127.0.0.1:8642**.  
From VS Code/Cursor: **Run Task → Open Drift Viewer**, or use the **Drift Viewer** extension (`extension/`) for a command-palette shortcut.

**Example app:** [example/](example/) — from repo root: `flutter run -d windows`, then open http://127.0.0.1:8642. See [example/README.md](example/README.md).

### 4. Flutter overlay (optional)

In Flutter apps, add a floating button in debug builds that opens the viewer in the browser or in an in-app WebView:

```dart
import 'package:saropa_drift_viewer/flutter.dart';

void main() {
  runApp(DriftViewerOverlay(
    child: MaterialApp(home: MyHomePage()),
  ));
}
```

Start the server as usual (e.g. `await myDb.startDriftViewer(enabled: kDebugMode);`). The overlay shows a small button (e.g. bottom-right); tap it for a menu: **Open in browser** or **Open in WebView**. The button is only visible when `kDebugMode` is true and the server is running. For custom layout, use [DriftViewerFloatingButton](https://pub.dev/documentation/saropa_drift_viewer/latest/flutter/DriftViewerFloatingButton-class.html) inside your own `Stack`.

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
- Read-only: table listing and table data; SQL runner accepts **read-only** SQL (`SELECT` / `WITH ... SELECT` only); writes and DDL are rejected. Table/column endpoints use allow-lists; table names and limit/offset are validated.

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

- [Package on pub.dev](https://pub.dev/packages/saropa_drift_viewer)
