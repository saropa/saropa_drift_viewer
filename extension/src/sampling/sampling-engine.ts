/**
 * Builds sampling SQL queries and assembles results for
 * random, stratified, percentile, and cohort sampling modes.
 */

import type { DriftApiClient } from '../api-client';
import type { ColumnMetadata } from '../api-types';
import { isNumericType } from '../profiler/profiler-queries';
import { q, zipRow } from '../shared-utils';
import type {
  ICohortStats, ISamplingConfig, ISamplingResult,
} from './sampling-types';

/** Convert a JS value to a SQL literal for WHERE clauses. */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  const s = String(value).replace(/'/g, "''");
  return `'${s}'`;
}

export class SamplingEngine {
  constructor(private readonly _client: DriftApiClient) {}

  async sample(config: ISamplingConfig): Promise<ISamplingResult> {
    const start = Date.now();
    let result: ISamplingResult;

    switch (config.mode) {
      case 'random':
        result = await this._randomSample(config);
        break;
      case 'stratified':
        result = await this._stratifiedSample(config);
        break;
      case 'percentile':
        result = await this._percentileSlice(config);
        break;
      case 'cohort':
        result = await this._cohortComparison(config);
        break;
    }

    result.durationMs = Date.now() - start;
    return result;
  }

  private async _randomSample(
    config: ISamplingConfig,
  ): Promise<ISamplingResult> {
    const tbl = q(config.table);

    const countResult = await this._client.sql(
      `SELECT COUNT(*) AS cnt FROM ${tbl}`,
    );
    const total = (countResult.rows[0] as unknown[])[0] as number;

    const sql =
      `SELECT * FROM ${tbl} ORDER BY RANDOM() LIMIT ${config.sampleSize}`;
    const result = await this._client.sql(sql);
    const rows = result.rows.map((r) => zipRow(result.columns, r));

    return {
      mode: 'random',
      totalRows: total,
      sampledRows: rows.length,
      columns: result.columns,
      rows,
      sql,
      durationMs: 0,
    };
  }

  private async _stratifiedSample(
    config: ISamplingConfig,
  ): Promise<ISamplingResult> {
    const tbl = q(config.table);
    const col = q(config.stratifyColumn!);

    const groupSql =
      `SELECT ${col}, COUNT(*) AS cnt FROM ${tbl} GROUP BY ${col}`
      + ` ORDER BY cnt DESC`;
    const groups = await this._client.sql(groupSql);

    const total = (groups.rows as unknown[][]).reduce(
      (s, r) => s + (r[1] as number), 0,
    );

    const allRows: Record<string, unknown>[] = [];
    const sqlParts: string[] = [groupSql];

    for (const row of groups.rows as unknown[][]) {
      const groupValue = row[0];
      const groupCount = row[1] as number;
      const allocation = Math.max(
        1, Math.round((groupCount / total) * config.sampleSize),
      );

      const whereClause = groupValue === null || groupValue === undefined
        ? `${col} IS NULL`
        : `${col} = ${sqlLiteral(groupValue)}`;
      const sampleSql =
        `SELECT * FROM ${tbl} WHERE ${whereClause}`
        + ` ORDER BY RANDOM() LIMIT ${allocation}`;
      sqlParts.push(sampleSql);

      const result = await this._client.sql(sampleSql);
      const rows = result.rows.map((r) => zipRow(result.columns, r));
      allRows.push(...rows);
    }

    return {
      mode: 'stratified',
      totalRows: total,
      sampledRows: allRows.length,
      columns: allRows.length > 0 ? Object.keys(allRows[0]) : [],
      rows: allRows,
      sql: sqlParts.join(';\n'),
      durationMs: 0,
    };
  }

  private async _percentileSlice(
    config: ISamplingConfig,
  ): Promise<ISamplingResult> {
    const tbl = q(config.table);
    const col = q(config.percentileColumn!);
    const pMin = config.percentileMin ?? 0;
    const pMax = config.percentileMax ?? 100;

    const countResult = await this._client.sql(
      `SELECT COUNT(*) AS cnt FROM ${tbl} WHERE ${col} IS NOT NULL`,
    );
    const total = (countResult.rows[0] as unknown[])[0] as number;

    const offset = Math.floor((pMin / 100) * total);
    const sliceSize = Math.floor(((pMax - pMin) / 100) * total);
    const limit = Math.min(sliceSize, config.sampleSize);

    const sql =
      `SELECT * FROM ${tbl} WHERE ${col} IS NOT NULL`
      + ` ORDER BY ${col} LIMIT ${limit} OFFSET ${offset}`;
    const result = await this._client.sql(sql);
    const rows = result.rows.map((r) => zipRow(result.columns, r));

    return {
      mode: 'percentile',
      totalRows: total,
      sampledRows: rows.length,
      columns: result.columns,
      rows,
      sql,
      durationMs: 0,
    };
  }

  private async _cohortComparison(
    config: ISamplingConfig,
  ): Promise<ISamplingResult> {
    const tbl = q(config.table);
    const col = q(config.cohortColumn!);

    const meta = await this._client.schemaMetadata();
    const table = meta.find((t) => t.name === config.table);
    const numCol = findFirstNumericColumn(table?.columns ?? []);

    const numericAgg = numCol
      ? `, AVG(${q(numCol.name)}) AS avg_val`
        + `, MIN(${q(numCol.name)}) AS min_val`
        + `, MAX(${q(numCol.name)}) AS max_val`
      : '';

    const sql =
      `SELECT ${col} AS cohort_value, COUNT(*) AS count${numericAgg}`
      + ` FROM ${tbl} GROUP BY ${col} ORDER BY count DESC`;
    const result = await this._client.sql(sql);

    const totalRows = (result.rows as unknown[][]).reduce(
      (s, r) => s + (r[1] as number), 0,
    );

    const stats: ICohortStats[] = (result.rows as unknown[][]).map((r) => ({
      cohortValue: String(r[0] ?? 'NULL'),
      count: r[1] as number,
      percentage: totalRows > 0
        ? ((r[1] as number) / totalRows) * 100
        : 0,
      numericStats: numCol ? {
        column: numCol.name,
        avg: r[2] as number,
        min: r[3] as number,
        max: r[4] as number,
      } : undefined,
      nullRate: 0,
    }));

    const cohortRows = stats.map((s) => {
      const row: Record<string, unknown> = {
        cohort_value: s.cohortValue,
        count: s.count,
        percentage: `${s.percentage.toFixed(1)}%`,
      };
      if (s.numericStats) {
        row[`avg_${s.numericStats.column}`] = s.numericStats.avg;
        row[`min_${s.numericStats.column}`] = s.numericStats.min;
        row[`max_${s.numericStats.column}`] = s.numericStats.max;
      }
      return row;
    });

    return {
      mode: 'cohort',
      totalRows,
      sampledRows: stats.length,
      columns: cohortRows.length > 0 ? Object.keys(cohortRows[0]) : [],
      rows: cohortRows,
      sql,
      durationMs: 0,
      stats,
    };
  }
}

/** Find the first numeric column in a column list. */
function findFirstNumericColumn(
  columns: ColumnMetadata[],
): ColumnMetadata | undefined {
  return columns.find((c) => isNumericType(c.type));
}
