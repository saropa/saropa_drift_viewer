# Feature 01: VS Code Webview Panel

**Effort:** M (Medium) | **Priority:** 4

## Overview

Embed the Drift Viewer UI directly inside a VS Code editor panel using the Webview API instead of opening an external browser. Developers can inspect their database side-by-side with code without context switching. The server already serves full HTML at `GET /`; the extension loads it into a `WebviewPanel`.

**User value:** No more alt-tabbing to a browser. The viewer becomes a native IDE experience — open it like any editor tab, dock it, split it.

## Architecture

### Server-side (Dart)

No changes needed. The existing server at `http://127.0.0.1:{port}` already serves the full HTML UI and all API endpoints.

### Client-side (JS in `_indexHtml`)

Minor: may need a `<base>` tag injected so relative `fetch()` calls resolve correctly when HTML is loaded into a webview outside the server origin.

### VS Code Extension (TypeScript) — MAJOR CHANGES

Replace the simple `openExternal` with a `WebviewPanel` that fetches and displays the viewer HTML.

### Flutter (Dart)

No changes.

### New Files

- `extension/src/panel.ts` — WebviewPanel manager class (~100 lines)

## Implementation Details

### New command in `extension/package.json`

```json
{
  "command": "driftViewer.openInPanel",
  "title": "Drift Viewer: Open in Editor Panel"
}
```

Add to `activationEvents`:

```json
"onCommand:driftViewer.openInPanel"
```

### `extension/src/panel.ts`

```typescript
import * as vscode from "vscode";

export class DriftViewerPanel {
  public static currentPanel: DriftViewerPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(
    extensionUri: vscode.Uri,
    host: string,
    port: number,
  ): void {
    const column = vscode.ViewColumn.Beside;
    if (DriftViewerPanel.currentPanel) {
      DriftViewerPanel.currentPanel._panel.reveal(column);

      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "driftViewer",
      "Drift Viewer",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    DriftViewerPanel.currentPanel = new DriftViewerPanel(panel, host, port);
  }

  private constructor(panel: vscode.WebviewPanel, host: string, port: number) {
    this._panel = panel;
    this._update(host, port);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  private async _update(host: string, port: number): Promise<void> {
    const baseUrl = `http://${host}:${port}`;
    try {
      const resp = await fetch(baseUrl);
      let html = await resp.text();

      // Inject <base> so relative fetch('/api/...') calls resolve to server
      html = html.replace("<head>", `<head><base href="${baseUrl}/">`);

      // Set CSP to allow connections to the debug server
      const csp = [
        `default-src 'none'`,
        `connect-src ${baseUrl}`,
        `style-src 'unsafe-inline'`,
        `script-src 'unsafe-inline'`,
        `img-src ${baseUrl} data:`,
      ].join("; ");
      html = html.replace(
        "<head>",
        `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`,
      );

      this._panel.webview.html = html;
    } catch {
      this._panel.webview.html = `
        <html><body style="padding:2rem;font-family:system-ui;">
          <h2>Cannot connect to Drift debug server</h2>
          <p>Expected server at <code>${baseUrl}</code></p>
          <p>Make sure your Flutter app is running with <code>DriftDebugServer.start()</code>.</p>
          <button onclick="location.reload()">Retry</button>
        </body></html>`;
    }
  }

  dispose(): void {
    DriftViewerPanel.currentPanel = undefined;
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
  }
}
```

### Updated `extension/src/extension.ts`

```typescript
import * as vscode from "vscode";
import { DriftViewerPanel } from "./panel";

export function activate(context: vscode.ExtensionContext): void {
  // Existing: open in browser
  context.subscriptions.push(
    vscode.commands.registerCommand("driftViewer.openInBrowser", async () => {
      const cfg = vscode.workspace.getConfiguration("driftViewer");
      const host = cfg.get<string>("host", "127.0.0.1") ?? "127.0.0.1";
      const port = cfg.get<number>("port", 8642) ?? 8642;
      await vscode.env.openExternal(vscode.Uri.parse(`http://${host}:${port}`));
    }),
  );

  // New: open in editor panel
  context.subscriptions.push(
    vscode.commands.registerCommand("driftViewer.openInPanel", async () => {
      const cfg = vscode.workspace.getConfiguration("driftViewer");
      const host = cfg.get<string>("host", "127.0.0.1") ?? "127.0.0.1";
      const port = cfg.get<number>("port", 8642) ?? 8642;
      DriftViewerPanel.createOrShow(context.extensionUri, host, port);
    }),
  );
}

export function deactivate(): void {}
```

### Key Technical Decisions

1. **Fetch HTML from server** (not iframe): VS Code webviews don't support iframes to localhost. We fetch the HTML string and set it as `webview.html`.

2. **`<base>` tag injection**: The embedded JS uses relative `fetch('/api/tables')` calls. The `<base href>` makes these resolve to the server URL.

3. **`retainContextWhenHidden: true`**: Preserves webview state (scroll position, SQL input, etc.) when the tab is hidden. Uses more memory but essential for UX.

4. **CSP**: Strict Content Security Policy allowing only connections to the debug server. `'unsafe-inline'` needed because all JS/CSS is inline.

5. **Node 18+ `fetch`**: VS Code 1.85+ runs on Node 18+ which has native `fetch`. No additional dependency needed.

### Status Bar Item (Optional Enhancement)

```typescript
// Show connection status in status bar
const statusItem = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Right,
  100,
);
statusItem.text = "$(database) Drift Viewer";
statusItem.command = "driftViewer.openInPanel";
statusItem.tooltip = "Open Drift Viewer in editor panel";
statusItem.show();
context.subscriptions.push(statusItem);
```

## Effort Estimate

**M (Medium)**

- Server: 0 lines changed
- Extension: ~100 lines new TypeScript (panel.ts), ~20 lines modified (extension.ts), ~10 lines JSON (package.json)
- Main risk: CSP debugging in webview context

## Dependencies & Risks

- **CSP strictness**: VS Code webviews enforce CSP. The long-poll for `/api/generation` must be allowed — covered by `connect-src`.
- **Memory**: `retainContextWhenHidden` keeps the webview in memory. Acceptable for a debug tool.
- **Server not running**: Need clear error + retry UX (handled in the error HTML fallback).
- **Auth tokens**: If the server uses Bearer auth, the token is already embedded in the HTML's JS `authOpts()` helper — no extra handling needed.
- **No new npm dependencies**: Uses native Node `fetch`.

## Testing Strategy

1. **Manual**: Open VS Code, run "Drift Viewer: Open in Editor Panel" command
   - Verify tables load and are browsable
   - Verify SQL runner works (POST requests through CSP)
   - Verify live refresh long-poll works
   - Verify schema diagram SVG renders
   - Verify dark/light theme toggle works
   - Test docking: side-by-side, bottom panel, full tab
2. **Reconnection**: Stop Flutter app, verify error message appears, restart app, click Retry
3. **Extension test**: Use `@vscode/test-electron` to verify panel creation programmatically
4. **CSP audit**: Open DevTools in webview (`Developer: Open Webview Developer Tools`) and check console for CSP violations
