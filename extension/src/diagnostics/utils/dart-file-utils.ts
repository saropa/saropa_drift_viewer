/**
 * Shared Dart file / table lookup utilities for diagnostic providers.
 * Extracted for Phase 2 modularization.
 */

import type { IDartFileInfo } from '../diagnostic-types';

/**
 * Finds the Dart file that defines the given SQL table name.
 * @param files - Parsed Dart file infos from the diagnostic context
 * @param tableName - SQL table name (e.g. from a query)
 * @returns The file info that contains the table, or undefined
 */
export function findDartFileForTable(
  files: IDartFileInfo[],
  tableName: string,
): IDartFileInfo | undefined {
  return files.find((f) =>
    f.tables.some((t) => t.sqlTableName.toLowerCase() === tableName.toLowerCase()),
  );
}
