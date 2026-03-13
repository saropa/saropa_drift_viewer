/**
 * Performance diagnostic provider.
 * Reports query performance issues: slow queries, N+1 patterns, unindexed WHERE.
 * Checker logic lives in diagnostics/checkers/.
 */

import * as vscode from 'vscode';
import type {
  DiagnosticCategory,
  IDiagnosticContext,
  IDiagnosticIssue,
  IDiagnosticProvider,
} from '../diagnostic-types';
import { checkNPlusOnePatterns } from '../checkers/n-plus-one-checker';
import { checkQueryPatterns } from '../checkers/query-pattern-checker';
import { checkSlowQueries } from '../checkers/slow-query-checker';

export class PerformanceProvider implements IDiagnosticProvider {
  readonly id = 'performance';
  readonly category: DiagnosticCategory = 'performance';

  async collectDiagnostics(ctx: IDiagnosticContext): Promise<IDiagnosticIssue[]> {
    const issues: IDiagnosticIssue[] = [];

    try {
      const [perfData, patternSuggestions] = await Promise.all([
        ctx.client.performance(),
        ctx.queryIntel.getSuggestedIndexes(),
      ]);

      checkSlowQueries(issues, perfData, ctx.dartFiles);
      checkQueryPatterns(issues, patternSuggestions, ctx.dartFiles);
      checkNPlusOnePatterns(issues, perfData, ctx.dartFiles);
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

    if (code === 'slow-query-pattern') {
      const analyzeAction = new vscode.CodeAction(
        'Analyze Query Cost',
        vscode.CodeActionKind.QuickFix,
      );
      analyzeAction.command = {
        command: 'driftViewer.analyzeQueryCost',
        title: 'Analyze Query',
      };
      actions.push(analyzeAction);

      const perfAction = new vscode.CodeAction(
        'View Performance Panel',
        vscode.CodeActionKind.QuickFix,
      );
      perfAction.command = {
        command: 'driftViewer.refreshPerformance',
        title: 'Performance',
      };
      actions.push(perfAction);
    }

    if (code === 'unindexed-where-clause' || code === 'unindexed-join') {
      const sql = (diag as vscode.Diagnostic & { data?: { sql?: string } }).data?.sql;
      if (sql) {
        const copyAction = new vscode.CodeAction(
          'Copy CREATE INDEX SQL',
          vscode.CodeActionKind.QuickFix,
        );
        copyAction.command = {
          command: 'driftViewer.copySuggestedSql',
          title: 'Copy SQL',
          arguments: [sql],
        };
        actions.push(copyAction);

        const runAction = new vscode.CodeAction(
          'Run CREATE INDEX Now',
          vscode.CodeActionKind.QuickFix,
        );
        runAction.command = {
          command: 'driftViewer.runIndexSql',
          title: 'Run SQL',
          arguments: [sql],
        };
        runAction.isPreferred = true;
        actions.push(runAction);
      }
    }

    if (code === 'full-table-scan') {
      const viewAction = new vscode.CodeAction(
        'View Index Suggestions',
        vscode.CodeActionKind.QuickFix,
      );
      viewAction.command = {
        command: 'driftViewer.showIndexSuggestions',
        title: 'Index Suggestions',
      };
      actions.push(viewAction);
    }

    if (code === 'n-plus-one') {
      const docsAction = new vscode.CodeAction(
        'Learn About N+1 Queries',
        vscode.CodeActionKind.QuickFix,
      );
      docsAction.command = {
        command: 'vscode.open',
        title: 'Open Documentation',
        arguments: [vscode.Uri.parse('https://drift.simonbinder.eu/docs/advanced-features/joins/')],
      };
      actions.push(docsAction);
    }

    return actions;
  }

  dispose(): void {}
}
