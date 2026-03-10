import type { DriftApiClient } from '../api-client';
import type { DataReset } from './data-reset';
import type { DependencySorter } from './dependency-sorter';
import type {
  IDatasetImportResult,
  IDriftDataset,
  IValidationResult,
} from './dataset-types';

/** Validates, imports, and generates SQL from dataset files. */
export class DatasetImport {
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
      const tableMeta = meta.find((t) => t.name === table);
      if (!tableMeta) {
        errors.push(`Table "${table}" does not exist in the database.`);
        continue;
      }

      const schemaColumns = new Set(
        tableMeta.columns.map((c) => c.name),
      );
      const extraColumns = new Set<string>();
      for (const row of rows) {
        for (const col of Object.keys(row)) {
          if (!schemaColumns.has(col)) {
            extraColumns.add(col);
          }
        }
      }
      for (const col of extraColumns) {
        warnings.push(
          `Column "${table}.${col}" not in schema (will be ignored).`,
        );
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async import(
    dataset: IDriftDataset,
    mode: 'append' | 'replace',
  ): Promise<IDatasetImportResult> {
    const tables = Object.keys(dataset.tables);
    const allFks = await this._reset.getAllFks(tables);
    const insertOrder = this._sorter.sortForInsert(tables, allFks);

    if (mode === 'replace') {
      await this._reset.clearGroup(tables);
    }

    let totalInserted = 0;
    const results: { table: string; inserted: number }[] = [];

    for (const table of insertOrder) {
      const rows = dataset.tables[table];
      if (!rows || rows.length === 0) continue;

      await this._client.importData(
        'json',
        table,
        JSON.stringify(rows),
      );
      results.push({ table, inserted: rows.length });
      totalInserted += rows.length;
    }

    return { tables: results, totalInserted };
  }

  /** Generate INSERT SQL without executing. */
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
        const vals = cols.map((c) => sqlLiteral(row[c]));
        lines.push(
          `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`,
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }

}

/** Convert a JS value to a SQL literal. */
function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  const s = String(value).replace(/'/g, "''");
  return `'${s}'`;
}
