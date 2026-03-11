## RESOLVED: APK Bloat Problem with saropa_drift_advisor

> **Fixed in v0.3.1.** Removed `webview_flutter`, `webview_flutter_android`, `url_launcher`, `intl`, `meta`, `collection`, `flutter` SDK, and the in-app overlay widgets. The package is now pure Dart with a single dependency (`crypto`). Native APK overhead: zero.

---

### What Happens When You Add a Dependency

When you add any package to `pubspec.yaml` dependencies:

1. Dart compiler includes all the Dart code from that package
2. Flutter bundles all native libraries (`.so` files on Android, frameworks on iOS)
3. This happens for **every** build - debug AND release
4. Tree-shaking removes unused Dart code in release builds, but **never** removes native libraries

---

### The Dependency Chain

`saropa_drift_advisor` declares these dependencies:

| Package                   | Type            | Native Size             |
| ------------------------- | --------------- | ----------------------- |
| `collection`              | Pure Dart       | ~0 KB                   |
| `crypto`                  | Pure Dart       | ~0 KB                   |
| `intl`                    | Pure Dart       | ~0 KB                   |
| `meta`                    | Pure Dart       | ~0 KB                   |
| `url_launcher`            | Platform plugin | ~50-100 KB per platform |
| `webview_flutter`         | Platform plugin | ~2-5 MB per platform    |
| `webview_flutter_android` | Android native  | (included above)        |

**Total native overhead: ~2-5 MB added to your APK**

---

### Why WebView Is Heavy

`webview_flutter` embeds:

- Platform channel code to communicate with native WebView
- Configuration for Android WebView / iOS WKWebView
- Native libraries to bridge Flutter to the system WebView

Even though your app never calls WebView, the native bridging code is bundled.

---

### What the Overlay Feature Does

The Flutter overlay (`DriftViewerOverlay`, `DriftViewerFloatingButton`):

- Shows a floating button in debug builds
- Tap it → opens the debug viewer in an in-app WebView
- Uses `url_launcher` to open in external browser as alternative

**This feature is optional.** Most users just open `http://127.0.0.1:8642` in their browser or use the VS Code extension. They never need the in-app WebView.

---

### The Core Server Doesn't Need WebView

The HTTP debug server (`DriftDebugServer`) only needs:

- `dart:io` for `HttpServer`
- `collection`, `crypto`, `intl`, `meta` for utilities

It serves JSON over HTTP. The browser renders the UI. No WebView needed.

---

### Why This Is a Problem for Release Builds

`saropa_drift_advisor` is a **debug tool**. You guard it with `kDebugMode`:

```dart
await db.startDriftViewer(enabled: kDebugMode);
```

But the native libraries from `webview_flutter` (~2-5 MB) still ship in the release APK. The Dart code is tree-shaken away, but the `.so` files remain. Users pay the download size cost for a feature they never use in production.

---

### Fix: Remove the in-app overlay

Drop `webview_flutter`, `webview_flutter_android`, and `url_launcher` from dependencies. Remove the overlay widgets (`DriftViewerOverlay`, `DriftViewerFloatingButton`).

The VS Code extension already provides both features the overlay offered:

| Flutter overlay feature | VS Code extension equivalent          |
| ----------------------- | ------------------------------------- |
| "Open in browser"       | `driftViewer.openInBrowser` command   |
| "Open in WebView"       | `driftViewer.openInPanel` command     |
| Auto-detect server      | Built-in server discovery (port scan) |

Non-VS Code users (Android Studio, IntelliJ, CLI) can open `http://127.0.0.1:8642` in any browser.

**Result:** ~2-5 MB removed from release APKs, three fewer dependencies, no feature loss for VS Code users.
