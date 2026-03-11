# Example: Drift app with saropa_drift_advisor

This Flutter app shows how to use [saropa_drift_advisor](https://pub.dev/packages/saropa_drift_advisor) with a [Drift](https://pub.dev/packages/drift) database.

## Run the example

From the **package root** (not this folder):

```bash
flutter run -d windows
# or: flutter run -d macos
# or: flutter run -d linux
# or: flutter run -d android
# or: flutter run -d ios
```

From this folder:

```bash
cd example
flutter pub get
flutter run
```

## What it does

1. Creates a Drift database with a single `items` table (id, title, createdAt).
2. Seeds a few rows if the table is empty.
3. Starts Saropa Drift Advisor in debug builds (`kDebugMode`).
4. Opens a simple Flutter UI that tells you to open **http://127.0.0.1:8642** in a browser. A **floating button** (bottom-right in debug) opens the advisor in the browser or in an in-app WebView.

Open that URL (or tap the overlay button) to use the advisor: list tables, browse rows, run read-only SQL, export schema or data, or download the raw `.sqlite` file.

Note: This example uses Drift's native (dart:io) database, so it is intended for mobile/desktop targets (not web).

## Integration pattern

The app wires the advisor using the callback API (no `startDriftViewer` extension):

- **`query`** — runs SQL via `db.customSelect(sql).get()` and returns rows as `List<Map<String, dynamic>>`.
- **`getDatabaseBytes`** — returns the SQLite file bytes so the UI can offer "Download database".
- **`onLog` / `onError`** — uses `DriftDebugErrorLogger` for startup banner and errors.

See `lib/main.dart` for the full setup.
