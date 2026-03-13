# Plan 68: VM Service as Debug Channel

> **Status: Implemented (Option A hybrid).**  
> Dart: VM service extensions in `lib/src/server/vm_service_bridge.dart`; extension: VM client in `extension/src/transport/vm-service-client.ts`, URI from `vm-service-uri.ts`, debug lifecycle in `debug-commands.ts`.

### Implementation status (what’s done vs partial)

| Area | Status | Notes |
|------|--------|--------|
| **Dart VM extensions** | Done | `getHealth`, `getSchemaMetadata`, `getTableFkMeta`, `runSql`, `getGeneration`, **`getPerformance`**, **`clearPerformance`**, **`getAnomalies`**, **`explainSql`**, **`getIndexSuggestions`** — all delegate to existing handlers. |
| **Extension VM client** | Done | WebSocket JSON-RPC client; calls all RPCs above (including `getIndexSuggestions` for VM-only Health/diagnostics). Status bar shows "VM Service" when connected via VM. |
| **VM URI resolution** | Done | (1) `customRequest` and `session.configuration.vmServiceUri`; (2) **parsing debug adapter output** via `registerDebugAdapterTrackerFactory` for `dart`/`flutter`. Unit tests: `vm-service-uri.test.ts` for `parseVmServiceUriFromOutput`. |
| **Debug lifecycle** | Done | On session start: VM first (URI from API or output), then HTTP discovery. On session end: clear VM client. **Hot restart**: on WebSocket close we clear VM client, setContext, refresh tree (no broken state). |
| **API over VM** | Extended | Core + generation + **performance**, **anomalies**, **explainSql**, **clearPerformance**, **indexSuggestions** over VM. |
| **Panel / Open in browser** | Done (fallback) | When **VM-only** (no HTTP): panel shows fallback message ("Use the Database tree…"); "Open in browser" shows an info message. When HTTP is available, behavior unchanged. |
| **Connection robustness** | Done | VM URI validated before connect (`isValidVmServiceUri`); **Output > Saropa Drift Advisor** logs connection attempts, success, and failure reasons (timeout, no isolates, health failed, etc.); hot restart clears "reported" so next VM URI from debug output retriggers connect; welcome view points users to Output for troubleshooting. |

So: **core path and nice-to-haves are implemented**. Defensive connection behavior: validation, detailed error logging, auto-retry after hot restart, and troubleshooting guidance. VM URI from output or API; tree and status bar show "VM Service"; hot restart clears state; panel and "Open in browser" show clear messaging when VM-only; extra APIs (performance, anomalies, explain) work over VM.

### Manual testing (VM Service path)

1. Start a Flutter app with `DriftDebugServer.start()` (or equivalent) in debug mode from VS Code.
2. Confirm the **Database** tree shows **"VM Service"** as the connection and schema/tables load.
3. Run a query from the tree or SQL notebook; confirm results.
4. Open **Query performance** view; confirm data (or empty) and refresh.
5. **Panel**: Click "Open in Panel" (or status bar). If only VM is reachable, confirm the fallback message; if HTTP is reachable, confirm the full UI loads.
6. **Open in browser**: If VM-only, confirm the info message; if HTTP reachable, confirm browser opens.
7. **Hot restart**: Trigger a hot restart in the app; confirm the extension clears VM state (e.g. tree shows disconnected), then reconnects when the adapter prints a new VM URI (or on next session start).

---

## 1. Motivation

**User impact:** The current connection model (HTTP server in app + extension port-scan discovery on 8642–8649, optional adb forward on emulator) does not work for users. The extension stays disconnected; troubleshooting in the welcome view is insufficient because the underlying design is unreliable. This plan fixes that by using the VM Service when debugging so connection "just works."

- **Current**: The app runs an HTTP server (e.g. `http://127.0.0.1:8642`). The VS Code extension and the browser connect to it. On an **Android emulator**, that server is inside the emulator; the host has no route to it unless we run `adb forward tcp:8642 tcp:8642` (we added auto adb forward when a Flutter debug session is active to reduce friction).
- **Isar**: The Isar Inspector connects over the **Dart VM Service** (same channel as the debugger). Flutter/IDE already forwards the VM Service port when debugging on an emulator, so no adb forward is needed.
- **Goal**: Move our debug channel to the VM Service so that, like Isar, connection “just works” on emulators without any adb forward or special logic. Keep HTTP for "Open in browser" and non-debug use; fall back to current HTTP + discovery when no debug session (e.g. desktop app run without debugger). Current design: [Plan 6: Server Auto-Discovery](history/20260309/06-auto-discovery.md).

---

## 2. Current Architecture (Brief)

| Component | Role |
|-----------|------|
| **App (Dart)** | `DriftDebugServer.start()` → `HttpServer.bind(address, port)`. Serves HTML (full UI) and JSON APIs: `/api/health`, `/api/schema/metadata`, `/api/tables`, `/api/sql`, `/api/import`, etc. |
| **Extension** | Discovers server by scanning ports (e.g. 8642–8649), then uses `fetch()` to that host/port for health, schema, SQL, etc. Webview panel loads the server’s HTML via `fetch(baseUrl)`. |
| **Browser** | User can open `http://127.0.0.1:8642` and use the same UI; no extension required. |

The HTTP server is the single place that serves the UI and exposes the API. No dependency on VM Service or Dart/Flutter extension.

---

## 3. Why We Have an HTTP Server Today

- **Single backend**: One server in the app serves both the rich web UI and the JSON API; the extension reuses it by loading that URL and calling the same endpoints.
- **Open in browser**: Any client that can do HTTP (browser, curl, another IDE) can use the same URL; no extension or VM protocol required.
- **Simple integration**: Extension only needs host + port and `fetch()`; no WebSocket, VM protocol, or debug-session APIs.
- **Protocol-agnostic**: Works from any environment that can reach the app over HTTP (localhost, adb-forwarded port, or future tunnel/relay if we added it).

---

## 4. Proposed Direction: Use VM Service as the Channel

**Idea**: Have the app expose the same capabilities (schema, tables, run SQL, etc.) via a **VM Service extension** (custom RPC methods) instead of (or in addition to) HTTP. The VS Code extension would connect to the VM Service WebSocket (already forwarded when debugging) and call those RPCs. No separate port to forward on emulator.

**Trade-off**: We gain seamless emulator/device connection and align with how other Flutter tooling (e.g. Isar) works. We lose “any HTTP client can talk to the app” unless we keep HTTP as well or add another bridge.

---

## 5. Options

### Option A: Hybrid (VM for extension, keep HTTP for browser)

- **App**: Keep the existing HTTP server for “Open in browser” and the full UI. **Additionally** register a VM Service extension that exposes RPCs: e.g. `getSchema`, `getTables`, `runSql`, `getHealth`, etc., implemented by delegating to the same logic the HTTP handlers use.
- **Extension**:  
  - Resolve the VM Service WebSocket URL from the active Dart/Flutter debug session (via Dart/Flutter extension API or debug adapter).  
  - Implement a small VM Service client (JSON-RPC over WebSocket) and map current API usage (schema, SQL, etc.) to these RPCs.  
  - When a debug session is active, use VM Service; when not (e.g. desktop app running without debugger), fall back to HTTP + current discovery.
- **Browser**: Unchanged; still uses HTTP server.
- **Effort**: Medium. New Dart VM service registration + thin RPC layer; extension: VM client + debug-session resolution + dual path (VM vs HTTP).

### Option B: VM only (no HTTP server in app)

- **App**: Remove the HTTP server. Expose all functionality only via the VM Service extension (same RPC surface as in A).
- **Extension**: Same as in A for the “debug session active” path. No HTTP fallback from the app; either “use VM Service when debugging” or “no connection” when not debugging.
- **Browser**: No longer “open http://localhost:8642”. Options: (1) Drop “open in browser”, or (2) Extension (or a separate small tool) runs a local HTTP server that proxies requests to the VM Service when the extension is connected.
- **Effort**: Medium–high. Same app/extension VM work as A, plus either removing browser UX or adding a proxy/bridge for it.

### Option C: Keep current design (HTTP + auto adb forward)

- No VM Service work. Rely on existing HTTP server and current behavior: auto `adb forward` when a Flutter/Dart debug session is active and discovery finds no server.
- **Effort**: None (already done). Remaining downside: depends on adb and a single forwarded port; VM Service is “native” to the debug session.

---

## 6. App-Side (Dart) Changes (for A or B)

- **VM Service extension registration**: Use `package:vm_service` (or the VM’s registration API) to register a custom service name (e.g. `ext.saropa.drift`) and register RPC methods.
- **RPC methods**: Mirror current HTTP API surface, e.g.:
  - `getHealth` → `{ "ok": true }`
  - `getSchemaMetadata` → current `/api/schema/metadata` response
  - `getTables` / `getTableData` → table list and row data
  - `runSql` → execute SQL, return rows/error
  - Optional: `getDatabaseBytes`, `writeQuery` (import), `queryCompare` for diff, etc.
- **Implementation**: Each RPC handler should call the same logic used by the current HTTP handlers (e.g. `ServerContext.query`, existing callbacks) so we don’t duplicate business logic.
- **When to register**: Only when the Drift debug server is “enabled” (e.g. same condition as `DriftDebugServer.start()` today). Register on startup (or when debug server starts) and unregister on stop.

**Risks / unknowns**: VM Service extension API stability, lifecycle (e.g. what happens on hot restart), and whether all current HTTP endpoints have a natural RPC equivalent (e.g. streaming or large payloads).

---

## 7. Extension-Side (TypeScript) Changes (for A or B)

- **Resolve VM Service URL**: When the user has an active Dart/Flutter debug session, obtain the VM Service WebSocket URI (e.g. `ws://127.0.0.1:55998/xxxxx/ws`). This may require:
  - Using a proposed or existing API from the Dart/Flutter VS Code extension, or
  - Inspecting `vscode.debug.activeDebugSession` and reading a custom property or debug adapter protocol response that exposes the VM URI, or
  - Parsing it from debug console / launch config if documented and stable.
- **VM Service client**: Implement (or reuse) a minimal client: connect WebSocket, send JSON-RPC requests, match request id to responses. Call our custom extension methods (e.g. `ext.saropa.drift.getSchemaMetadata`).
- **DriftApiClient abstraction**: Introduce a “transport” or “backend”: either HTTP (current) or VM Service. When VM Service is available (debug session + URI resolved), use VM transport; otherwise use HTTP transport. Same `DriftApiClient` interface so tree, CodeLens, hover, panel, etc. keep working.
- **Discovery**: When using VM Service, “discovery” is “is there an active Dart/Flutter debug session with a valid VM URI?”. No port scan. When using HTTP, keep current port scan + optional adb forward.
- **Panel / webview**: If we keep loading the UI from the app’s HTTP server, the panel can keep loading that URL when on HTTP. When on VM only (option B), the panel would need to be fed entirely by the extension (e.g. extension-hosted HTML/JS that receives data from the extension, which gets it via VM Service).

---

## 8. “Open in Browser”

- **Option A (hybrid)**: Unchanged; HTTP server remains, browser opens `http://127.0.0.1:8642` (with adb forward on emulator if needed).
- **Option B (VM only)**: Either remove “Open in browser”, or provide a separate path: e.g. a small local HTTP server in the extension that serves the same UI and proxies API calls to the VM Service. That implies duplicating or sharing the UI assets (HTML/JS/CSS) in the extension.

---

## 9. Risks and Open Questions

- **Dart/Flutter extension dependency**: Extension would depend on the Dart/Flutter extension (or at least on the debug session exposing the VM URI). Need to confirm how to get the VM Service URI reliably from the session.
- **Debug-only**: VM Service is only available when the app is run in debug mode. So “run app in profile/release and still use Drift Advisor” would still require HTTP (or we accept that Advisor is debug-only when using VM).
- **Stability**: VM Service protocol and extension registration are part of the Dart SDK; we’d need to track compatibility across Flutter/Dart versions.
- **Complexity**: Two code paths (VM vs HTTP) increase maintenance unless we keep the abstraction very clean.

---

## 10. Recommendation (for discussion)

- **Short term**: Keep **Option C** (current HTTP + auto adb forward). It already improves emulator UX with no protocol change.
- **If we want “like Isar” without adb**: Pursue **Option A (hybrid)** so that when a debug session is active we use VM Service and don’t need adb forward; when not (or when opening in browser), we still use HTTP. That gives the best of both worlds at the cost of implementing and maintaining the VM Service path and the dual transport in the extension.
- **Option B** is a larger change (no HTTP in app, possible loss or reimplementation of “open in browser”) and is only worth it if we explicitly want to drop the HTTP server and own all UI in the extension.

---

## 11. Summary Table

| Aspect | Current (HTTP + adb forward) | Option A (Hybrid) | Option B (VM only) |
|--------|-----------------------------|-------------------|---------------------|
| Emulator connection | adb forward (auto or manual) | VM Service (no forward) | VM Service (no forward) |
| Open in browser | Yes (HTTP) | Yes (HTTP) | No, or proxy in extension |
| Extension dependency | None | Dart/Flutter debug session + VM URI | Same |
| App complexity | HTTP server only | HTTP + VM Service extension | VM Service extension only |
| Extension complexity | Port scan + HTTP client | VM client + HTTP fallback | VM client only |
| Effort | Done | Medium | Medium–high |

---

*This plan is for discussion only and does not commit the project to implementation.*
