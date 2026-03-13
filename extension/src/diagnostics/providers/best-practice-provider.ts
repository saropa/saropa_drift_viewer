import * as vscode from 'vscode';
import type { ForeignKey, TableMetadata } from '../../api-types';
import type { IDartColumn, IDartTable } from '../../schema-diff/dart-schema';
import type {
  DiagnosticCategory,
  IDartFileInfo,
  IDiagnosticContext,
  IDiagnosticIssue,
  IDiagnosticProvider,
} from '../diagnostic-types';
import { findDartFileForTable } from '../utils/dart-file-utils';

/**
 * Best practice diagnostic provider.
 * Reports Drift/SQLite best practice issues including:
 * - autoIncrement on non-PK columns
 * - Tables without foreign key relationships
 * - Circular FK relationships
 * - BLOB columns that may cause memory issues
 */
export class BestPracticeProvider implements IDiagnosticProvider {
  readonly id = 'bestPractices';
  readonly category: DiagnosticCategory = 'bestPractices';

  async collectDiagnostics(ctx: IDiagnosticContext): Promise<IDiagnosticIssue[]> {
    const issues: IDiagnosticIssue[] = [];

    try {
      const tables = await ctx.client.schemaMetadata();
      const userTables = tables.filter((t) => !t.name.startsWith('sqlite_'));

      const fkMap = new Map<string, ForeignKey[]>();
      await Promise.all(
        userTables.map(async (t) => {
          const fks = await ctx.client.tableFkMeta(t.name);
          fkMap.set(t.name, fks);
        }),
      );

      for (const file of ctx.dartFiles) {
        for (const dartTable of file.tables) {
          const dbTable = userTables.find(
            (t) => t.name === dartTable.sqlTableName,
          );
          const fks = fkMap.get(dartTable.sqlTableName) ?? [];

          this._checkAutoIncrementNotPk(issues, file, dartTable, dbTable);
          this._checkNoForeignKeys(issues, file, dartTable, fks);
          this._checkBlobColumns(issues, file, dartTable);
        }
      }

      this._checkCircularFks(issues, fkMap, ctx.dartFiles);
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

    // Add "Disable this rule" action for all best practice diagnostics
    const disableAction = new vscode.CodeAction(
      `Disable "${code}" rule`,
      vscode.CodeActionKind.QuickFix,
    );
    disableAction.command = {
      command: 'driftViewer.disableDiagnosticRule',
      title: 'Disable Rule',
      arguments: [code],
    };
    actions.push(disableAction);

    if (code === 'no-foreign-keys') {
      const diagramAction = new vscode.CodeAction(
        'View ER Diagram',
        vscode.CodeActionKind.QuickFix,
      );
      diagramAction.command = {
        command: 'driftViewer.showDiagram',
        title: 'ER Diagram',
      };
      actions.push(diagramAction);
    }

    if (code === 'circular-fk') {
      const impactAction = new vscode.CodeAction(
        'Analyze Impact',
        vscode.CodeActionKind.QuickFix,
      );
      impactAction.command = {
        command: 'driftViewer.analyzeImpact',
        title: 'Impact Analysis',
      };
      actions.push(impactAction);
    }

    if (code === 'blob-column-large') {
      const profileAction = new vscode.CodeAction(
        'Profile Column',
        vscode.CodeActionKind.QuickFix,
      );
      const data = (diag as any).data;
      if (data?.table && data?.column) {
        profileAction.command = {
          command: 'driftViewer.profileColumn',
          title: 'Profile',
          arguments: [{ table: data.table, column: data.column }],
        };
        actions.push(profileAction);
      }
    }

    return actions;
  }

  dispose(): void {}

  private _checkAutoIncrementNotPk(
    issues: IDiagnosticIssue[],
    file: IDartFileInfo,
    dartTable: IDartTable,
    dbTable: TableMetadata | undefined,
  ): void {
    if (!dbTable) return;

    for (const dartCol of dartTable.columns) {
      if (dartCol.autoIncrement) {
        const dbCol = dbTable.columns.find((c) => c.name === dartCol.sqlName);
        if (dbCol && !dbCol.pk) {
          issues.push({
            code: 'autoincrement-not-pk',
            message: `Column "${dartTable.sqlTableName}.${dartCol.sqlName}" uses autoIncrement but is not primary key`,
            fileUri: file.uri,
            range: new vscode.Range(dartCol.line, 0, dartCol.line, 999),
            severity: vscode.DiagnosticSeverity.Error,
          });
        }
      }
    }
  }

  private _checkNoForeignKeys(
    issues: IDiagnosticIssue[],
    file: IDartFileInfo,
    dartTable: IDartTable,
    fks: ForeignKey[],
  ): void {
    if (fks.length === 0 && dartTable.columns.length > 1) {
      const hasIdColumn = dartTable.columns.some(
        (c) => c.sqlName === 'id' || c.autoIncrement,
      );
      const hasOtherColumns = dartTable.columns.some(
        (c) => c.sqlName !== 'id' && !c.autoIncrement,
      );

      if (hasIdColumn && hasOtherColumns) {
        issues.push({
          code: 'no-foreign-keys',
          message: `Table "${dartTable.sqlTableName}" has no foreign key relationships`,
          fileUri: file.uri,
          range: new vscode.Range(dartTable.line, 0, dartTable.line, 999),
          severity: vscode.DiagnosticSeverity.Information,
        });
      }
    }
  }

  private _checkBlobColumns(
    issues: IDiagnosticIssue[],
    file: IDartFileInfo,
    dartTable: IDartTable,
  ): void {
    for (const dartCol of dartTable.columns) {
      if (dartCol.dartType === 'BlobColumn') {
        issues.push({
          code: 'blob-column-large',
          message: `BLOB column "${dartTable.sqlTableName}.${dartCol.sqlName}" may cause memory issues with large data`,
          fileUri: file.uri,
          range: new vscode.Range(dartCol.line, 0, dartCol.line, 999),
          severity: vscode.DiagnosticSeverity.Information,
          data: { table: dartTable.sqlTableName, column: dartCol.sqlName },
        });
      }
    }
  }

  private _checkCircularFks(
    issues: IDiagnosticIssue[],
    fkMap: Map<string, ForeignKey[]>,
    dartFiles: IDartFileInfo[],
  ): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const detectCycle = (
      table: string,
      path: string[],
    ): string[] | null => {
      if (recursionStack.has(table)) {
        const cycleStart = path.indexOf(table);
        return path.slice(cycleStart);
      }

      if (visited.has(table)) {
        return null;
      }

      visited.add(table);
      recursionStack.add(table);

      const fks = fkMap.get(table) ?? [];
      for (const fk of fks) {
        const cycle = detectCycle(fk.toTable, [...path, table]);
        if (cycle) {
          return cycle;
        }
      }

      recursionStack.delete(table);
      return null;
    };

    const reportedCycles = new Set<string>();

    fkMap.forEach((_, tableName) => {
      visited.clear();
      recursionStack.clear();

      const cycle = detectCycle(tableName, []);
      if (cycle && cycle.length > 0) {
        const cycleKey = [...cycle].sort().join(',');
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);

          const firstTable = cycle[0];
          const dartFile = findDartFileForTable(dartFiles, firstTable);
          if (dartFile) {
            const dartTable = dartFile.tables.find(
              (t) => t.sqlTableName === firstTable,
            );
            const line = dartTable?.line ?? 0;

            const cyclePath = [...cycle, cycle[0]].join(' → ');

            issues.push({
              code: 'circular-fk',
              message: `Circular foreign key relationship detected: ${cyclePath}`,
              fileUri: dartFile.uri,
              range: new vscode.Range(line, 0, line, 999),
              severity: vscode.DiagnosticSeverity.Warning,
            });
          }
        }
      }
    });
  }
}
