/**
 * Multi-format table export: JSON, CSV, SQL INSERT, Dart, Markdown.
 *
 * Pure formatting functions plus the VS Code command handler.
 */
import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import { escapeCsvCell, q, zipRow } from '../shared-utils';
import type { ExportFormat, IExportOptions } from './format-export-types';

/** Convert a value to a SQL literal. */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  const s = String(value).replace(/'/g, "''");
  return `'${s}'`;
}

/** Convert a value to a Dart literal. */
export function dartLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  const s = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${s}'`;
}

/** Escape pipe characters and newlines for Markdown table cells. */
function escapeMdCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Dispatch to the correct formatter. */
export function formatExport(options: IExportOptions): string {
  switch (options.format) {
    case 'json': return formatJson(options);
    case 'csv': return formatCsv(options);
    case 'sql': return formatSqlInsert(options);
    case 'dart': return formatDart(options);
    case 'markdown': return formatMarkdown(options);
  }
}

/** Format rows as a JSON array of objects. */
export function formatJson(o: IExportOptions): string {
  return JSON.stringify(o.rows, null, 2);
}

/** Format rows as RFC 4180 CSV. */
export function formatCsv(o: IExportOptions): string {
  const header = o.columns.map(escapeCsvCell).join(',');
  const rows = o.rows.map((row) =>
    o.columns.map((c) => escapeCsvCell(row[c])).join(','),
  );
  return [header, ...rows].join('\n');
}

/** Format rows as SQL INSERT statements. */
export function formatSqlInsert(o: IExportOptions): string {
  const colList = o.columns.map((c) => q(c)).join(', ');
  return o.rows
    .map((row) => {
      const vals = o.columns.map((c) => sqlLiteral(row[c]));
      return `INSERT INTO ${q(o.table)} (${colList}) VALUES (${vals.join(', ')});`;
    })
    .join('\n');
}

/** Format rows as a Dart List<Map<String, Object?>> literal. */
export function formatDart(o: IExportOptions): string {
  if (o.rows.length === 0) {
    return `const ${o.table} = <Map<String, Object?>>[];`;
  }
  const entries = o.rows.map((row) => {
    const pairs = o.columns.map((c) => {
      const key = c.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `'${key}': ${dartLiteral(row[c])}`;
    });
    return `  {${pairs.join(', ')}}`;
  });
  return `const ${o.table} = <Map<String, Object?>>[\n${entries.join(',\n')},\n];`;
}

/** Format rows as a Markdown table. */
export function formatMarkdown(o: IExportOptions): string {
  const header = `| ${o.columns.join(' | ')} |`;
  const sep = `|${o.columns.map(() => '---').join('|')}|`;
  const rows = o.rows.map(
    (row) => `| ${o.columns.map((c) => escapeMdCell(row[c])).join(' | ')} |`,
  );
  return [header, sep, ...rows].join('\n');
}

const FORMAT_LABELS: { label: string; key: ExportFormat }[] = [
  { label: 'JSON', key: 'json' },
  { label: 'CSV', key: 'csv' },
  { label: 'SQL INSERT', key: 'sql' },
  { label: 'Dart', key: 'dart' },
  { label: 'Markdown', key: 'markdown' },
];

/** Map a QuickPick label to its ExportFormat key. */
export function formatKey(label: string): ExportFormat {
  const entry = FORMAT_LABELS.find((f) => f.label === label);
  return entry?.key ?? 'json';
}

const EXT_MAP: Record<ExportFormat, string> = {
  json: 'json',
  csv: 'csv',
  sql: 'sql',
  dart: 'dart',
  markdown: 'md',
};

/** Get the file extension for a format. */
export function fileExtension(format: ExportFormat): string {
  return EXT_MAP[format];
}

/** Full export command: format picker → destination picker → output. */
export async function exportTable(
  client: DriftApiClient,
  tableName: string,
): Promise<void> {
  const format = await vscode.window.showQuickPick(
    FORMAT_LABELS.map((f) => f.label),
    { placeHolder: `Export ${tableName} as\u2026` },
  );
  if (!format) return;

  const dest = await vscode.window.showQuickPick(
    ['Copy to clipboard', 'Save to file'],
    { placeHolder: 'Destination' },
  );
  if (!dest) return;

  const output = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Exporting ${tableName}\u2026`,
    },
    async () => {
      const result = await client.sql(`SELECT * FROM ${q(tableName)}`);
      const rows = result.rows.map((r) => zipRow(result.columns, r));
      return formatExport({
        table: tableName,
        columns: result.columns,
        rows,
        format: formatKey(format),
      });
    },
  );

  if (dest === 'Copy to clipboard') {
    await vscode.env.clipboard.writeText(output);
    vscode.window.showInformationMessage(
      `Copied ${tableName} as ${format} to clipboard.`,
    );
  } else {
    const ext = fileExtension(formatKey(format));
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${tableName}.${ext}`),
      filters: { [format]: [ext] },
    });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(output, 'utf-8'));
      vscode.window.showInformationMessage(
        `Exported ${tableName} to ${format}.`,
      );
    }
  }
}
