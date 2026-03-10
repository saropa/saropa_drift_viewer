/**
 * Maps SQLite column types back to Drift's DriftSqlType enum values.
 * Used when generating Dart migration code from schema diffs.
 */

/** Map from SQLite type string to Drift DriftSqlType enum value. */
const SQL_TO_DRIFT_TYPE: Record<string, string> = {
  INTEGER: 'DriftSqlType.int',
  TEXT: 'DriftSqlType.string',
  REAL: 'DriftSqlType.double',
  BLOB: 'DriftSqlType.blob',
  BOOLEAN: 'DriftSqlType.bool',
  DATETIME: 'DriftSqlType.dateTime',
  BIGINT: 'DriftSqlType.bigInt',
};

/**
 * Convert a SQLite type string to its Drift `DriftSqlType` enum name.
 * Falls back to `DriftSqlType.string` for unknown types.
 */
export function toDriftType(sqlType: string): string {
  return SQL_TO_DRIFT_TYPE[sqlType.toUpperCase()]
    ?? 'DriftSqlType.string';
}
