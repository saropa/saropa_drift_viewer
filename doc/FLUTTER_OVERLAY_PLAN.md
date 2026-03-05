# Flutter widget overlay — Implementation plan

## Goal
Floating button in debug builds that opens the Drift viewer in the browser or in an in-app WebView.

---

## 1. Package structure and dependencies

- **Main library** (`lib/saropa_drift_viewer.dart`): remains Dart-only; no Flutter import (Dart CLI users keep using only the server).
- **Flutter entry point** (`lib/flutter.dart`): new file exporting overlay widgets and re-exporting the main API so Flutter apps can use a single import.
- **pubspec.yaml**:
  - Add `flutter: sdk: flutter`.
  - Add `url_launcher` for opening the viewer in the external browser (`LaunchMode.externalApplication`).
  - Add `webview_flutter` (e.g. `^4.12.0`) for the in-app WebView option.

---

## 2. Widget API

- **DriftViewerOverlay({Key? key, required Widget child, AlignmentGeometry alignment = Alignment.bottomRight, EdgeInsetsGeometry? margin})**
  - Wraps `child` in a `Stack`. When `kDebugMode` is true and `DriftDebugServer.port != null`, overlays a floating button at `alignment` with `margin`. Otherwise only shows `child`.
  - One-line usage: `DriftViewerOverlay(child: MaterialApp(...))`.

- **DriftViewerFloatingButton({Key? key})**
  - Standalone floating button; visible only when `kDebugMode` and `DriftDebugServer.port != null`. For custom layout (e.g. place in your own Stack).

- **Button behavior**
  - Single tap: open viewer in **external browser** (url_launcher).
  - Popup menu (long-press or secondary tap): "Open in browser" and "Open in WebView". WebView opens a full-screen route with `webview_flutter` loading the viewer URL.

---

## 3. URL and auth

- Viewer URL: `Uri(scheme: 'http', host: '127.0.0.1', port: DriftDebugServer.port)` (no string parsing; port is numeric).
- Auth: Server does not expose the auth token. Overlay opens the base URL only. Users with auth (e.g. tunnel) add the token manually in the browser if needed.

---

## 4. Open in browser

- Use `url_launcher`: `launchUrl(uri, mode: LaunchMode.externalApplication)`.
- Build URI with `Uri(scheme: 'http', host: '127.0.0.1', port: port)`.
- Error handling: try/catch, show SnackBar or similar so the user gets feedback if launch fails.
- Satisfy lints: use `Uri` constructor, set `LaunchMode`, handle errors.

---

## 5. Open in WebView

- New route: full-screen page with `WebViewWidget(controller: ...)` loading the viewer URI.
- `WebViewController()` with `loadRequest` for the same localhost URI (not user-controlled).
- AppBar or leading "Back" to pop the route.

---

## 6. Visibility rules

- Show overlay button only when `kDebugMode && DriftDebugServer.port != null`.
- On Flutter web the server is stub (port is null) → button hidden. On mobile/desktop in debug with server started → button visible.

---

## 7. File layout

- `lib/src/drift_viewer_overlay.dart`: `DriftViewerOverlay`, `DriftViewerFloatingButton`, and the WebView screen (e.g. `_DriftViewerWebViewScreen`).
- `lib/flutter.dart`: exports overlay widgets and re-exports the main library so Flutter apps can `import 'package:saropa_drift_viewer/flutter.dart';` for both server and overlay.

---

## 8. Example app

- Wrap root with `DriftViewerOverlay(child: ExampleApp())` in `main.dart` so the floating button appears over the app.

---

## 9. Lint / analysis

- Viewer URL is built from `DriftDebugServer.port` only (our own debug server), not user input. No need to relax `avoid_user_controlled_urls` or similar.

---

## 10. Tests

- Widget test: build overlay when `kDebugMode` is false or `DriftDebugServer.port` is null → only child, no button. (Static `DriftDebugServer.port` is not easily mocked; we can test release mode or document manual verification.)
