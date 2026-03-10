/**
 * SQL query generation and result assembly for column profiling.
 * All statistics are computed via SQL — no raw data is transferred.
 */

import type {
  IColumnProfile,
  IHistogramBucket,
  IPattern,
  IProfileAnomaly,
  IProfileQuery,
  ITopValue,
} from './profiler-types';

/** Quote a SQL identifier (table or column name). */
function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
/** Check whether a column type string represents a numeric type. */
export function isNumericType(type: string): boolean {
  return /INT|REAL|FLOAT|DOUBLE|DECIMAL|NUMERIC/i.test(type);
}

/** Build all profiling SQL queries for a given column. */
export function buildProfileQueries(
  table: string,
  column: string,
  type: string,
): IProfileQuery[] {
  const col = q(column);
  const tbl = q(table);
  const numeric = isNumericType(type);
  const queries: IProfileQuery[] = [];

  queries.push({
    name: 'summary',
    sql: `SELECT COUNT(*) AS total, COUNT(${col}) AS non_null,`
      + ` COUNT(*) - COUNT(${col}) AS null_count,`
      + ` COUNT(DISTINCT ${col}) AS distinct_count`
      + ` FROM ${tbl}`,
  });

  queries.push({
    name: 'topValues',
    sql: `SELECT ${col} AS value, COUNT(*) AS cnt`
      + ` FROM ${tbl} WHERE ${col} IS NOT NULL`
      + ` GROUP BY ${col} ORDER BY cnt DESC LIMIT 10`,
  });

  if (numeric) {
    addNumericQueries(queries, tbl, col);
  } else {
    addTextQueries(queries, tbl, col);
  }

  return queries;
}

function addNumericQueries(
  queries: IProfileQuery[],
  tbl: string,
  col: string,
): void {
  queries.push({
    name: 'numericStats',
    sql: `SELECT MIN(${col}) AS min_val, MAX(${col}) AS max_val,`
      + ` AVG(${col}) AS mean_val,`
      + ` SUM(${col} * ${col}) / COUNT(${col})`
      + ` - AVG(${col}) * AVG(${col}) AS variance`
      + ` FROM ${tbl} WHERE ${col} IS NOT NULL`,
  });

  queries.push({
    name: 'median',
    sql: `SELECT ${col} AS median_val FROM ${tbl}`
      + ` WHERE ${col} IS NOT NULL ORDER BY ${col}`
      + ` LIMIT 1 OFFSET`
      + ` (SELECT COUNT(${col}) / 2 FROM ${tbl}`
      + ` WHERE ${col} IS NOT NULL)`,
  });

  queries.push({
    name: 'histogram',
    sql: `WITH bounds AS (`
      + `SELECT MIN(${col}) AS lo, MAX(${col}) AS hi`
      + ` FROM ${tbl} WHERE ${col} IS NOT NULL),`
      + ` buckets AS (`
      + `SELECT ${col},`
      + ` CASE WHEN hi = lo THEN 0`
      + ` ELSE MIN(CAST((${col} - lo) * 10.0 / (hi - lo) AS INT), 9)`
      + ` END AS bucket`
      + ` FROM ${tbl}, bounds WHERE ${col} IS NOT NULL)`
      + ` SELECT bucket, COUNT(*) AS cnt,`
      + ` MIN(${col}) AS bucket_min, MAX(${col}) AS bucket_max`
      + ` FROM buckets GROUP BY bucket ORDER BY bucket`,
  });

  queries.push({
    name: 'outliers',
    sql: `WITH ordered AS (`
      + `SELECT ${col}, ROW_NUMBER() OVER (ORDER BY ${col}) AS rn,`
      + ` COUNT(*) OVER () AS total`
      + ` FROM ${tbl} WHERE ${col} IS NOT NULL),`
      + ` quartiles AS (`
      + `SELECT`
      + ` (SELECT ${col} FROM ordered WHERE rn = total / 4) AS q1,`
      + ` (SELECT ${col} FROM ordered WHERE rn = total * 3 / 4) AS q3)`
      + ` SELECT COUNT(*) AS outlier_count`
      + ` FROM ${tbl}, quartiles`
      + ` WHERE ${col} IS NOT NULL`
      + ` AND (${col} < q1 - 1.5 * (q3 - q1)`
      + ` OR ${col} > q3 + 1.5 * (q3 - q1))`,
  });
}

function addTextQueries(
  queries: IProfileQuery[],
  tbl: string,
  col: string,
): void {
  queries.push({
    name: 'textStats',
    sql: `SELECT MIN(LENGTH(${col})) AS min_len,`
      + ` MAX(LENGTH(${col})) AS max_len,`
      + ` AVG(LENGTH(${col})) AS avg_len,`
      + ` SUM(CASE WHEN ${col} = '' THEN 1 ELSE 0 END) AS empty_count`
      + ` FROM ${tbl} WHERE ${col} IS NOT NULL`,
  });

  queries.push({
    name: 'lengthHistogram',
    sql: `WITH bounds AS (`
      + `SELECT MIN(LENGTH(${col})) AS lo, MAX(LENGTH(${col})) AS hi`
      + ` FROM ${tbl} WHERE ${col} IS NOT NULL AND ${col} != ''),`
      + ` buckets AS (`
      + `SELECT LENGTH(${col}) AS len,`
      + ` CASE WHEN hi = lo THEN 0`
      + ` ELSE MIN(CAST((LENGTH(${col}) - lo) * 10.0 / (hi - lo) AS INT), 9)`
      + ` END AS bucket`
      + ` FROM ${tbl}, bounds`
      + ` WHERE ${col} IS NOT NULL AND ${col} != '')`
      + ` SELECT bucket, COUNT(*) AS cnt,`
      + ` MIN(len) AS bucket_min, MAX(len) AS bucket_max`
      + ` FROM buckets GROUP BY bucket ORDER BY bucket`,
  });

  queries.push({
    name: 'patterns',
    sql: `SELECT SUBSTR(${col}, INSTR(${col}, '@')) AS pattern,`
      + ` COUNT(*) AS cnt`
      + ` FROM ${tbl}`
      + ` WHERE ${col} IS NOT NULL AND INSTR(${col}, '@') > 0`
      + ` GROUP BY pattern ORDER BY cnt DESC LIMIT 10`,
  });
}
function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}
function firstRow(results: Map<string, unknown[][]>, name: string): unknown[] | undefined {
  return (results.get(name) ?? [])[0];
}
/** Assemble a full column profile from query results. */
export function assembleProfile(
  table: string,
  column: string,
  type: string,
  results: Map<string, unknown[][]>,
): IColumnProfile {
  const numeric = isNumericType(type);
  const summary = firstRow(results, 'summary');

  const totalRows = summary ? num(summary[0]) : 0;
  const nonNullCount = summary ? num(summary[1]) : 0;
  const nullCount = summary ? num(summary[2]) : 0;
  const distinctCount = summary ? num(summary[3]) : 0;
  const nullPct = totalRows > 0 ? (nullCount / totalRows) * 100 : 0;

  const topValues = parseTopValues(results, nonNullCount);
  const anomalies = buildAnomalies(nullPct, numeric, results);

  const profile: IColumnProfile = {
    table, column, type, isNumeric: numeric,
    totalRows, nonNullCount, nullCount,
    nullPercentage: nullPct, distinctCount,
    topValues, anomalies,
  };

  if (numeric) {
    applyNumericStats(profile, results);
  } else {
    applyTextStats(profile, results);
  }

  return profile;
}

function parseTopValues(
  results: Map<string, unknown[][]>,
  nonNull: number,
): ITopValue[] {
  const rows = results.get('topValues') ?? [];
  return rows.map((r) => ({
    value: String(r[0] ?? ''),
    count: num(r[1]),
    percentage: nonNull > 0 ? (num(r[1]) / nonNull) * 100 : 0,
  }));
}
function applyNumericStats(
  profile: IColumnProfile,
  results: Map<string, unknown[][]>,
): void {
  const stats = firstRow(results, 'numericStats');
  if (stats) {
    profile.min = num(stats[0]);
    profile.max = num(stats[1]);
    profile.mean = num(stats[2]);
    const variance = num(stats[3]);
    profile.stdDev = variance >= 0 ? Math.sqrt(variance) : 0;
  }
  const med = firstRow(results, 'median');
  if (med) profile.median = num(med[0]);

  profile.histogram = parseHistogram(results, 'histogram', profile.nonNullCount);

  const outlierRow = firstRow(results, 'outliers');
  if (outlierRow) profile.outlierCount = num(outlierRow[0]);
}
function applyTextStats(
  profile: IColumnProfile,
  results: Map<string, unknown[][]>,
): void {
  const stats = firstRow(results, 'textStats');
  if (stats) {
    profile.minLength = num(stats[0]);
    profile.maxLength = num(stats[1]);
    profile.avgLength = num(stats[2]);
    profile.emptyCount = num(stats[3]);
  }
  profile.lengthHistogram = parseHistogram(
    results, 'lengthHistogram', profile.nonNullCount,
  );
  profile.patterns = parsePatterns(results, profile.nonNullCount);
}
function parseHistogram(
  results: Map<string, unknown[][]>,
  name: string,
  nonNull: number,
): IHistogramBucket[] {
  const rows = results.get(name) ?? [];
  return rows.map((r) => ({
    bucketMin: num(r[2]),
    bucketMax: num(r[3]),
    count: num(r[1]),
    percentage: nonNull > 0 ? (num(r[1]) / nonNull) * 100 : 0,
  }));
}
function parsePatterns(
  results: Map<string, unknown[][]>,
  nonNull: number,
): IPattern[] {
  const rows = results.get('patterns') ?? [];
  return rows.map((r) => ({
    pattern: String(r[0] ?? ''),
    count: num(r[1]),
    percentage: nonNull > 0 ? (num(r[1]) / nonNull) * 100 : 0,
  }));
}
function buildAnomalies(
  nullPct: number,
  numeric: boolean,
  results: Map<string, unknown[][]>,
): IProfileAnomaly[] {
  const anomalies: IProfileAnomaly[] = [];

  if (nullPct > 5) {
    anomalies.push({
      severity: 'warning',
      message: `${nullPct.toFixed(1)}% of values are NULL`,
    });
  }

  if (numeric) {
    const outlierRow = firstRow(results, 'outliers');
    const count = outlierRow ? num(outlierRow[0]) : 0;
    if (count > 0) {
      anomalies.push({
        severity: 'info',
        message: `${count} outlier${count === 1 ? '' : 's'} detected (IQR method)`,
      });
    }
  }

  return anomalies;
}
