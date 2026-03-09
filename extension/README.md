# Drift Viewer (VS Code / Cursor)

## Database Explorer

A **database icon** in the activity bar opens a tree view showing:

- Connection status (green/red indicator)
- Tables with row counts
- Columns with type icons (key, number, string, blob)
- Foreign key relationships

Right-click actions: **View Data**, **Copy Name**, **Export CSV**, **Filter by Column**. The tree auto-refreshes when the app writes to the database.

## Commands

- **Drift Viewer: Open in Browser** — opens the viewer in your default browser.
- **Drift Viewer: Open in Editor Panel** — opens the viewer in a VS Code webview tab (side-by-side with code, no context switching).
- **Refresh** — manually refresh the database tree (also available in tree header).

A status bar item (**$(database) Drift Viewer**) is also shown for quick access to the editor panel.

All features connect to `http://127.0.0.1:8642` by default (configurable via `driftViewer.host` and `driftViewer.port`).

**Simpler option (no extension):** In this repo, use **Run Task → Open Drift Viewer** (`.vscode/tasks.json`). Your app must be running with the Drift server started.

## Install (development)

```bash
cd extension && npm install && npm run compile
```

Then in VS Code/Cursor: **Run > Run Extension** (F5).

## Tests

```bash
cd extension && npm test
```
