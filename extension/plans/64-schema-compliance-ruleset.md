# Feature 64: Schema Compliance Ruleset

## What It Does

Define team-wide schema conventions in a `.drift-rules.json` config file and validate the live database schema against them. Rules cover naming conventions, required columns, FK naming patterns, type restrictions, and structural constraints. Results surface as VS Code diagnostics (squiggles) on Drift table classes and can be checked in CI via a pre-launch task.

## User Experience

1. Create a `.drift-rules.json` in the project root
2. Extension validates the live schema against rules on every generation change
3. Violations appear as diagnostics on Dart table class files
4. Pre-launch task can block debug session if violations exist

```
╔══════════════════════════════════════════════════════════════╗
║  .drift-rules.json                                           ║
╠══════════════════════════════════════════════════════════════╣
║  {                                                           ║
║    "naming": {                                               ║
║      "tables": "snake_case",                                 ║
║      "columns": "snake_case",                                ║
║      "fkColumns": "{table}_id",                              ║
║      "indexes": "idx_{table}_{column}"                       ║
║    },                                                        ║
║    "requiredColumns": [                                      ║
║      { "name": "created_at", "type": "INTEGER" },           ║
║      { "name": "updated_at", "type": "INTEGER" }            ║
║    ],                                                        ║
║    "rules": [                                                ║
║      { "rule": "no-text-primary-key" },                      ║
║      { "rule": "require-fk-index" },                         ║
║      { "rule": "max-columns", "max": 20 },                  ║
║      { "rule": "no-nullable-fk" }                            ║
║    ]                                                         ║
║  }                                                           ║
╚══════════════════════════════════════════════════════════════╝
```

Diagnostics appear on Dart files:

```
users.dart:
  ⚠ Line 5: Table "users" missing required column "updated_at" (INTEGER)
  ⚠ Line 12: FK column "categoryId" should be "category_id" (snake_case pattern: {table}_id)

orders.dart:
  ⚠ Line 8: Column "OrderDate" violates snake_case naming convention
  ❌ Line 3: Table "Orders" violates snake_case naming convention
```

## New Files

```
extension/src/compliance/
  compliance-checker.ts       # Rule evaluation engine
  compliance-rules.ts         # Built-in rule definitions
  compliance-config.ts        # Config file parser
  compliance-types.ts         # Interfaces
extension/src/test/
  compliance-checker.test.ts
```

## Modified Files

```
extension/src/extension.ts                    # Register checker, watch config file
extension/src/diagnostics/schema-diagnostics.ts  # Add compliance violations to existing diagnostics
extension/package.json                        # Configuration, task type
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`
- `GenerationWatcher` — trigger re-check on schema change
- `vscode.workspace.fs` — read `.drift-rules.json`
- `vscode.DiagnosticCollection` — surface violations
- `DriftDefinitionProvider` — map table/column names to Dart file locations

## Architecture

### Config Schema

```typescript
interface IComplianceConfig {
  naming?: {
    tables?: NamingConvention;
    columns?: NamingConvention;
    fkColumns?: string;        // Pattern like "{table}_id"
    indexes?: string;          // Pattern like "idx_{table}_{column}"
  };
  requiredColumns?: Array<{
    name: string;
    type?: string;
    excludeTables?: string[];  // Tables exempt from this requirement
  }>;
  rules?: Array<{
    rule: string;
    severity?: 'error' | 'warning' | 'info';
    [key: string]: unknown;    // Rule-specific config
  }>;
  exclude?: string[];          // Tables to skip entirely
}

type NamingConvention = 'snake_case' | 'camelCase' | 'PascalCase' | 'UPPER_SNAKE';
```

### Config Loading

```typescript
const CONFIG_FILENAME = '.drift-rules.json';

async function loadConfig(workspaceRoot: vscode.Uri): Promise<IComplianceConfig | null> {
  const configUri = vscode.Uri.joinPath(workspaceRoot, CONFIG_FILENAME);
  try {
    const content = await vscode.workspace.fs.readFile(configUri);
    return JSON.parse(Buffer.from(content).toString('utf-8'));
  } catch {
    return null;  // No config file — compliance checking disabled
  }
}
```

### Compliance Checker

```typescript
interface IViolation {
  rule: string;
  severity: vscode.DiagnosticSeverity;
  table: string;
  column?: string;
  message: string;
}

class ComplianceChecker {
  private readonly _rules = new Map<string, IComplianceRule>();

  constructor() {
    this._registerBuiltinRules();
  }

  async check(
    config: IComplianceConfig,
    meta: TableMetadata[],
    fkMap: Map<string, ForeignKey[]>,
  ): Promise<IViolation[]> {
    const violations: IViolation[] = [];
    const tables = meta.filter(t =>
      !t.name.startsWith('sqlite_') &&
      !(config.exclude ?? []).includes(t.name)
    );

    // Naming checks
    if (config.naming) {
      violations.push(...this._checkNaming(config.naming, tables, fkMap));
    }

    // Required columns
    if (config.requiredColumns) {
      violations.push(...this._checkRequired(config.requiredColumns, tables));
    }

    // Custom rules
    for (const ruleConfig of config.rules ?? []) {
      const rule = this._rules.get(ruleConfig.rule);
      if (rule) {
        const severity = this._toSeverity(ruleConfig.severity ?? 'warning');
        violations.push(...rule.check(tables, fkMap, ruleConfig, severity));
      }
    }

    return violations;
  }

  private _checkNaming(
    naming: NonNullable<IComplianceConfig['naming']>,
    tables: TableMetadata[],
    fkMap: Map<string, ForeignKey[]>,
  ): IViolation[] {
    const violations: IViolation[] = [];

    for (const table of tables) {
      if (naming.tables && !matchesConvention(table.name, naming.tables)) {
        violations.push({
          rule: 'naming.tables',
          severity: vscode.DiagnosticSeverity.Warning,
          table: table.name,
          message: `Table "${table.name}" violates ${naming.tables} naming convention.`,
        });
      }

      for (const col of table.columns) {
        if (naming.columns && !matchesConvention(col.name, naming.columns)) {
          violations.push({
            rule: 'naming.columns',
            severity: vscode.DiagnosticSeverity.Warning,
            table: table.name,
            column: col.name,
            message: `Column "${col.name}" violates ${naming.columns} naming convention.`,
          });
        }
      }

      // FK column naming pattern
      if (naming.fkColumns) {
        const fks = fkMap.get(table.name) ?? [];
        for (const fk of fks) {
          const expected = naming.fkColumns.replace('{table}', fk.toTable);
          if (fk.fromColumn !== expected) {
            violations.push({
              rule: 'naming.fkColumns',
              severity: vscode.DiagnosticSeverity.Warning,
              table: table.name,
              column: fk.fromColumn,
              message: `FK column "${fk.fromColumn}" should be "${expected}" (pattern: ${naming.fkColumns}).`,
            });
          }
        }
      }
    }

    return violations;
  }

  private _checkRequired(
    required: NonNullable<IComplianceConfig['requiredColumns']>,
    tables: TableMetadata[],
  ): IViolation[] {
    const violations: IViolation[] = [];

    for (const req of required) {
      for (const table of tables) {
        if (req.excludeTables?.includes(table.name)) continue;

        const col = table.columns.find(c => c.name === req.name);
        if (!col) {
          violations.push({
            rule: 'requiredColumns',
            severity: vscode.DiagnosticSeverity.Warning,
            table: table.name,
            message: `Table "${table.name}" missing required column "${req.name}"${req.type ? ` (${req.type})` : ''}.`,
          });
        } else if (req.type && !col.type.toUpperCase().includes(req.type.toUpperCase())) {
          violations.push({
            rule: 'requiredColumns',
            severity: vscode.DiagnosticSeverity.Warning,
            table: table.name,
            column: col.name,
            message: `Column "${req.name}" should be ${req.type} but is ${col.type}.`,
          });
        }
      }
    }

    return violations;
  }

  private _registerBuiltinRules(): void {
    this._rules.set('no-text-primary-key', new NoTextPrimaryKeyRule());
    this._rules.set('require-fk-index', new RequireFkIndexRule());
    this._rules.set('max-columns', new MaxColumnsRule());
    this._rules.set('no-nullable-fk', new NoNullableFkRule());
    this._rules.set('no-wide-text', new NoWideTextRule());
    this._rules.set('require-pk', new RequirePkRule());
  }
}
```

### Naming Convention Matcher

```typescript
function matchesConvention(name: string, convention: NamingConvention): boolean {
  switch (convention) {
    case 'snake_case':
      return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name);
    case 'camelCase':
      return /^[a-z][a-zA-Z0-9]*$/.test(name);
    case 'PascalCase':
      return /^[A-Z][a-zA-Z0-9]*$/.test(name);
    case 'UPPER_SNAKE':
      return /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(name);
  }
}
```

### Built-in Rule Interface

```typescript
interface IComplianceRule {
  check(
    tables: TableMetadata[],
    fkMap: Map<string, ForeignKey[]>,
    config: Record<string, unknown>,
    severity: vscode.DiagnosticSeverity,
  ): IViolation[];
}

class MaxColumnsRule implements IComplianceRule {
  check(tables: TableMetadata[], _fk: Map<string, ForeignKey[]>, config: Record<string, unknown>, severity: vscode.DiagnosticSeverity): IViolation[] {
    const max = (config.max as number) ?? 20;
    return tables
      .filter(t => t.columns.length > max)
      .map(t => ({
        rule: 'max-columns',
        severity,
        table: t.name,
        message: `Table "${t.name}" has ${t.columns.length} columns (max: ${max}).`,
      }));
  }
}
```

## Server-Side Changes

None. Uses existing schema metadata and FK endpoints.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.runCompliance",
        "title": "Drift Viewer: Check Schema Compliance"
      }
    ],
    "configuration": {
      "properties": {
        "driftViewer.compliance.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Validate schema against .drift-rules.json on every generation change."
        }
      }
    },
    "taskDefinitions": [{
      "type": "drift",
      "properties": {
        "check": {
          "type": "string",
          "enum": ["healthCheck", "anomalyScan", "indexCoverage", "compliance"]
        }
      }
    }],
    "jsonValidation": [{
      "fileMatch": ".drift-rules.json",
      "url": "./schemas/drift-rules.schema.json"
    }]
  }
}
```

## Testing

- `compliance-checker.test.ts`:
  - snake_case: "user_name" passes, "userName" fails
  - camelCase: "userName" passes, "user_name" fails
  - Required column present → no violation
  - Required column missing → violation with table name
  - Required column wrong type → violation
  - Required column with excludeTables → excluded table skipped
  - FK column pattern: "{table}_id" matches "user_id" for FK to "user"
  - No config file → no violations (feature disabled)
  - Empty rules array → naming and required still checked
  - `no-text-primary-key`: TEXT PK → violation
  - `require-fk-index`: FK without index → violation
  - `max-columns`: 21 columns with max=20 → violation
  - Excluded tables skipped for all checks
  - Multiple violations per table reported individually
  - Config file change triggers re-check
  - `sqlite_` internal tables always excluded

## Known Limitations

- Column nullability is not available from schema metadata — `no-nullable-fk` requires PRAGMA queries
- Index detection requires parsing the schema dump (no dedicated endpoint)
- FK column patterns only support `{table}` placeholder — no `{column}` or custom transforms
- No auto-fix — violations are diagnostic-only (use Feature 24 for migration code generation)
- Config file must be in workspace root — no support for monorepo with multiple config files
- JSON Schema validation provides autocomplete in the config file but requires a bundled schema file
- Custom rule plugins are not supported — only built-in rules
