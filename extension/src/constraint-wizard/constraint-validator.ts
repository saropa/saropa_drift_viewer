import type { DriftApiClient } from '../api-client';
import { zipRow } from '../shared-utils';
import type {
  IConstraintDraft,
  IConstraintTestResult,
} from './constraint-types';

/** Convert `{ columns, rows }` from the SQL API into objects. */
function rowsToObjects(
  columns: string[],
  rows: unknown[][],
): Record<string, unknown>[] {
  return rows.map((row) => zipRow(columns, row));
}

/** Tests proposed constraints against live data via SQL. */
export class ConstraintValidator {
  constructor(private readonly _client: DriftApiClient) {}

  async test(
    constraint: IConstraintDraft,
  ): Promise<IConstraintTestResult> {
    switch (constraint.kind) {
      case 'unique': return this._testUnique(constraint);
      case 'check': return this._testCheck(constraint);
      case 'not_null': return this._testNotNull(constraint);
    }
  }

  private async _testUnique(
    c: IConstraintDraft,
  ): Promise<IConstraintTestResult> {
    if (!c.columns || c.columns.length === 0) {
      return this._emptyResult(c.id, 'Select at least one column');
    }
    const cols = c.columns.map((col) => `"${col}"`).join(', ');
    const sql =
      `SELECT ${cols}, COUNT(*) AS _cnt`
      + ` FROM "${c.table}"`
      + ` GROUP BY ${cols}`
      + ` HAVING _cnt > 1`
      + ` LIMIT 20`;

    const result = await this._client.sql(sql);
    const objects = rowsToObjects(result.columns, result.rows);

    const countSql =
      `SELECT COUNT(*) AS cnt FROM (`
      + `SELECT ${cols} FROM "${c.table}"`
      + ` GROUP BY ${cols} HAVING COUNT(*) > 1)`;
    const countResult = await this._client.sql(countSql);
    const total = Number(countResult.rows[0]?.[0] ?? 0);

    return {
      constraintId: c.id,
      valid: total === 0,
      violationCount: total,
      violations: objects.map((r) => ({
        rowPk: r[c.columns![0]],
        values: r,
      })),
    };
  }

  private async _testCheck(
    c: IConstraintDraft,
  ): Promise<IConstraintTestResult> {
    if (!c.expression?.trim()) {
      return this._emptyResult(c.id, 'Enter a CHECK expression');
    }
    const pkCol = await this._findPkColumn(c.table);
    const sql =
      `SELECT "${pkCol}" AS _pk, *`
      + ` FROM "${c.table}"`
      + ` WHERE NOT (${c.expression})`
      + ` LIMIT 20`;

    const result = await this._client.sql(sql);
    const objects = rowsToObjects(result.columns, result.rows);

    const countSql =
      `SELECT COUNT(*) AS cnt`
      + ` FROM "${c.table}"`
      + ` WHERE NOT (${c.expression})`;
    const countResult = await this._client.sql(countSql);
    const total = Number(countResult.rows[0]?.[0] ?? 0);

    return {
      constraintId: c.id,
      valid: total === 0,
      violationCount: total,
      violations: objects.map((r) => ({
        rowPk: r['_pk'],
        values: r,
      })),
    };
  }

  private async _testNotNull(
    c: IConstraintDraft,
  ): Promise<IConstraintTestResult> {
    if (!c.column) {
      return this._emptyResult(c.id, 'Select a column');
    }
    const pkCol = await this._findPkColumn(c.table);
    const sql =
      `SELECT "${pkCol}" AS _pk, "${c.column}"`
      + ` FROM "${c.table}"`
      + ` WHERE "${c.column}" IS NULL`
      + ` LIMIT 20`;

    const result = await this._client.sql(sql);
    const objects = rowsToObjects(result.columns, result.rows);

    const countSql =
      `SELECT COUNT(*) AS cnt`
      + ` FROM "${c.table}"`
      + ` WHERE "${c.column}" IS NULL`;
    const countResult = await this._client.sql(countSql);
    const total = Number(countResult.rows[0]?.[0] ?? 0);

    return {
      constraintId: c.id,
      valid: total === 0,
      violationCount: total,
      violations: objects.map((r) => ({
        rowPk: r['_pk'],
        values: r,
      })),
    };
  }

  private _emptyResult(
    id: string, reason: string,
  ): IConstraintTestResult {
    return {
      constraintId: id,
      valid: false,
      violationCount: 0,
      violations: [{ rowPk: '—', values: { error: reason } }],
    };
  }

  private async _findPkColumn(table: string): Promise<string> {
    const meta = await this._client.schemaMetadata();
    const t = meta.find((m) => m.name === table);
    const pk = t?.columns.find((col) => col.pk);
    return pk?.name ?? 'rowid';
  }
}
