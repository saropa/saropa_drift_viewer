# Feature 10: Clickable SQL Errors in Terminal

## What It Does

When the debug console prints `SqliteException: no such table: user_settigns`, the table name becomes a clickable link that jumps to the closest-matching table in the tree view and suggests "Did you mean `user_settings`?"

## User Experience

1. App crashes with a SQLite error in the debug console
2. The table/column name in the error is underlined and clickable
3. Click it → extension:
   - Finds the closest matching table name (fuzzy match)
   - Shows notification: "Did you mean `user_settings`? (edit distance: 1)"
   - Opens the tree view and reveals that table
   - If no close match: shows all available tables in a QuickPick

## New Files

```
extension/src/
  terminal/
    drift-terminal-link-provider.ts   # TerminalLinkProvider
    fuzzy-match.ts                    # Levenshtein distance / fuzzy table matching
extension/src/test/
  drift-terminal-link-provider.test.ts
  fuzzy-match.test.ts
```

## Dependencies

- `api-client.ts` (Feature 1) — fetch table list for matching
- Tree view from Feature 1 — reveal matched table

## How It Works

### Terminal Link Provider

```typescript
class DriftTerminalLinkProvider implements vscode.TerminalLinkProvider<DriftTerminalLink> {
  constructor(private readonly _client: DriftApiClient) {}

  provideTerminalLinks(
    context: vscode.TerminalLinkContext,
    token: vscode.CancellationToken,
  ): DriftTerminalLink[] {
    const links: DriftTerminalLink[] = [];
    const line = context.line;

    // Pattern 1: "no such table: tablename"
    const noTableMatch = /no such table:\s*(\w+)/i.exec(line);
    if (noTableMatch) {
      links.push(new DriftTerminalLink(
        noTableMatch.index + noTableMatch[0].indexOf(noTableMatch[1]),
        noTableMatch[1].length,
        noTableMatch[1],
        'table',
      ));
    }

    // Pattern 2: "no such column: tablename.columnname"
    const noColumnMatch = /no such column:\s*(\w+)\.(\w+)/i.exec(line);
    if (noColumnMatch) {
      links.push(new DriftTerminalLink(
        noColumnMatch.index + noColumnMatch[0].indexOf(noColumnMatch[1]),
        noColumnMatch[1].length + 1 + noColumnMatch[2].length,
        noColumnMatch[1],
        'column',
        noColumnMatch[2],
      ));
    }

    // Pattern 3: "UNIQUE constraint failed: tablename.column"
    const uniqueMatch = /UNIQUE constraint failed:\s*(\w+)\.(\w+)/i.exec(line);
    if (uniqueMatch) {
      links.push(new DriftTerminalLink(
        uniqueMatch.index + uniqueMatch[0].indexOf(uniqueMatch[1]),
        uniqueMatch[1].length,
        uniqueMatch[1],
        'table',
      ));
    }

    // Pattern 4: "FOREIGN KEY constraint failed" (no specific table, link the whole phrase)
    const fkMatch = /FOREIGN KEY constraint failed/i.exec(line);
    if (fkMatch) {
      links.push(new DriftTerminalLink(
        fkMatch.index,
        fkMatch[0].length,
        null,
        'fk_error',
      ));
    }

    return links;
  }

  async handleTerminalLink(link: DriftTerminalLink): Promise<void> {
    if (link.type === 'fk_error') {
      // No specific table — run anomaly scan for orphaned FKs
      vscode.commands.executeCommand('driftViewer.openWatchPanel');
      return;
    }

    const tables = await this._client.tables();
    const target = link.tableName!;

    // Exact match
    if (tables.includes(target)) {
      revealInTree(target);
      return;
    }

    // Fuzzy match
    const suggestions = findClosestMatches(target, tables, 3);
    if (suggestions.length === 1 && suggestions[0].distance <= 2) {
      const match = suggestions[0].name;
      const action = await vscode.window.showInformationMessage(
        `Table "${target}" not found. Did you mean "${match}"?`,
        'View Table', 'Show All Tables'
      );
      if (action === 'View Table') revealInTree(match);
      if (action === 'Show All Tables') showTablePicker(tables);
    } else if (suggestions.length > 0) {
      showTablePicker(tables, `No exact match for "${target}". Select a table:`);
    }
  }
}
```

### Fuzzy Matching

```typescript
// fuzzy-match.ts

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

interface FuzzyResult {
  name: string;
  distance: number;
}

function findClosestMatches(target: string, candidates: string[], maxResults: number): FuzzyResult[] {
  return candidates
    .map(name => ({ name, distance: levenshtein(target.toLowerCase(), name.toLowerCase()) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults);
}
```

### Error Patterns Recognized

| SQLite Error | Extracted Info | Link Action |
|-------------|---------------|-------------|
| `no such table: X` | table name | Fuzzy match → reveal in tree |
| `no such column: X.Y` | table + column | Fuzzy match table → reveal column |
| `UNIQUE constraint failed: X.Y` | table + column | Reveal table in tree |
| `FOREIGN KEY constraint failed` | (none) | Open anomaly panel |
| `table X already exists` | table name | Reveal in tree |
| `NOT NULL constraint failed: X.Y` | table + column | Reveal table + column |

## package.json Contributions

No special contributions needed — `TerminalLinkProvider` is registered programmatically.

```jsonc
{
  "contributes": {
    "commands": [{
      "command": "driftViewer.showAllTables",
      "title": "Saropa Drift Advisor: Show All Tables"
    }]
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.window.registerTerminalLinkProvider(
    new DriftTerminalLinkProvider(client)
  )
);
```

## Testing

- `fuzzy-match.test.ts`: test Levenshtein distance for known pairs, test `findClosestMatches` ranking
- `drift-terminal-link-provider.test.ts`: test regex patterns against real SQLite error strings, test link creation with correct offsets
- No need to test actual terminal integration — unit test the provider methods

## Known Limitations

- Only matches English SQLite error messages (not localized)
- TerminalLinkProvider scans line by line — multi-line errors may not be fully captured
- Fuzzy matching is best-effort — Levenshtein distance doesn't account for transpositions well
- Links only appear in VS Code terminals, not in external terminal windows
- Debug console output may not trigger TerminalLinkProvider in all VS Code versions (works in integrated terminal)
