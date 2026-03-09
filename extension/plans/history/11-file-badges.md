# Feature 11: File Explorer Row Count Badges

## What It Does

Every `.dart` file containing Drift table definitions gets a badge in the file explorer showing the total row count across all tables in that file. Anomalous tables get yellow/red badges. A live heat map of where your data lives.

## User Experience

In the Explorer sidebar:

```
lib/
  database/
    tables/
      users.dart          [1.2K]     ← green badge, healthy
      posts.dart           [45K]     ← yellow badge, large table
      sessions.dart       [250K]     ← red badge, very large
      categories.dart       [12]     ← green badge, small
    app_database.dart
  screens/
    home.dart                        ← no badge, not a table file
```

Badge colors:

- **Green/default**: normal row counts
- **Yellow**: table has anomalies (from `/api/analytics/anomalies`)
- **Red**: table has errors (orphaned FKs, duplicates)

## New Files

```
extension/src/
  decorations/
    file-decoration-provider.ts     # FileDecorationProvider implementation
extension/src/test/
  file-decoration-provider.test.ts
```

## Dependencies

- `api-client.ts` (Feature 1) — fetch schema metadata and anomalies
- `generation-watcher.ts` (Feature 1) — refresh on data change
- Dart parser from Feature 5 (`dart-parser.ts`) — find which files contain which tables

## How It Works

### FileDecorationProvider

```typescript
class DriftFileDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[]
  >();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  // Cached: file URI -> decoration data
  private _decorations = new Map<string, FileDecoData>();

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const data = this._decorations.get(uri.toString());
    if (!data) return undefined;

    return {
      badge: data.badge, // "1K", "45K", "250K"
      color: data.color, // ThemeColor
      tooltip: data.tooltip, // "users: 1,200 rows\nposts: 45,000 rows"
    };
  }

  async refresh(
    client: DriftApiClient,
    tableFileMap: Map<string, string[]>,
  ): Promise<void> {
    // tableFileMap: sqlTableName -> [filePath, ...]

    const [metadata, anomalyResp] = await Promise.all([
      client.schemaMetadata(),
      client.fetchAnomalies(),
    ]);

    // Build: filePath -> { totalRows, hasAnomaly, hasError, tables[] }
    const fileData = new Map<
      string,
      { totalRows: number; severity: Severity; tables: string[] }
    >();

    for (const table of metadata.tables) {
      const files = tableFileMap.get(table.name) ?? [];
      for (const file of files) {
        const existing = fileData.get(file) ?? {
          totalRows: 0,
          severity: "ok",
          tables: [],
        };
        existing.totalRows += table.rowCount;
        existing.tables.push(
          `${table.name}: ${formatCount(table.rowCount)} rows`,
        );

        // Check anomalies for this table
        const tableAnomalies = anomalyResp.anomalies.filter(
          (a) => a.table === table.name,
        );
        if (tableAnomalies.some((a) => a.severity === "error")) {
          existing.severity = "error";
        } else if (
          tableAnomalies.some((a) => a.severity === "warning") &&
          existing.severity !== "error"
        ) {
          existing.severity = "warning";
        }

        fileData.set(file, existing);
      }
    }

    // Update decorations
    this._decorations.clear();
    const changedUris: vscode.Uri[] = [];

    for (const [filePath, data] of fileData) {
      const uri = vscode.Uri.file(filePath);
      this._decorations.set(uri.toString(), {
        badge: formatCount(data.totalRows),
        color: severityColor(data.severity),
        tooltip: data.tables.join("\n"),
      });
      changedUris.push(uri);
    }

    this._onDidChangeFileDecorations.fire(changedUris);
  }
}
```

### Count Formatting

```typescript
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
```

Badge text is limited to ~3 characters by VS Code, so abbreviation is required.

### Severity Colors

```typescript
function severityColor(severity: string): vscode.ThemeColor | undefined {
  switch (severity) {
    case "error":
      return new vscode.ThemeColor("list.errorForeground");
    case "warning":
      return new vscode.ThemeColor("list.warningForeground");
    default:
      return undefined; // default color
  }
}
```

### Table-to-File Mapping

Built by the Dart parser (Feature 5):

1. Scan workspace `.dart` files for `class ... extends Table`
2. Map each SQL table name to its source file path
3. Cache and refresh on file changes

If Feature 5 isn't implemented yet, use a simpler approach:

- Fetch table names from `/api/tables`
- Search for `class TableName extends Table` in `.dart` files using `vscode.workspace.findFiles` + `vscode.workspace.openTextDocument` + regex

## package.json Contributions

No special contributions — `FileDecorationProvider` is registered programmatically.

```jsonc
{
  "contributes": {
    "configuration": {
      "properties": {
        "driftViewer.fileBadges.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Show row count badges on Drift table files in the explorer.",
        },
      },
    },
  },
}
```

## Wiring in extension.ts

```typescript
const fileDecoProvider = new DriftFileDecorationProvider();
context.subscriptions.push(
  vscode.window.registerFileDecorationProvider(fileDecoProvider),
);

// Refresh on data change
watcher.onDidChange(async () => {
  const tableFileMap = await buildTableFileMap(); // from dart parser
  await fileDecoProvider.refresh(client, tableFileMap);
});
```

## Testing

- Test count formatting (0, 999, 1000, 1500, 1M+)
- Test severity color mapping
- Test decoration provider returns correct badge/color for known file URIs
- Test file with multiple tables sums row counts correctly

## Known Limitations

- Badge text is ~3 chars max — counts above 999M would show "1.0B" which may not fit
- `FileDecorationProvider` applies to the Explorer only, not editor tabs
- Anomaly severity is per-table but badges are per-file — if one table has errors, the whole file gets a red badge
- Requires table-to-file mapping, which depends on Dart parsing (Feature 5) or a simpler workspace search
- Badges update on generation change, not in real-time (acceptable delay)
