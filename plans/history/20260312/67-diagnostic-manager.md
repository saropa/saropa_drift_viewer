# Feature 67: Centralized Diagnostic Manager

## What It Does

A centralized architecture for reporting problems to VS Code's Problems panel. Provides a plug-in system where multiple diagnostic providers (schema analysis, query performance, data quality, best practices, etc.) can register and report issues. All diagnostics use the `[drift_advisor]` prefix for easy filtering and sorting. Replaces the current tightly-coupled `SchemaDiagnostics` with a scalable, extensible system.

## User Experience

1. Problems appear in VS Code's Problems panel with consistent formatting:

```
╔═══════════════════════════════════════════════════════════════════════════╗
║ PROBLEMS (12)                                              Filter: drift_ ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                           ║
║ ⛔ lib/database/tables.dart                                               ║
║   [drift_advisor] Orphaned FK values in "orders.user_id" (3 rows)    :42  ║
║   [drift_advisor] Column "orders.status" in Dart but missing in DB   :67  ║
║                                                                           ║
║ ⚠️ lib/database/tables.dart                                               ║
║   [drift_advisor] FK column "orders.user_id" lacks an index          :45  ║
║   [drift_advisor] Column "orders.notes" has 67% NULL values          :52  ║
║   [drift_advisor] Query causes full table scan on "orders"           :89  ║
║                                                                           ║
║ ℹ️ lib/database/tables.dart                                               ║
║   [drift_advisor] Table "audit_log" has no foreign key relationships :12  ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

2. Click any problem → jumps to exact line in Dart source
3. Quick fixes available via lightbulb menu (Cmd+.)
4. Filter by typing "drift_advisor" in Problems panel filter
5. Group by severity, file, or diagnostic code
6. Settings to enable/disable specific diagnostic categories

### Settings

```json
{
  "driftViewer.diagnostics.enabled": true,
  "driftViewer.diagnostics.refreshOnSave": true,
  "driftViewer.diagnostics.refreshIntervalMs": 30000,
  "driftViewer.diagnostics.categories": {
    "schema": true,
    "performance": true,
    "dataQuality": true,
    "bestPractices": true,
    "naming": false
  },
  "driftViewer.diagnostics.severityOverrides": {
    "high-null-rate": "hint",
    "missing-fk-index": "error"
  }
}
```

## New Files

```
extension/src/
  diagnostics/
    diagnostic-manager.ts       # Central coordinator, owns DiagnosticCollection
    diagnostic-types.ts         # Shared interfaces (IDiagnosticProvider, etc.)
    diagnostic-codes.ts         # All diagnostic code definitions with metadata
    providers/
      schema-provider.ts        # Schema quality issues (missing PK, type drift, etc.)
      performance-provider.ts   # Query performance issues (full scans, slow queries)
      data-quality-provider.ts  # Data quality issues (null rates, outliers)
      best-practice-provider.ts # Drift conventions and patterns
      naming-provider.ts        # Naming convention checks
      runtime-provider.ts       # Runtime issues (data breakpoints)
extension/src/test/
    diagnostic-manager.test.ts
    schema-provider.test.ts
    performance-provider.test.ts
```

## Dependencies

- `api-client.ts` — schema metadata, anomalies, index suggestions, performance
- `engines/schema-intelligence.ts` — cached schema insights
- `engines/query-intelligence.ts` — query pattern analysis
- `schema-diff/dart-parser.ts` — Dart source parsing
- `profiler/profiler-queries.ts` — column profiling data
- `query-cost/explain-parser.ts` — query plan analysis

## Architecture

### Core Types

```typescript
/** Unique diagnostic code with metadata. */
interface IDiagnosticCode {
  code: string;                           // e.g., 'missing-fk-index'
  category: DiagnosticCategory;
  defaultSeverity: vscode.DiagnosticSeverity;
  messageTemplate: string;                // e.g., 'FK column "{table}.{column}" lacks an index'
  documentation?: string;                 // Link to docs
  hasFix?: boolean;                       // Whether quick fix is available
}

type DiagnosticCategory =
  | 'schema'
  | 'performance'
  | 'dataQuality'
  | 'bestPractices'
  | 'naming'
  | 'runtime';

/** A single reported issue. */
interface IDiagnosticIssue {
  code: string;                           // References IDiagnosticCode.code
  message: string;                        // Formatted message
  fileUri: vscode.Uri;
  range: vscode.Range;
  severity?: vscode.DiagnosticSeverity;   // Override default
  relatedInfo?: vscode.DiagnosticRelatedInformation[];
  data?: Record<string, unknown>;         // For quick fix actions
}

/** Provider interface for plug-in architecture. */
interface IDiagnosticProvider {
  readonly id: string;
  readonly category: DiagnosticCategory;
  
  /** Collect diagnostics. Called by manager during refresh. */
  collectDiagnostics(context: IDiagnosticContext): Promise<IDiagnosticIssue[]>;
  
  /** Optional: provide quick fixes for a diagnostic. */
  provideCodeActions?(
    diagnostic: vscode.Diagnostic,
    document: vscode.TextDocument,
  ): vscode.CodeAction[];
  
  /** Dispose resources. */
  dispose(): void;
}

/** Context passed to providers during collection. */
interface IDiagnosticContext {
  client: DriftApiClient;
  schemaIntel: SchemaIntelligence;
  queryIntel: QueryIntelligence;
  dartFiles: IDartFileInfo[];
  config: IDiagnosticConfig;
}

interface IDartFileInfo {
  uri: vscode.Uri;
  text: string;
  tables: IDartTable[];        // Pre-parsed Drift tables
}
```

### DiagnosticManager

```typescript
/**
 * Central coordinator for all diagnostic providers.
 * Owns the single DiagnosticCollection and orchestrates refresh cycles.
 */
export class DiagnosticManager implements vscode.Disposable {
  private readonly _collection: vscode.DiagnosticCollection;
  private readonly _providers = new Map<string, IDiagnosticProvider>();
  private readonly _disposables: vscode.Disposable[] = [];
  private _refreshTimer: NodeJS.Timeout | undefined;
  private _isRefreshing = false;

  constructor(
    private readonly _client: DriftApiClient,
    private readonly _schemaIntel: SchemaIntelligence,
    private readonly _queryIntel: QueryIntelligence,
  ) {
    this._collection = vscode.languages.createDiagnosticCollection('drift-advisor');
    this._disposables.push(this._collection);
    this._setupListeners();
  }

  /** Register a diagnostic provider. */
  registerProvider(provider: IDiagnosticProvider): vscode.Disposable {
    this._providers.set(provider.id, provider);
    return {
      dispose: () => {
        this._providers.delete(provider.id);
        provider.dispose();
      },
    };
  }

  /** Trigger a full refresh of all diagnostics. */
  async refresh(): Promise<void> {
    if (this._isRefreshing) return;
    this._isRefreshing = true;

    try {
      const config = this._loadConfig();
      if (!config.enabled) {
        this._collection.clear();
        return;
      }

      const context = await this._buildContext(config);
      const allIssues: IDiagnosticIssue[] = [];

      // Collect from all enabled providers in parallel
      const results = await Promise.allSettled(
        [...this._providers.values()]
          .filter(p => config.categories[p.category])
          .map(p => p.collectDiagnostics(context))
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          allIssues.push(...result.value);
        }
      }

      // Group by file and set on collection
      this._applyDiagnostics(allIssues, config);
    } finally {
      this._isRefreshing = false;
    }
  }

  /** Clear all diagnostics. */
  clear(): void {
    this._collection.clear();
  }

  private _applyDiagnostics(
    issues: IDiagnosticIssue[],
    config: IDiagnosticConfig,
  ): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const issue of issues) {
      const codeInfo = DIAGNOSTIC_CODES[issue.code];
      if (!codeInfo) continue;

      // Apply severity override from settings
      const severity = config.severityOverrides[issue.code]
        ?? issue.severity
        ?? codeInfo.defaultSeverity;

      const diag = new vscode.Diagnostic(
        issue.range,
        `[drift_advisor] ${issue.message}`,
        severity,
      );
      diag.source = 'Drift Advisor';
      diag.code = issue.code;
      if (issue.relatedInfo) {
        diag.relatedInformation = issue.relatedInfo;
      }

      const key = issue.fileUri.toString();
      const list = byFile.get(key) ?? [];
      list.push(diag);
      byFile.set(key, list);
    }

    this._collection.clear();
    for (const [uri, diags] of byFile) {
      this._collection.set(vscode.Uri.parse(uri), diags);
    }
  }

  private _setupListeners(): void {
    // Refresh on document save
    this._disposables.push(
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (doc.languageId === 'dart') {
          this._scheduleRefresh();
        }
      })
    );

    // Refresh on generation change
    this._disposables.push(
      this._schemaIntel.onDidChange(() => this._scheduleRefresh())
    );

    // Refresh on config change
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('driftViewer.diagnostics')) {
          this.refresh();
        }
      })
    );
  }

  private _scheduleRefresh(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }
    const config = this._loadConfig();
    this._refreshTimer = setTimeout(
      () => this.refresh(),
      Math.min(config.refreshIntervalMs, 5000),
    );
  }

  dispose(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }
    for (const p of this._providers.values()) {
      p.dispose();
    }
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
```

### Diagnostic Code Registry

```typescript
// diagnostic-codes.ts

export const DIAGNOSTIC_CODES: Record<string, IDiagnosticCode> = {
  // Schema Quality
  'no-primary-key': {
    code: 'no-primary-key',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Table "{table}" has no primary key',
    hasFix: true,
  },
  'missing-fk-index': {
    code: 'missing-fk-index',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'FK column "{table}.{column}" lacks an index',
    hasFix: true,
  },
  'orphaned-fk': {
    code: 'orphaned-fk',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Error,
    messageTemplate: 'Orphaned FK values in "{table}.{column}" ({count} rows)',
    hasFix: true,
  },
  'column-type-drift': {
    code: 'column-type-drift',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Column "{table}.{column}" type mismatch: Dart={dartType}, DB={dbType}',
    hasFix: false,
  },
  'missing-column-in-db': {
    code: 'missing-column-in-db',
    category: 'schema',
    defaultSeverity: vscode.DiagnosticSeverity.Error,
    messageTemplate: 'Column "{table}.{column}" defined in Dart but missing from database',
    hasFix: true,
  },

  // Query Performance
  'full-table-scan': {
    code: 'full-table-scan',
    category: 'performance',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Query causes full table scan on "{table}"',
    hasFix: true,
  },
  'slow-query-pattern': {
    code: 'slow-query-pattern',
    category: 'performance',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Slow query pattern (avg {avgMs}ms)',
    hasFix: false,
  },

  // Data Quality
  'high-null-rate': {
    code: 'high-null-rate',
    category: 'dataQuality',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Column "{table}.{column}" has {pct}% NULL values',
    hasFix: false,
  },
  'unique-violation': {
    code: 'unique-violation',
    category: 'dataQuality',
    defaultSeverity: vscode.DiagnosticSeverity.Error,
    messageTemplate: 'UNIQUE constraint violation: {count} duplicate values',
    hasFix: false,
  },

  // Best Practices
  'text-pk': {
    code: 'text-pk',
    category: 'bestPractices',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Table "{table}" uses TEXT primary key (INTEGER recommended)',
    hasFix: false,
  },
  'cascade-risk': {
    code: 'cascade-risk',
    category: 'bestPractices',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Deleting from "{table}" cascades to {count} dependent rows',
    hasFix: false,
  },

  // Naming
  'table-name-case': {
    code: 'table-name-case',
    category: 'naming',
    defaultSeverity: vscode.DiagnosticSeverity.Hint,
    messageTemplate: 'Table "{table}" doesn\'t follow snake_case convention',
    hasFix: true,
  },
  'reserved-word': {
    code: 'reserved-word',
    category: 'naming',
    defaultSeverity: vscode.DiagnosticSeverity.Warning,
    messageTemplate: 'Column "{table}.{column}" uses SQL reserved word',
    hasFix: false,
  },
};
```

### Example Provider: SchemaProvider

```typescript
// providers/schema-provider.ts

export class SchemaProvider implements IDiagnosticProvider {
  readonly id = 'schema';
  readonly category: DiagnosticCategory = 'schema';

  async collectDiagnostics(ctx: IDiagnosticContext): Promise<IDiagnosticIssue[]> {
    const issues: IDiagnosticIssue[] = [];

    const [insights, dbSchema] = await Promise.all([
      ctx.schemaIntel.getInsights(),
      ctx.client.schemaMetadata(),
    ]);

    // Check each Dart file's tables
    for (const file of ctx.dartFiles) {
      for (const dartTable of file.tables) {
        const dbTable = dbSchema.find(t => t.name === dartTable.sqlTableName);

        // Missing primary key
        if (!dartTable.columns.some(c => c.autoIncrement)) {
          const hasPkInDb = dbTable?.columns.some(c => c.pk);
          if (!hasPkInDb) {
            issues.push({
              code: 'no-primary-key',
              message: `Table "${dartTable.sqlTableName}" has no primary key`,
              fileUri: file.uri,
              range: new vscode.Range(dartTable.line, 0, dartTable.line, 999),
            });
          }
        }

        // Column drift check
        for (const dartCol of dartTable.columns) {
          const dbCol = dbTable?.columns.find(c => c.name === dartCol.sqlName);
          
          if (!dbCol) {
            issues.push({
              code: 'missing-column-in-db',
              message: `Column "${dartTable.sqlTableName}.${dartCol.sqlName}" defined in Dart but missing from database`,
              fileUri: file.uri,
              range: new vscode.Range(dartCol.line, 0, dartCol.line, 999),
              severity: vscode.DiagnosticSeverity.Error,
            });
          } else if (dbCol.type !== dartCol.sqlType) {
            issues.push({
              code: 'column-type-drift',
              message: `Column "${dartTable.sqlTableName}.${dartCol.sqlName}" type mismatch: Dart=${dartCol.sqlType}, DB=${dbCol.type}`,
              fileUri: file.uri,
              range: new vscode.Range(dartCol.line, 0, dartCol.line, 999),
            });
          }
        }
      }
    }

    // Missing FK indexes (from existing API)
    for (const suggestion of insights.missingIndexes) {
      const dartFile = this._findDartFile(ctx.dartFiles, suggestion.table);
      if (!dartFile) continue;

      const dartTable = dartFile.tables.find(t => t.sqlTableName === suggestion.table);
      const dartCol = dartTable?.columns.find(c => c.sqlName === suggestion.column);
      const line = dartCol?.line ?? dartTable?.line ?? 0;

      issues.push({
        code: 'missing-fk-index',
        message: `FK column "${suggestion.table}.${suggestion.column}" lacks an index`,
        fileUri: dartFile.uri,
        range: new vscode.Range(line, 0, line, 999),
        relatedInfo: [
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(dartFile.uri, new vscode.Range(line, 0, line, 999)),
            `Suggested: ${suggestion.sql}`,
          ),
        ],
        data: { sql: suggestion.sql },
      });
    }

    // Orphaned FKs (from anomalies API)
    for (const anomaly of insights.anomalies) {
      if (anomaly.severity !== 'error') continue;
      const match = anomaly.message.match(/(\w+)\.(\w+)/);
      if (!match) continue;

      const [, table, column] = match;
      const dartFile = this._findDartFile(ctx.dartFiles, table);
      if (!dartFile) continue;

      const dartTable = dartFile.tables.find(t => t.sqlTableName === table);
      const line = dartTable?.line ?? 0;

      issues.push({
        code: 'orphaned-fk',
        message: anomaly.message,
        fileUri: dartFile.uri,
        range: new vscode.Range(line, 0, line, 999),
        severity: vscode.DiagnosticSeverity.Error,
      });
    }

    return issues;
  }

  provideCodeActions(
    diag: vscode.Diagnostic,
    doc: vscode.TextDocument,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    if (diag.code === 'missing-fk-index') {
      const sql = (diag as any).data?.sql;
      if (sql) {
        const copyAction = new vscode.CodeAction(
          'Copy CREATE INDEX SQL',
          vscode.CodeActionKind.QuickFix,
        );
        copyAction.command = {
          command: 'driftViewer.copySuggestedSql',
          title: 'Copy SQL',
          arguments: [sql],
        };
        actions.push(copyAction);

        const runAction = new vscode.CodeAction(
          'Run CREATE INDEX Now',
          vscode.CodeActionKind.QuickFix,
        );
        runAction.command = {
          command: 'driftViewer.runIndexSql',
          title: 'Run SQL',
          arguments: [sql],
        };
        runAction.isPreferred = true;
        actions.push(runAction);
      }
    }

    if (diag.code === 'missing-column-in-db') {
      const migrationAction = new vscode.CodeAction(
        'Generate Migration',
        vscode.CodeActionKind.QuickFix,
      );
      migrationAction.command = {
        command: 'driftViewer.generateMigration',
        title: 'Generate Migration',
      };
      actions.push(migrationAction);
    }

    return actions;
  }

  private _findDartFile(
    files: IDartFileInfo[],
    tableName: string,
  ): IDartFileInfo | undefined {
    return files.find(f => f.tables.some(t => t.sqlTableName === tableName));
  }

  dispose(): void {}
}
```

## Integration with extension.ts

```typescript
// In extension.ts activate()

// Create diagnostic manager
const diagnosticManager = new DiagnosticManager(client, schemaIntel, queryIntel);
context.subscriptions.push(diagnosticManager);

// Register all providers
context.subscriptions.push(
  diagnosticManager.registerProvider(new SchemaProvider()),
  diagnosticManager.registerProvider(new PerformanceProvider()),
  diagnosticManager.registerProvider(new DataQualityProvider()),
  diagnosticManager.registerProvider(new BestPracticeProvider()),
  diagnosticManager.registerProvider(new NamingProvider()),
  diagnosticManager.registerProvider(new RuntimeProvider()),
);

// Register unified code action provider
context.subscriptions.push(
  vscode.languages.registerCodeActionsProvider(
    { language: 'dart', scheme: 'file' },
    new DiagnosticCodeActionProvider(diagnosticManager),
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
  ),
);

// Initial refresh
diagnosticManager.refresh();
```

## Migration from SchemaDiagnostics

The new `DiagnosticManager` replaces `SchemaDiagnostics`:

| Old | New |
|-----|-----|
| `SchemaDiagnostics` class | `DiagnosticManager` + `SchemaProvider` |
| `issue-mapper.ts` | Logic distributed to providers |
| `DriftCodeActionProvider` | `DiagnosticCodeActionProvider` |
| `drift-linter` collection name | `drift-advisor` collection name |
| No prefix on messages | `[drift_advisor]` prefix on all messages |

The old `linter/` folder can be deprecated once migration is complete.

## Diagnostic Categories Summary

| Category | Provider | Issue Count | Priority |
|----------|----------|-------------|----------|
| Schema | `SchemaProvider` | ~12 codes | High |
| Performance | `PerformanceProvider` | ~6 codes | High |
| Data Quality | `DataQualityProvider` | ~7 codes | Medium |
| Best Practices | `BestPracticeProvider` | ~9 codes | Medium |
| Naming | `NamingProvider` | ~4 codes | Low |
| Runtime | `RuntimeProvider` | ~3 codes | Low |

## Implementation Phases

### Phase 1: Core Infrastructure
1. Create `diagnostic-manager.ts` with `DiagnosticManager` class
2. Create `diagnostic-types.ts` with interfaces
3. Create `diagnostic-codes.ts` with code registry
4. Update `extension.ts` to use new manager

### Phase 2: Schema Provider (Port Existing)
1. Create `SchemaProvider` that replicates current `SchemaDiagnostics`
2. Add `[drift_advisor]` prefix
3. Add missing PK, type drift, column drift checks
4. Deprecate old `linter/` folder

### Phase 3: Performance Provider
1. Integrate with `QueryIntelligence`
2. Integrate with `ExplainParser`
3. Report full scans, slow patterns, N+1 detection

### Phase 4: Data Quality Provider
1. Integrate with profiler queries
2. Report high null rates, outliers
3. Add constraint violation detection

### Phase 5: Best Practice + Naming Providers
1. Add Drift convention checks
2. Add naming pattern validation
3. Add reserved word detection

### Phase 6: Runtime Provider
1. Integrate with data breakpoint checker
2. Report runtime data changes

## Testing Strategy

```typescript
describe('DiagnosticManager', () => {
  it('should collect from all registered providers', async () => {});
  it('should apply [drift_advisor] prefix to all messages', async () => {});
  it('should respect category enable/disable settings', async () => {});
  it('should apply severity overrides from settings', async () => {});
  it('should debounce refresh on rapid file saves', async () => {});
  it('should clear diagnostics when disabled', async () => {});
});

describe('SchemaProvider', () => {
  it('should report missing primary key', async () => {});
  it('should report column type drift', async () => {});
  it('should report missing FK index with SQL fix', async () => {});
  it('should provide quick fix code actions', async () => {});
});
```

## Success Metrics

- All diagnostics use `[drift_advisor]` prefix
- Users can filter Problems panel by typing "drift_advisor"
- All existing index suggestion / anomaly diagnostics still work
- New diagnostic categories discoverable via settings
- Quick fixes available for fixable issues
- Diagnostics refresh automatically on file save and generation change
