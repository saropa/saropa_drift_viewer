# Drift Viewer (VS Code / Cursor)

One command: **Drift Viewer: Open in Browser** — opens http://127.0.0.1:8642 (configurable via `driftViewer.port` and `driftViewer.host`).

**Simpler option (no extension):** In this repo, use **Run Task → Open Drift Viewer** (`.vscode/tasks.json`). Your app must be running with the Drift server started.

## Install (development)

```bash
cd extension && npm install && npm run compile
```

Then in VS Code/Cursor: **Run > Run Extension** (F5).
