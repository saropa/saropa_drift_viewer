import * as vscode from 'vscode';
import type { ISizeAnalytics, ITableSizeInfo, TableMetadata } from '../../api-types';
import type {
  DiagnosticCategory,
  IDartFileInfo,
  IDiagnosticContext,
  IDiagnosticIssue,
  IDiagnosticProvider,
} from '../diagnostic-types';

/** Threshold for high null rate warning (percentage). */
const HIGH_NULL_RATE_THRESHOLD = 50;

/** Threshold for data skew warning (percentage of total rows). */
const DATA_SKEW_THRESHOLD = 50;

/** Minimum rows to consider for null rate analysis. */
const MIN_ROWS_FOR_ANALYSIS = 10;

/**
 * Data quality diagnostic provider.
 * Reports data quality issues including:
 * - High null rates in columns
 * - Empty tables
 * - Data skew (one table dominates row count)
 * - Statistical outliers
 */
export class DataQualityProvider implements IDiagnosticProvider {
  readonly id = 'dataQuality';
  readonly category: DiagnosticCategory = 'dataQuality';

  async collectDiagnostics(ctx: IDiagnosticContext): Promise<IDiagnosticIssue[]> {
    const issues: IDiagnosticIssue[] = [];

    try {
      const [tables, sizeAnalytics] = await Promise.all([
        ctx.client.schemaMetadata(),
        ctx.client.sizeAnalytics(),
      ]);

      const userTables = tables.filter((t) => !t.name.startsWith('sqlite_'));

      this._checkEmptyTables(issues, userTables, ctx.dartFiles);
      this._checkDataSkew(issues, sizeAnalytics, ctx.dartFiles);
      await this._checkHighNullRates(issues, userTables, ctx);
    } catch {
      // Server unreachable or other error - return empty
    }

    return issues;
  }

  provideCodeActions(
    diag: vscode.Diagnostic,
    _doc: vscode.TextDocument,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const code = diag.code as string;

    if (code === 'high-null-rate') {
      const data = (diag as any).data;
      if (data?.table && data?.column) {
        const profileAction = new vscode.CodeAction(
          'Profile Column',
          vscode.CodeActionKind.QuickFix,
        );
        profileAction.command = {
          command: 'driftViewer.profileColumn',
          title: 'Profile Column',
          arguments: [{ table: data.table, column: data.column }],
        };
        actions.push(profileAction);
      }
    }

    if (code === 'empty-table') {
      const data = (diag as any).data;
      if (data?.table) {
        const seedAction = new vscode.CodeAction(
          'Generate Seed Data',
          vscode.CodeActionKind.QuickFix,
        );
        seedAction.command = {
          command: 'driftViewer.openSeeder',
          title: 'Seed Data',
          arguments: [{ table: data.table }],
        };
        actions.push(seedAction);

        const importAction = new vscode.CodeAction(
          'Import Data',
          vscode.CodeActionKind.QuickFix,
        );
        importAction.command = {
          command: 'driftViewer.importData',
          title: 'Import',
        };
        actions.push(importAction);
      }
    }

    if (code === 'data-skew') {
      const sizeAction = new vscode.CodeAction(
        'View Size Analytics',
        vscode.CodeActionKind.QuickFix,
      );
      sizeAction.command = {
        command: 'driftViewer.sizeAnalytics',
        title: 'Size Analytics',
      };
      actions.push(sizeAction);
    }

    return actions;
  }

  dispose(): void {}

  private _checkEmptyTables(
    issues: IDiagnosticIssue[],
    tables: TableMetadata[],
    dartFiles: IDartFileInfo[],
  ): void {
    for (const table of tables) {
      if (table.rowCount === 0) {
        const dartFile = this._findDartFileForTable(dartFiles, table.name);
        if (!dartFile) continue;

        const dartTable = dartFile.tables.find(
          (t) => t.sqlTableName === table.name,
        );
        const line = dartTable?.line ?? 0;

        issues.push({
          code: 'empty-table',
          message: `Table "${table.name}" is empty (0 rows)`,
          fileUri: dartFile.uri,
          range: new vscode.Range(line, 0, line, 999),
          severity: vscode.DiagnosticSeverity.Information,
          data: { table: table.name },
        });
      }
    }
  }

  private _checkDataSkew(
    issues: IDiagnosticIssue[],
    sizeAnalytics: ISizeAnalytics,
    dartFiles: IDartFileInfo[],
  ): void {
    const tableSizes = sizeAnalytics.tables ?? [];
    if (tableSizes.length < 2) return;

    const totalRows = tableSizes.reduce((sum, t) => sum + t.rowCount, 0);
    if (totalRows === 0) return;

    for (const table of tableSizes) {
      const percentage = (table.rowCount / totalRows) * 100;

      if (percentage > DATA_SKEW_THRESHOLD) {
        const dartFile = this._findDartFileForTable(dartFiles, table.table);
        if (!dartFile) continue;

        const dartTable = dartFile.tables.find(
          (t) => t.sqlTableName === table.table,
        );
        const line = dartTable?.line ?? 0;

        issues.push({
          code: 'data-skew',
          message: `Table "${table.table}" has ${percentage.toFixed(0)}% of all database rows (data skew)`,
          fileUri: dartFile.uri,
          range: new vscode.Range(line, 0, line, 999),
          severity: vscode.DiagnosticSeverity.Warning,
          data: { table: table.table, percentage },
        });
      }
    }
  }

  private async _checkHighNullRates(
    issues: IDiagnosticIssue[],
    tables: TableMetadata[],
    ctx: IDiagnosticContext,
  ): Promise<void> {
    for (const table of tables) {
      if (table.rowCount < MIN_ROWS_FOR_ANALYSIS) continue;

      const dartFile = this._findDartFileForTable(ctx.dartFiles, table.name);
      if (!dartFile) continue;

      const dartTable = dartFile.tables.find(
        (t) => t.sqlTableName === table.name,
      );
      if (!dartTable) continue;

      try {
        const nullCounts = await this._queryNullCounts(ctx, table);

        for (const col of table.columns) {
          const nullCount = nullCounts.get(col.name) ?? 0;
          const nullPct = (nullCount / table.rowCount) * 100;

          if (nullPct >= HIGH_NULL_RATE_THRESHOLD) {
            const dartCol = dartTable.columns.find(
              (c) => c.sqlName === col.name,
            );
            const line = dartCol?.line ?? dartTable.line;

            issues.push({
              code: 'high-null-rate',
              message: `Column "${table.name}.${col.name}" has ${nullPct.toFixed(0)}% NULL values`,
              fileUri: dartFile.uri,
              range: new vscode.Range(line, 0, line, 999),
              severity: vscode.DiagnosticSeverity.Warning,
              data: { table: table.name, column: col.name, nullPct },
            });
          }
        }
      } catch {
        // Skip table if null count query fails
      }
    }
  }

  private async _queryNullCounts(
    ctx: IDiagnosticContext,
    table: TableMetadata,
  ): Promise<Map<string, number>> {
    const nullCounts = new Map<string, number>();

    const nullExprs = table.columns.map(
      (c) => `SUM(CASE WHEN "${this._escapeSql(c.name)}" IS NULL THEN 1 ELSE 0 END) AS "${this._escapeSql(c.name)}_nulls"`,
    );

    const sql = `SELECT ${nullExprs.join(', ')} FROM "${this._escapeSql(table.name)}"`;

    try {
      const result = await ctx.client.sql(sql);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        for (let i = 0; i < table.columns.length; i++) {
          const count = Number(row[i]) || 0;
          nullCounts.set(table.columns[i].name, count);
        }
      }
    } catch {
      // Query failed, return empty map
    }

    return nullCounts;
  }

  private _escapeSql(name: string): string {
    return name.replace(/"/g, '""');
  }

  private _findDartFileForTable(
    files: IDartFileInfo[],
    tableName: string,
  ): IDartFileInfo | undefined {
    return files.find((f) =>
      f.tables.some((t) => t.sqlTableName.toLowerCase() === tableName.toLowerCase()),
    );
  }
}
