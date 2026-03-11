# Feature 7: Schema Linter (Diagnostics on Drift Tables)

## What It Does

Surfaces index suggestions and data anomalies from the running server as yellow/red squiggles directly on Dart column definitions. Issues show up in the Problems panel alongside compile errors — making database health as visible as type errors.

## User Experience

In the Problems panel:
```
WARNING  users.dart [Ln 5]   Column "email" has no index but is used as FK target (high priority)
WARNING  posts.dart [Ln 12]  3 orphaned FK(s): posts.author_id -> users.id
INFO     items.dart [Ln 8]   Column "created_at" may benefit from an index (date/time pattern)
ERROR    users.dart [Ln 3]   45 NULL values in users.deleted_at (10.5%) — data anomaly
```

Yellow squiggles appear under the column getter definitions in the Dart source. Red squiggles for errors (orphaned FKs, duplicates).

## New Files

```
extension/src/
  linter/
    schema-diagnostics.ts       # DiagnosticCollection manager
    issue-mapper.ts             # Maps server issues to Dart source locations
extension/src/test/
  schema-diagnostics.test.ts
  issue-mapper.test.ts
```

## Dependencies

- `api-client.ts` (Feature 1) — for API calls
- `generation-watcher.ts` (Feature 1) — refresh on data change
- `codelens/table-name-mapper.ts` (Feature 2) — map SQL names back to Dart classes
- Dart parser from Feature 5 (`dart-parser.ts`) — locate column definitions in source

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/index-suggestions` | Missing indexes with priority and suggested DDL |
| `GET /api/analytics/anomalies` | NULLs, orphaned FKs, duplicates, outliers |
| `GET /api/schema/metadata` | Map table/column names to verify matches |

## How It Works

### 1. Fetch Issues from Server

```typescript
interface ServerIssue {
  source: 'index-suggestion' | 'anomaly';
  severity: 'error' | 'warning' | 'info';
  table: string;
  column?: string;
  message: string;
  suggestedSql?: string;  // e.g., CREATE INDEX ...
}
```

Merge results from both endpoints into a unified `ServerIssue[]`.

### 2. Map to Dart Source Locations

For each issue:
1. Use `TableNameMapper` to find `sqlTable -> dartClassName`
2. Use `DartParser` to find the file and line number of that class
3. If `issue.column` is set, find the specific column getter line within the class
4. Create a `vscode.Diagnostic` at that location

```typescript
const diagnostics = vscode.languages.createDiagnosticCollection('driftViewer');

function updateDiagnostics(issues: ServerIssue[], parsedFiles: DartTable[]): void {
  // Group by file URI
  const byFile = new Map<string, vscode.Diagnostic[]>();

  for (const issue of issues) {
    const dartTable = findDartTable(issue.table, parsedFiles);
    if (!dartTable) continue;

    const line = issue.column
      ? findColumnLine(dartTable, issue.column)
      : dartTable.sourceLine;

    const range = new vscode.Range(line, 0, line, 999);
    const severity = mapSeverity(issue.severity);

    const diag = new vscode.Diagnostic(range, issue.message, severity);
    diag.source = 'Saropa Drift Advisor';
    diag.code = issue.source;

    // Attach quick fix if there's suggested SQL
    if (issue.suggestedSql) {
      diag.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(vscode.Uri.file(dartTable.sourceFile), range),
          `Suggested fix: ${issue.suggestedSql}`
        )
      ];
    }

    const uri = vscode.Uri.file(dartTable.sourceFile);
    const existing = byFile.get(uri.toString()) ?? [];
    existing.push(diag);
    byFile.set(uri.toString(), existing);
  }

  // Set all diagnostics (clears previous)
  diagnostics.clear();
  for (const [uriStr, diags] of byFile) {
    diagnostics.set(vscode.Uri.parse(uriStr), diags);
  }
}
```

### 3. Severity Mapping

| Server Severity | VS Code Severity | Squiggle Color |
|----------------|-----------------|----------------|
| `error` | `DiagnosticSeverity.Warning` | Yellow (not red — these are data issues, not compile errors) |
| `warning` | `DiagnosticSeverity.Warning` | Yellow |
| `info` | `DiagnosticSeverity.Information` | Blue |

Note: Server "error" maps to VS Code "Warning" because these are data quality issues, not syntax errors. Actual `DiagnosticSeverity.Error` (red) is reserved for compile errors. Configurable via settings.

### 4. Code Actions (Quick Fixes)

Register a `CodeActionProvider` for Dart files that offers:
- **"Copy CREATE INDEX SQL"** — for index suggestion diagnostics
- **"View anomalous data"** — opens the webview filtered to the problematic table

```typescript
class DriftCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(document, range, context): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diag of context.diagnostics) {
      if (diag.source !== 'Saropa Drift Advisor') continue;

      if (diag.code === 'index-suggestion' && diag.relatedInformation?.[0]) {
        const action = new vscode.CodeAction(
          'Copy CREATE INDEX SQL',
          vscode.CodeActionKind.QuickFix
        );
        action.command = {
          command: 'driftViewer.copySuggestedSql',
          title: 'Copy SQL',
          arguments: [diag.relatedInformation[0].message],
        };
        action.diagnostics = [diag];
        actions.push(action);
      }
    }
    return actions;
  }
}
```

### 5. Refresh Strategy

- On activation: fetch issues + parse Dart files, set diagnostics
- On `GenerationWatcher.onDidChange`: re-fetch issues, re-set diagnostics
- On Dart file save (`vscode.workspace.onDidSaveTextDocument`): re-parse that file, re-map issues
- Debounce: max 1 refresh per 5 seconds to avoid hammering during rapid saves

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      { "command": "driftViewer.runLinter", "title": "Saropa Drift Advisor: Run Schema Linter" },
      { "command": "driftViewer.copySuggestedSql", "title": "Saropa Drift Advisor: Copy Suggested SQL" }
    ],
    "configuration": {
      "properties": {
        "driftViewer.linter.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Show database diagnostics on Drift table definitions."
        },
        "driftViewer.linter.anomalySeverity": {
          "type": "string",
          "enum": ["error", "warning", "information", "hint"],
          "default": "warning",
          "description": "Severity level for data anomaly diagnostics."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
const diagnosticCollection = vscode.languages.createDiagnosticCollection('driftViewer');
context.subscriptions.push(diagnosticCollection);

const schemaDiagnostics = new SchemaDiagnostics(client, mapper, dartParser, diagnosticCollection);

watcher.onDidChange(() => schemaDiagnostics.refresh());
schemaDiagnostics.refresh(); // initial

context.subscriptions.push(
  vscode.languages.registerCodeActionsProvider(
    { language: 'dart', scheme: 'file' },
    new DriftCodeActionProvider(),
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  )
);
```

## Testing

- Test issue mapping: given server issues + parsed Dart files, verify correct diagnostics at correct lines
- Test severity mapping logic
- Test code action generation for index suggestions
- Test debounce behavior
- Mock both API endpoints and Dart parser output

## Known Limitations

- Diagnostics disappear when server is offline (by design — stale data is worse than no data)
- Column-level mapping fails if `.named('custom')` is used and Feature 5's parser doesn't detect it
- Anomaly detection runs on the full DB — no per-table filtering in the API
- Quick fixes only copy SQL; they cannot execute it (read-only server)
