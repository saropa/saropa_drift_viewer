/** Supported export formats for table data. */
export type ExportFormat = 'json' | 'csv' | 'sql' | 'dart' | 'markdown';

/** Options for formatting table data into an export string. */
export interface IExportOptions {
  /** Table name (used in SQL INSERT and Dart variable name). */
  table: string;
  /** Ordered column names. */
  columns: string[];
  /** Row data keyed by column name. */
  rows: Record<string, unknown>[];
  /** Target format. */
  format: ExportFormat;
}
