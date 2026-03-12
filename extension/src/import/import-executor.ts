/**
 * Import executor with transaction handling and multiple strategies.
 *
 * This module handles the actual database operations for importing data,
 * supporting multiple import strategies:
 * - Insert: Add new rows, fail on conflicts
 * - Insert Skip Conflicts: Add new rows, skip duplicates silently
 * - Upsert: Add new rows, update existing ones
 * - Dry Run: Preview what would happen without making changes
 *
 * All import operations are wrapped in database transactions for atomicity.
 * Failed imports are rolled back, and the executor tracks inserted/updated
 * rows for potential undo operations.
 *
 * @module import-executor
 */

import type { DriftApiClient } from '../api-client';
import type { ColumnMetadata } from '../api-types';
import type {
  IClipboardImportResult,
  IConflictPreview,
  IDryRunResult,
  IImportOptions,
  IRowError,
  IUpdatedRow,
  IValidationResult,
} from './clipboard-import-types';
import { ImportValidator } from './import-validator';

/**
 * Executes database import operations with transaction safety.
 *
 * Handles row-by-row import with conflict detection and resolution
 * based on the selected strategy. Tracks all changes for undo support.
 *
 * @example
 * ```typescript
 * const executor = new ImportExecutor(apiClient);
 * const result = await executor.execute(tableName, rows, columns, options);
 * if (result.success) {
 *   console.log(`Imported ${result.imported} rows`);
 * }
 * ```
 */
export class ImportExecutor {
  /**
   * Create a new import executor.
   * @param _client - API client for database operations
   */
  constructor(private readonly _client: DriftApiClient) {}

  /**
   * Execute import with the specified strategy.
   *
   * All operations are wrapped in a database transaction. If any row
   * fails and continueOnError is false, the entire import is rolled back.
   * If continueOnError is true, failing rows are recorded and the
   * transaction commits with the successful rows.
   *
   * The method tracks:
   * - insertedIds: IDs of newly inserted rows (for undo via DELETE)
   * - updatedRows: Previous values of updated rows (for undo via UPDATE)
   *
   * @param table - Target table name
   * @param rows - Array of row objects to import
   * @param tableColumns - Table column metadata for PK detection
   * @param options - Import strategy and error handling options
   * @returns Import result with success status, counts, and error details
   * @throws Error if transaction fails and cannot be rolled back
   */
  async execute(
    table: string,
    rows: Record<string, unknown>[],
    tableColumns: ColumnMetadata[],
    options: IImportOptions,
  ): Promise<IClipboardImportResult> {
    const result: IClipboardImportResult = {
      success: false,
      imported: 0,
      skipped: 0,
      errors: [],
      insertedIds: [],
      updatedRows: [],
    };

    if (rows.length === 0) {
      result.success = true;
      return result;
    }

    const pkColumn = tableColumns.find((c) => c.pk)?.name;
    const matchColumns = this._getMatchColumns(options, pkColumn);

    try {
      await this._client.sql('BEGIN TRANSACTION');

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        try {
          if (options.strategy === 'upsert' && matchColumns.length > 0) {
            const existing = await this._findExisting(table, row, matchColumns);

            if (existing) {
              const existingId = existing[pkColumn ?? matchColumns[0]] as string | number;
              result.updatedRows.push({
                id: existingId,
                previousValues: existing,
              });
              await this._updateRow(table, row, matchColumns);
              result.imported++;
            } else {
              const id = await this._insertRow(table, row, pkColumn);
              if (id !== undefined) {
                result.insertedIds.push(id);
              }
              result.imported++;
            }
          } else if (options.strategy === 'insert_skip_conflicts' && matchColumns.length > 0) {
            const existing = await this._findExisting(table, row, matchColumns);

            if (existing) {
              result.skipped++;
            } else {
              const id = await this._insertRow(table, row, pkColumn);
              if (id !== undefined) {
                result.insertedIds.push(id);
              }
              result.imported++;
            }
          } else {
            const id = await this._insertRow(table, row, pkColumn);
            if (id !== undefined) {
              result.insertedIds.push(id);
            }
            result.imported++;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);

          if (!options.continueOnError) {
            await this._client.sql('ROLLBACK');
            result.errors.push({ row: i, error: message, data: row });
            return result;
          }

          result.errors.push({ row: i, error: message, data: row });
        }
      }

      await this._client.sql('COMMIT');
      result.success = true;
      return result;
    } catch (err) {
      try {
        await this._client.sql('ROLLBACK');
      } catch {
        // Rollback failed, transaction may already be aborted
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Import failed and was rolled back: ${message}`);
    }
  }

  /**
   * Perform a dry run to preview what would happen.
   *
   * Executes validation and conflict detection without modifying data.
   * For each row, determines whether it would be:
   * - Inserted as new (no matching row exists)
   * - Updated (upsert mode with matching row)
   * - Skipped (insert_skip_conflicts mode with matching row)
   *
   * For updates, generates a detailed diff showing which columns
   * would change and their before/after values.
   *
   * @param table - Target table name
   * @param rows - Array of row objects to preview
   * @param tableColumns - Table column metadata
   * @param options - Import options (strategy affects preview behavior)
   * @returns Dry run result with counts, conflicts, and validation errors
   */
  async dryRun(
    table: string,
    rows: Record<string, unknown>[],
    tableColumns: ColumnMetadata[],
    options: IImportOptions,
  ): Promise<IDryRunResult> {
    const validator = new ImportValidator(this._client);
    const validationErrors = await validator.validate(table, rows, tableColumns, options);

    const result: IDryRunResult = {
      wouldInsert: 0,
      wouldUpdate: 0,
      wouldSkip: 0,
      conflicts: [],
      validationErrors,
    };

    const pkColumn = tableColumns.find((c) => c.pk)?.name;
    const matchColumns = this._getMatchColumns(options, pkColumn);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (matchColumns.length > 0) {
        const existing = await this._findExisting(table, row, matchColumns);

        if (existing) {
          if (options.strategy === 'insert') {
            result.wouldSkip++;
          } else if (options.strategy === 'insert_skip_conflicts') {
            result.wouldSkip++;
          } else if (options.strategy === 'upsert') {
            result.wouldUpdate++;

            const diff: { column: string; from: unknown; to: unknown }[] = [];
            for (const [col, val] of Object.entries(row)) {
              if (matchColumns.includes(col)) continue;
              if (existing[col] !== val && val !== null && val !== undefined) {
                diff.push({ column: col, from: existing[col], to: val });
              }
            }

            if (diff.length > 0) {
              const conflictId = existing[pkColumn ?? matchColumns[0]] as string | number;
              result.conflicts.push({
                row: i,
                existingId: conflictId,
                existingValues: existing,
                newValues: row,
                diff,
              });
            }
          }
        } else {
          result.wouldInsert++;
        }
      } else {
        result.wouldInsert++;
      }
    }

    return result;
  }

  /**
   * Undo a previous import by deleting inserted rows and restoring updated rows.
   *
   * Reverses an import operation by:
   * 1. Deleting all rows that were inserted (by their tracked IDs)
   * 2. Restoring previous values for rows that were updated
   *
   * The undo operation is wrapped in a transaction for atomicity.
   * If the undo fails, changes are rolled back and the original
   * import remains in effect.
   *
   * @param table - Table where import was performed
   * @param insertedIds - IDs of rows that were inserted
   * @param updatedRows - Updated rows with their previous values
   * @param pkColumn - Primary key column name for WHERE clauses
   * @returns Success status and error message if failed
   */
  async undoImport(
    table: string,
    insertedIds: (string | number)[],
    updatedRows: IUpdatedRow[],
    pkColumn: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this._client.sql('BEGIN TRANSACTION');

      for (const id of insertedIds) {
        await this._client.sql(
          `DELETE FROM "${table}" WHERE "${pkColumn}" = '${this._escape(String(id))}'`,
        );
      }

      for (const update of updatedRows) {
        const setClauses = Object.entries(update.previousValues)
          .filter(([col]) => col !== pkColumn)
          .map(([col, val]) => {
            if (val === null || val === undefined) {
              return `"${col}" = NULL`;
            }
            return `"${col}" = '${this._escape(String(val))}'`;
          })
          .join(', ');

        if (setClauses) {
          await this._client.sql(
            `UPDATE "${table}" SET ${setClauses} WHERE "${pkColumn}" = '${this._escape(String(update.id))}'`,
          );
        }
      }

      await this._client.sql('COMMIT');
      return { success: true };
    } catch (err) {
      try {
        await this._client.sql('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }

      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Determine which columns to use for matching existing rows.
   *
   * Resolves the matchBy option to actual column names:
   * - 'pk': Use the primary key column
   * - string[]: Use the specified columns directly
   *
   * Falls back to primary key if available when no match columns specified.
   *
   * @param options - Import options containing matchBy setting
   * @param pkColumn - Primary key column name, if table has one
   * @returns Array of column names to use for matching
   */
  private _getMatchColumns(options: IImportOptions, pkColumn: string | undefined): string[] {
    if (options.matchBy === 'pk' && pkColumn) {
      return [pkColumn];
    } else if (Array.isArray(options.matchBy)) {
      return options.matchBy;
    }
    return pkColumn ? [pkColumn] : [];
  }

  /**
   * Find an existing row matching the given values.
   *
   * Queries the database for a row where all match columns equal
   * the corresponding values in the input row. Used for conflict
   * detection in upsert and skip_conflicts modes.
   *
   * @param table - Table to search
   * @param row - Row data containing values for match columns
   * @param matchColumns - Columns to match on
   * @returns Existing row data if found, null otherwise
   */
  private async _findExisting(
    table: string,
    row: Record<string, unknown>,
    matchColumns: string[],
  ): Promise<Record<string, unknown> | null> {
    const conditions = matchColumns
      .filter((col) => row[col] !== null && row[col] !== undefined)
      .map((col) => `"${col}" = '${this._escape(String(row[col]))}'`)
      .join(' AND ');

    if (!conditions) {
      return null;
    }

    try {
      const result = await this._client.sql(
        `SELECT * FROM "${table}" WHERE ${conditions} LIMIT 1`,
      );

      if (result.rows.length === 0) {
        return null;
      }

      const existing: Record<string, unknown> = {};
      result.columns.forEach((col, i) => {
        existing[col] = result.rows[0][i];
      });
      return existing;
    } catch {
      return null;
    }
  }

  /**
   * Insert a single row into the table.
   *
   * Constructs and executes an INSERT statement, then retrieves
   * the auto-generated ID if the table has a primary key column.
   *
   * @param table - Target table name
   * @param row - Row data to insert
   * @param pkColumn - Primary key column for ID retrieval
   * @returns Inserted row ID if available, undefined otherwise
   */
  private async _insertRow(
    table: string,
    row: Record<string, unknown>,
    pkColumn: string | undefined,
  ): Promise<string | number | undefined> {
    const columns = Object.keys(row).filter((k) => row[k] !== undefined);
    const values = columns.map((col) => {
      const val = row[col];
      if (val === null) {
        return 'NULL';
      }
      return `'${this._escape(String(val))}'`;
    });

    const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${values.join(', ')})`;
    await this._client.sql(sql);

    if (pkColumn) {
      const lastId = await this._client.sql('SELECT last_insert_rowid()');
      if (lastId.rows.length > 0) {
        return lastId.rows[0][0] as number;
      }
    }

    return undefined;
  }

  /**
   * Update an existing row with new values.
   *
   * Constructs and executes an UPDATE statement setting all columns
   * except the match columns (which are used in the WHERE clause).
   *
   * @param table - Target table name
   * @param row - Row data containing new values
   * @param matchColumns - Columns used to identify the row (WHERE clause)
   */
  private async _updateRow(
    table: string,
    row: Record<string, unknown>,
    matchColumns: string[],
  ): Promise<void> {
    const setClauses = Object.entries(row)
      .filter(([col]) => !matchColumns.includes(col))
      .map(([col, val]) => {
        if (val === null || val === undefined) {
          return `"${col}" = NULL`;
        }
        return `"${col}" = '${this._escape(String(val))}'`;
      })
      .join(', ');

    const conditions = matchColumns
      .map((col) => `"${col}" = '${this._escape(String(row[col]))}'`)
      .join(' AND ');

    if (setClauses && conditions) {
      await this._client.sql(`UPDATE "${table}" SET ${setClauses} WHERE ${conditions}`);
    }
  }

  /**
   * Escape single quotes in SQL string values.
   *
   * Doubles single quotes per SQL standard to prevent injection
   * and allow literal quotes in values.
   *
   * @param value - String value to escape
   * @returns Escaped string safe for SQL insertion
   */
  private _escape(value: string): string {
    return value.replace(/'/g, "''");
  }
}
