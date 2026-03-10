import type { DriftApiClient } from '../api-client';
import type { AssertionType, IAssertion } from './test-gen-types';

/** Analyzes live data to infer meaningful test assertions. */
export class AssertionInferrer {
  constructor(private readonly _client: DriftApiClient) {}

  /** Infer assertions for the given tables and enabled types. */
  async infer(
    tables: string[],
    enabledTypes: Set<AssertionType>,
  ): Promise<IAssertion[]> {
    const assertions: IAssertion[] = [];
    const meta = await this._client.schemaMetadata();

    for (const tableName of tables) {
      const table = meta.find((t) => t.name === tableName);
      if (!table) continue;

      if (enabledTypes.has('rowCount')) {
        this._addRowCount(assertions, tableName, table.rowCount);
      }

      if (enabledTypes.has('fkIntegrity')) {
        await this._addFkIntegrity(assertions, tableName);
      }

      if (enabledTypes.has('notNull') && table.rowCount > 0) {
        await this._addNotNull(
          assertions, tableName, table.columns, table.rowCount,
        );
      }

      if (enabledTypes.has('unique') && table.rowCount > 0) {
        await this._addUnique(assertions, tableName, table.columns);
      }

      if (enabledTypes.has('valueRange')) {
        await this._addValueRange(assertions, tableName, table.columns);
      }
    }

    return assertions;
  }

  private _addRowCount(
    out: IAssertion[], table: string, rowCount: number,
  ): void {
    out.push({
      type: 'rowCount',
      table,
      sql: `SELECT COUNT(*) AS cnt FROM "${table}"`,
      expectation: `equals ${rowCount}`,
      reason: `Current row count is ${rowCount}`,
      confidence: 'high',
    });
  }

  private async _addFkIntegrity(
    out: IAssertion[], table: string,
  ): Promise<void> {
    const fks = await this._client.tableFkMeta(table);
    for (const fk of fks) {
      out.push({
        type: 'fkIntegrity',
        table,
        column: fk.fromColumn,
        sql:
          `SELECT a.rowid FROM "${table}" a` +
          ` LEFT JOIN "${fk.toTable}" b` +
          ` ON a."${fk.fromColumn}" = b."${fk.toColumn}"` +
          ` WHERE b."${fk.toColumn}" IS NULL` +
          ` AND a."${fk.fromColumn}" IS NOT NULL`,
        expectation: 'is empty',
        reason: `FK: ${table}.${fk.fromColumn} -> ${fk.toTable}.${fk.toColumn}`,
        confidence: 'high',
      });
    }
  }

  private async _addNotNull(
    out: IAssertion[],
    table: string,
    columns: { name: string; type: string; pk: boolean }[],
    rowCount: number,
  ): Promise<void> {
    for (const col of columns) {
      if (col.pk) continue;
      const result = await this._client.sql(
        `SELECT COUNT(*) AS cnt FROM "${table}" WHERE "${col.name}" IS NULL`,
      );
      const nullCount = result.rows[0]?.[0] as number;
      if (nullCount === 0) {
        out.push({
          type: 'notNull',
          table,
          column: col.name,
          sql:
            `SELECT COUNT(*) AS cnt FROM "${table}"` +
            ` WHERE "${col.name}" IS NULL`,
          expectation: 'equals 0',
          reason: `Currently 0% null (${rowCount} rows)`,
          confidence: 'high',
        });
      }
    }
  }

  private async _addUnique(
    out: IAssertion[],
    table: string,
    columns: { name: string; type: string; pk: boolean }[],
  ): Promise<void> {
    for (const col of columns) {
      if (col.pk) continue;
      const result = await this._client.sql(
        `SELECT COUNT(DISTINCT "${col.name}") AS dist,` +
        ` COUNT("${col.name}") AS total FROM "${table}"`,
      );
      const dist = result.rows[0]?.[0] as number;
      const total = result.rows[0]?.[1] as number;
      if (dist === total && total > 1) {
        out.push({
          type: 'unique',
          table,
          column: col.name,
          sql:
            `SELECT "${col.name}", COUNT(*) AS cnt FROM "${table}"` +
            ` GROUP BY "${col.name}" HAVING cnt > 1`,
          expectation: 'is empty',
          reason: `All ${total} values are unique`,
          confidence: total > 10 ? 'high' : 'medium',
        });
      }
    }
  }

  private async _addValueRange(
    out: IAssertion[],
    table: string,
    columns: { name: string; type: string; pk: boolean }[],
  ): Promise<void> {
    for (const col of columns) {
      if (!/INT|REAL|FLOAT|DOUBLE/i.test(col.type)) continue;
      const result = await this._client.sql(
        `SELECT MIN("${col.name}") AS mn, MAX("${col.name}") AS mx` +
        ` FROM "${table}" WHERE "${col.name}" IS NOT NULL`,
      );
      const mn = result.rows[0]?.[0] as number | null;
      const mx = result.rows[0]?.[1] as number | null;
      if (mn != null && mx != null) {
        out.push({
          type: 'valueRange',
          table,
          column: col.name,
          sql:
            `SELECT * FROM "${table}"` +
            ` WHERE "${col.name}" < ${mn} OR "${col.name}" > ${mx}`,
          expectation: 'is empty',
          reason: `Current range: [${mn}, ${mx}]`,
          confidence: 'medium',
        });
      }
    }
  }
}
