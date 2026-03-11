# Feature 20a: Data Management (prerequisite)

## What It Does

Foundational data management operations that multiple features depend on:

1. **Reset** — Clear data from all tables, specific tables, or configured table groups. Deletes in reverse FK order to avoid constraint violations.
2. **Import Dataset** — Load a prepared `.drift-dataset.json` file into the database. Supports append and replace modes.
3. **Export Dataset** — Snapshot current data as a reusable `.drift-dataset.json` file.
4. **Table Groups** — Named groups of tables defined in a `.drift-datasets.json` workspace config file.

This is a prerequisite for Feature 20 (Test Data Seeder), Feature 28 (PII Anonymizer), Feature 37 (Data Branching), and any future feature that writes or clears data.

## User Experience

### Reset

1. Right-click a table → "Clear Table" or command palette → "Saropa Drift Advisor: Reset Data"
2. Quick pick with scope options:

```
Reset Data
──────────
  ● Clear ALL tables
  ● Clear single table → [pick table]
  ● Clear table group → [pick group]
```

3. Confirmation dialog with row counts:

```
⚠ Clear "commerce" group?

  This will delete:
    payments:     890 rows
    order_items:  12,800 rows
    orders:       3,400 rows
  ────────────────────
  Total:          17,090 rows

  Deletion order respects FK constraints (children first).

  [Cancel]  [Clear]
```

### Import Dataset

1. Command palette → "Saropa Drift Advisor: Import Dataset"
2. Offer workspace datasets (from `.drift-datasets.json`) then file picker as fallback
3. Import options:

```
Import Dataset: test-commerce.drift-dataset.json
─────────────────────────────────────────────────
  Tables in dataset:
    users:    50 rows
    orders:   200 rows
    products: 25 rows

  Import mode:
    (●) Append to existing data
    ( ) Clear target tables first, then insert
    ( ) Generate SQL only (don't execute)

  [Preview]  [Import]
```

### Export Dataset

1. Command palette → "Saropa Drift Advisor: Export Current Data as Dataset"
2. Pick tables → enter dataset name → save as `.drift-dataset.json`

### Dataset File Format

`.drift-dataset.json`:

```json
{
  "$schema": "drift-dataset/v1",
  "name": "commerce-test-data",
  "description": "Realistic e-commerce test data",
  "tables": {
    "users": [
      { "id": 1, "name": "Alice Smith", "email": "alice@example.com", "age": 32 },
      { "id": 2, "name": "Bob Jones", "email": "bob@example.com", "age": 28 }
    ],
    "orders": [
      { "id": 1, "user_id": 1, "total": 49.99, "status": "shipped" },
      { "id": 2, "user_id": 2, "total": 129.00, "status": "pending" }
    ]
  }
}
```

### Workspace Configuration

`.drift-datasets.json` at workspace root:

```json
{
  "groups": {
    "core": ["users", "roles", "permissions"],
    "commerce": ["orders", "order_items", "payments", "products"],
    "audit": ["audit_log", "sessions", "event_log"]
  },
  "datasets": {
    "smoke-test": "./test/fixtures/smoke-test.drift-dataset.json",
    "full-commerce": "./test/fixtures/full-commerce.drift-dataset.json"
  }
}
```

## New Files

```
extension/src/
  data-management/
    dependency-sorter.ts      # Topological sort by FK dependencies (insert + delete order)
    data-reset.ts             # Clear tables/groups in safe FK order
    dataset-import.ts         # Reads, validates, and imports .drift-dataset.json files
    dataset-export.ts         # Exports current data as .drift-dataset.json
    dataset-config.ts         # Reads .drift-datasets.json for groups + dataset paths
    dataset-types.ts          # IDriftDataset, IDriftDatasetsConfig, shared interfaces
extension/src/test/
  dependency-sorter.test.ts
  data-reset.test.ts
  dataset-import.test.ts
  dataset-export.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`, `sql()`, `importData()`
- Server: `writeQuery` callback required for Reset and direct-execute Import

## Architecture

### Dependency Sorter

Topological sort used by both seeding (insert order) and reset (delete order):

```typescript
class DependencySorter {
  /** Returns tables in insertion order (parents first). */
  sortForInsert(tables: string[], fks: IFkContext[]): string[] {
    const deps = new Map<string, Set<string>>();
    for (const table of tables) deps.set(table, new Set());
    for (const fk of fks) {
      if (deps.has(fk.fromTable) && deps.has(fk.toTable)) {
        deps.get(fk.fromTable)!.add(fk.toTable);
      }
    }

    // Kahn's algorithm
    const inDegree = new Map<string, number>();
    for (const t of tables) inDegree.set(t, 0);
    for (const [child, parents] of deps) {
      inDegree.set(child, parents.size);
    }

    const queue = tables.filter(t => inDegree.get(t) === 0);
    const sorted: string[] = [];

    while (queue.length > 0) {
      const t = queue.shift()!;
      sorted.push(t);
      for (const [child, parents] of deps) {
        if (parents.has(t)) {
          parents.delete(t);
          inDegree.set(child, (inDegree.get(child) ?? 1) - 1);
          if (inDegree.get(child) === 0) queue.push(child);
        }
      }
    }

    // Circular dependency detection
    if (sorted.length < tables.length) {
      const remaining = tables.filter(t => !sorted.includes(t));
      // Append remaining with warning — caller should handle
      sorted.push(...remaining);
    }

    return sorted;
  }

  /** Returns tables in deletion order (children first). */
  sortForDelete(tables: string[], fks: IFkContext[]): string[] {
    return this.sortForInsert(tables, fks).reverse();
  }
}
```

### Data Reset

```typescript
interface IResetResult {
  tables: { name: string; deletedRows: number }[];
  totalDeleted: number;
}

class DataReset {
  constructor(
    private readonly _client: DriftApiClient,
    private readonly _sorter: DependencySorter,
  ) {}

  async clearAll(): Promise<IResetResult> {
    const meta = await this._client.schemaMetadata();
    const tables = meta.tables
      .filter(t => !t.name.startsWith('sqlite_'))
      .map(t => t.name);
    return this._clearTables(tables);
  }

  async clearTable(table: string): Promise<IResetResult> {
    const dependents = await this._findDependents(table);
    if (dependents.length > 0) {
      return this._clearTables([...dependents, table]);
    }
    return this._clearTables([table]);
  }

  async clearGroup(tables: string[]): Promise<IResetResult> {
    return this._clearTables(tables);
  }

  /** Preview what would be deleted without executing. */
  async previewClear(tables: string[]): Promise<{ name: string; rowCount: number }[]> {
    const allFks = await this._getAllFks(tables);
    const deleteOrder = this._sorter.sortForDelete(tables, allFks);
    const preview: { name: string; rowCount: number }[] = [];

    for (const table of deleteOrder) {
      const result = await this._client.sql(
        `SELECT COUNT(*) AS cnt FROM "${table}"`
      );
      preview.push({ name: table, rowCount: (result.rows[0] as { cnt: number }).cnt });
    }

    return preview;
  }

  private async _clearTables(tables: string[]): Promise<IResetResult> {
    const allFks = await this._getAllFks(tables);
    const deleteOrder = this._sorter.sortForDelete(tables, allFks);

    const results: { name: string; deletedRows: number }[] = [];
    let total = 0;

    for (const table of deleteOrder) {
      const countResult = await this._client.sql(
        `SELECT COUNT(*) AS cnt FROM "${table}"`
      );
      const count = (countResult.rows[0] as { cnt: number }).cnt;

      await this._client.sql(`DELETE FROM "${table}"`);
      results.push({ name: table, deletedRows: count });
      total += count;
    }

    return { tables: results, totalDeleted: total };
  }

  private async _findDependents(table: string): Promise<string[]> {
    const meta = await this._client.schemaMetadata();
    const dependents: string[] = [];

    for (const t of meta.tables) {
      if (t.name === table || t.name.startsWith('sqlite_')) continue;
      const fks = await this._client.tableFkMeta(t.name);
      if (fks.some((fk: { table: string }) => fk.table === table)) {
        dependents.push(t.name);
      }
    }

    return dependents;
  }

  private async _getAllFks(tables: string[]): Promise<IFkContext[]> {
    const fks: IFkContext[] = [];
    for (const t of tables) {
      const tableFks = await this._client.tableFkMeta(t);
      fks.push(...tableFks);
    }
    return fks;
  }
}
```

### Dataset Types

```typescript
interface IDriftDataset {
  $schema: 'drift-dataset/v1';
  name: string;
  description?: string;
  tables: Record<string, Record<string, unknown>[]>;
}

interface IDriftDatasetsConfig {
  groups: Record<string, string[]>;
  datasets: Record<string, string>;  // name → relative file path
}

interface IValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface IImportResult {
  tables: { table: string; inserted: number }[];
  totalInserted: number;
}
```

### Dataset Import

```typescript
class DatasetImport {
  constructor(
    private readonly _client: DriftApiClient,
    private readonly _sorter: DependencySorter,
    private readonly _reset: DataReset,
  ) {}

  async validate(dataset: IDriftDataset): Promise<IValidationResult> {
    const meta = await this._client.schemaMetadata();
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const [table, rows] of Object.entries(dataset.tables)) {
      const tableMeta = meta.tables.find(t => t.name === table);
      if (!tableMeta) {
        errors.push(`Table "${table}" does not exist in the database.`);
        continue;
      }

      const schemaColumns = new Set(tableMeta.columns.map(c => c.name));
      const extraColumns = new Set<string>();
      for (const row of rows) {
        for (const col of Object.keys(row)) {
          if (!schemaColumns.has(col)) extraColumns.add(col);
        }
      }
      for (const col of extraColumns) {
        warnings.push(`Column "${table}.${col}" not in schema (will be ignored).`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async import(
    dataset: IDriftDataset,
    mode: 'append' | 'replace',
  ): Promise<IImportResult> {
    const tables = Object.keys(dataset.tables);
    const allFks = await this._getAllFks(tables);
    const insertOrder = this._sorter.sortForInsert(tables, allFks);

    if (mode === 'replace') {
      await this._reset.clearGroup(tables);
    }

    let totalInserted = 0;
    const results: { table: string; inserted: number }[] = [];

    for (const table of insertOrder) {
      const rows = dataset.tables[table];
      if (!rows || rows.length === 0) continue;

      await this._client.importData('json', table, JSON.stringify(rows));
      results.push({ table, inserted: rows.length });
      totalInserted += rows.length;
    }

    return { tables: results, totalInserted };
  }

  toSql(dataset: IDriftDataset): string {
    const lines: string[] = [
      `-- Dataset: ${dataset.name}`,
      `-- Tables: ${Object.keys(dataset.tables).join(', ')}`,
      '',
    ];

    for (const [table, rows] of Object.entries(dataset.tables)) {
      lines.push(`-- ${table}: ${rows.length} rows`);
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = cols.map(c => sqlLiteral(row[c]));
        lines.push(
          `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private async _getAllFks(tables: string[]): Promise<IFkContext[]> {
    const fks: IFkContext[] = [];
    for (const t of tables) {
      const tableFks = await this._client.tableFkMeta(t);
      fks.push(...tableFks);
    }
    return fks;
  }
}
```

### Dataset Export

```typescript
class DatasetExport {
  constructor(private readonly _client: DriftApiClient) {}

  async export(tables: string[], name: string): Promise<IDriftDataset> {
    const data: Record<string, Record<string, unknown>[]> = {};

    for (const table of tables) {
      const result = await this._client.sql(`SELECT * FROM "${table}"`);
      data[table] = result.rows as Record<string, unknown>[];
    }

    return {
      $schema: 'drift-dataset/v1',
      name,
      tables: data,
    };
  }
}
```

### Dataset Config

```typescript
class DatasetConfig {
  private _config: IDriftDatasetsConfig | null = null;

  async load(workspaceRoot: string): Promise<IDriftDatasetsConfig | null> {
    const configPath = path.join(workspaceRoot, '.drift-datasets.json');
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(configPath));
      this._config = JSON.parse(Buffer.from(raw).toString());
      return this._config;
    } catch {
      return null;
    }
  }

  getGroups(): Record<string, string[]> {
    return this._config?.groups ?? {};
  }

  getDatasetPaths(): Record<string, string> {
    return this._config?.datasets ?? {};
  }
}
```

## Server-Side Changes

None. Uses existing `schemaMetadata()`, `tableFkMeta()`, `sql()`, and `importData()`.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.clearTable",
        "title": "Saropa Drift Advisor: Clear Table Data",
        "icon": "$(trash)"
      },
      {
        "command": "driftViewer.clearAllTables",
        "title": "Saropa Drift Advisor: Clear All Table Data"
      },
      {
        "command": "driftViewer.clearTableGroup",
        "title": "Saropa Drift Advisor: Clear Table Group"
      },
      {
        "command": "driftViewer.importDataset",
        "title": "Saropa Drift Advisor: Import Dataset",
        "icon": "$(cloud-download)"
      },
      {
        "command": "driftViewer.exportDataset",
        "title": "Saropa Drift Advisor: Export Current Data as Dataset",
        "icon": "$(cloud-upload)"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "driftViewer.clearTable",
          "when": "viewItem == driftTable",
          "group": "6_data"
        }
      ],
      "view/title": [
        {
          "command": "driftViewer.importDataset",
          "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
          "group": "navigation"
        }
      ]
    }
  }
}
```

## Wiring in extension.ts

```typescript
const depSorter = new DependencySorter();
const dataReset = new DataReset(client, depSorter);
const datasetConfig = new DatasetConfig();
const datasetImport = new DatasetImport(client, depSorter, dataReset);
const datasetExport = new DatasetExport(client);

context.subscriptions.push(
  // Reset commands
  vscode.commands.registerCommand('driftViewer.clearTable', async (item?: TableItem) => {
    const table = item?.tableMetadata.name ?? await pickTable(client);
    if (!table) return;

    const preview = await dataReset.previewClear([table]);
    const total = preview.reduce((s, p) => s + p.rowCount, 0);
    const details = preview.map(p => `${p.name}: ${p.rowCount} rows`).join(', ');

    const confirm = await vscode.window.showWarningMessage(
      `Clear ${total} rows? (${details})`, 'Clear', 'Cancel'
    );
    if (confirm !== 'Clear') return;

    const result = await dataReset.clearTable(table);
    vscode.window.showInformationMessage(
      `Cleared ${result.totalDeleted} rows from ${result.tables.length} table(s).`
    );
  }),

  vscode.commands.registerCommand('driftViewer.clearAllTables', async () => {
    const meta = await client.schemaMetadata();
    const total = meta.tables
      .filter(t => !t.name.startsWith('sqlite_'))
      .reduce((s, t) => s + t.rowCount, 0);

    const confirm = await vscode.window.showWarningMessage(
      `Clear ALL data? (${total.toLocaleString()} rows)`, 'Clear All', 'Cancel'
    );
    if (confirm !== 'Clear All') return;

    const result = await dataReset.clearAll();
    vscode.window.showInformationMessage(`Cleared ${result.totalDeleted.toLocaleString()} rows.`);
  }),

  vscode.commands.registerCommand('driftViewer.clearTableGroup', async () => {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) return;
    const config = await datasetConfig.load(ws);
    if (!config || Object.keys(config.groups).length === 0) {
      vscode.window.showWarningMessage(
        'No table groups defined. Create a .drift-datasets.json in your workspace root.'
      );
      return;
    }

    const group = await vscode.window.showQuickPick(
      Object.entries(config.groups).map(([name, tables]) => ({
        label: name, description: tables.join(', '), tables,
      })),
      { placeHolder: 'Select a group to clear' }
    );
    if (!group) return;

    const preview = await dataReset.previewClear(group.tables);
    const total = preview.reduce((s, p) => s + p.rowCount, 0);

    const confirm = await vscode.window.showWarningMessage(
      `Clear group "${group.label}"? (${total.toLocaleString()} rows)`, 'Clear', 'Cancel'
    );
    if (confirm !== 'Clear') return;

    const result = await dataReset.clearGroup(group.tables);
    vscode.window.showInformationMessage(
      `Cleared ${result.totalDeleted.toLocaleString()} rows from "${group.label}".`
    );
  }),

  // Import
  vscode.commands.registerCommand('driftViewer.importDataset', async () => {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const config = ws ? await datasetConfig.load(ws) : null;
    const datasetPaths = config?.datasets ?? {};

    const options = [
      ...Object.entries(datasetPaths).map(([name, p]) => ({
        label: name, description: p, filePath: path.resolve(ws ?? '', p),
      })),
      { label: 'Browse for file…', description: '', filePath: '' },
    ];

    const pick = await vscode.window.showQuickPick(options);
    if (!pick) return;

    let filePath = pick.filePath;
    if (!filePath) {
      const uris = await vscode.window.showOpenDialog({
        filters: { 'Drift Dataset': ['json'] },
      });
      if (!uris?.[0]) return;
      filePath = uris[0].fsPath;
    }

    const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    const dataset = JSON.parse(Buffer.from(raw).toString()) as IDriftDataset;

    const validation = await datasetImport.validate(dataset);
    if (!validation.valid) {
      vscode.window.showErrorMessage(`Invalid: ${validation.errors.join('; ')}`);
      return;
    }
    if (validation.warnings.length > 0) {
      vscode.window.showWarningMessage(`Warnings: ${validation.warnings.join('; ')}`);
    }

    const mode = await vscode.window.showQuickPick([
      { label: 'Append', description: 'Add rows to existing data', value: 'append' as const },
      { label: 'Replace', description: 'Clear target tables first', value: 'replace' as const },
      { label: 'SQL only', description: 'Generate SQL without executing', value: 'sql' as const },
    ]);
    if (!mode) return;

    if (mode.value === 'sql') {
      const sql = datasetImport.toSql(dataset);
      const doc = await vscode.workspace.openTextDocument({ content: sql, language: 'sql' });
      await vscode.window.showTextDocument(doc);
      return;
    }

    const result = await datasetImport.import(dataset, mode.value);
    vscode.window.showInformationMessage(
      `Imported ${result.totalInserted} rows across ${result.tables.length} tables.`
    );
  }),

  // Export
  vscode.commands.registerCommand('driftViewer.exportDataset', async () => {
    const meta = await client.schemaMetadata();
    const tables = meta.tables.filter(t => !t.name.startsWith('sqlite_'));

    const selected = await vscode.window.showQuickPick(
      tables.map(t => ({ label: t.name, description: `${t.rowCount} rows`, picked: true })),
      { canPickMany: true, placeHolder: 'Select tables' }
    );
    if (!selected?.length) return;

    const name = await vscode.window.showInputBox({ prompt: 'Dataset name' });
    if (!name) return;

    const dataset = await datasetExport.export(selected.map(s => s.label), name);
    const json = JSON.stringify(dataset, null, 2);

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${name}.drift-dataset.json`),
      filters: { 'Drift Dataset': ['json'] },
    });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
      vscode.window.showInformationMessage(`Dataset exported: ${uri.fsPath}`);
    }
  })
);
```

## Testing

- `dependency-sorter.test.ts`:
  - Linear chain (A→B→C) → insert order [C, B, A], delete order [A, B, C]
  - Diamond dependency → correct topological order
  - Independent tables → any order (stable)
  - Circular dependency → detected, remaining appended with no crash
  - Empty input → empty output
- `data-reset.test.ts`:
  - `clearAll` deletes in reverse FK order
  - `clearTable` with FK dependents clears dependents first
  - `clearTable` without dependents clears only that table
  - `clearGroup` deletes specified tables in correct order
  - `previewClear` returns row counts without deleting
  - Returns accurate deleted row counts
- `dataset-import.test.ts`:
  - Valid dataset passes validation
  - Missing table → validation error
  - Extra columns → validation warning (not error)
  - Append mode inserts without clearing
  - Replace mode clears then inserts
  - Insert order respects FK dependencies
  - `toSql` produces valid INSERT statements
  - Empty dataset → no-op
- `dataset-export.test.ts`:
  - Exports all rows from selected tables
  - Output has correct `$schema` and `name` fields
  - Empty table → empty array in output

## Known Limitations

- Reset requires `writeQuery` — read-only servers can only preview or generate SQL
- `.drift-datasets.json` is optional — without it, table groups and named datasets are unavailable
- Large datasets (10k+ rows) may be slow to import row-by-row via `importData()`
- No streaming import — entire dataset file must fit in memory
- Dataset validation checks schema match but not FK integrity of the data values
- No diff between dataset file and current state ("what would change if I import this?")
- Circular FK dependencies prevent clean deletion — user must break the cycle manually
- `DELETE FROM` doesn't reset auto-increment counters — new inserts may have unexpected IDs
- No undo for reset operations — data is permanently deleted (use branching/snapshots to protect)
