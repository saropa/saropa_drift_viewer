/**
 * Search engine for schema structure: table names, column names, and types.
 * Also builds cross-references for columns appearing in multiple tables.
 */

import type { DriftApiClient } from '../api-client';
import type { ForeignKey, TableMetadata } from '../api-types';
import type {
  ICrossReference, ISchemaMatch, ISchemaSearchResult,
  SchemaSearchScope,
} from './schema-search-types';

export class SchemaSearchEngine {
  constructor(private readonly _client: DriftApiClient) {}

  /** Fetch all table metadata (filtered to exclude sqlite_ internals). */
  async getAllMetadata(): Promise<TableMetadata[]> {
    const meta = await this._client.schemaMetadata();
    return meta.filter((t) => !t.name.startsWith('sqlite_'));
  }

  /** Search schema by table/column name or type. */
  async search(
    query: string,
    scope: SchemaSearchScope,
    typeFilter?: string,
  ): Promise<ISchemaSearchResult> {
    const meta = await this.getAllMetadata();
    const lower = query.toLowerCase();
    const matches: ISchemaMatch[] = [];

    for (const table of meta) {
      if (scope !== 'columns' && table.name.toLowerCase().includes(lower)) {
        matches.push({
          type: 'table',
          table: table.name,
          rowCount: table.rowCount,
          columnCount: table.columns.length,
        });
      }

      if (scope !== 'tables') {
        for (const col of table.columns) {
          if (typeFilter && !col.type.toUpperCase().includes(typeFilter)) {
            continue;
          }
          if (
            col.name.toLowerCase().includes(lower) ||
            col.type.toLowerCase().includes(lower)
          ) {
            matches.push({
              type: 'column',
              table: table.name,
              column: col.name,
              columnType: col.type,
              isPk: col.pk,
            });
          }
        }
      }
    }

    const crossRefs = await this._buildCrossReferences(meta, matches);
    this._annotateCrossRefs(matches, crossRefs);
    return { query, matches, crossReferences: crossRefs };
  }

  /** Populate `alsoIn` on each column match from cross-reference data. */
  private _annotateCrossRefs(
    matches: ISchemaMatch[],
    refs: ICrossReference[],
  ): void {
    const refMap = new Map(refs.map((r) => [r.columnName, r]));
    for (const m of matches) {
      if (m.type !== 'column' || !m.column) continue;
      const ref = refMap.get(m.column);
      if (ref) {
        m.alsoIn = ref.tables.filter((t) => t !== m.table);
      }
    }
  }

  /** Build cross-references for matched columns that appear in 2+ tables. */
  private async _buildCrossReferences(
    meta: TableMetadata[],
    matches: ISchemaMatch[],
  ): Promise<ICrossReference[]> {
    const columnNames = new Set(
      matches.filter((m) => m.type === 'column').map((m) => m.column!),
    );
    const refs: ICrossReference[] = [];
    const fkCache = new Map<string, ForeignKey[]>();

    for (const colName of columnNames) {
      const tables = meta
        .filter((t) => t.columns.some((c) => c.name === colName))
        .map((t) => t.name);

      if (tables.length <= 1) continue;

      const missingFks: Array<{ from: string; to: string }> = [];
      for (const fromTable of tables) {
        const fks = await this._cachedFkMeta(fromTable, fkCache);
        for (const toTable of tables) {
          if (fromTable === toTable) continue;
          const hasFk = fks.some(
            (fk) => fk.fromColumn === colName && fk.toTable === toTable,
          );
          if (!hasFk) {
            missingFks.push({ from: fromTable, to: toTable });
          }
        }
      }
      refs.push({ columnName: colName, tables, missingFks });
    }
    return refs;
  }

  private async _cachedFkMeta(
    table: string,
    cache: Map<string, ForeignKey[]>,
  ): Promise<ForeignKey[]> {
    const cached = cache.get(table);
    if (cached) return cached;
    const fks = await this._client.tableFkMeta(table);
    cache.set(table, fks);
    return fks;
  }
}
