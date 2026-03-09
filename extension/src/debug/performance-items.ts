import * as vscode from 'vscode';
import { PerformanceData, QueryEntry } from '../api-client';

export type { PerformanceData, QueryEntry };

export type PerfTreeItem = SummaryItem | CategoryItem | QueryItem;

function truncateSql(sql: string, maxLen: number): string {
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return oneLine.length > maxLen
    ? oneLine.slice(0, maxLen - 1) + '\u2026'
    : oneLine;
}

export class SummaryItem extends vscode.TreeItem {
  constructor(stats: PerformanceData) {
    super(
      `${stats.totalQueries} queries, ${stats.totalDurationMs}ms total`,
      vscode.TreeItemCollapsibleState.None,
    );
    this.description = `avg: ${stats.avgDurationMs}ms`;
    this.iconPath = new vscode.ThemeIcon('graph');
    this.contextValue = 'perfSummary';
  }
}

export class CategoryItem extends vscode.TreeItem {
  constructor(
    public readonly category: 'slow' | 'recent',
    count: number,
  ) {
    const label = category === 'slow' ? 'Slow Queries' : 'Recent Queries';
    super(`${label} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(
      category === 'slow' ? 'warning' : 'list-ordered',
    );
    this.contextValue = 'perfCategory';
  }
}

export class QueryItem extends vscode.TreeItem {
  constructor(public readonly query: QueryEntry) {
    super(truncateSql(query.sql, 50), vscode.TreeItemCollapsibleState.None);
    this.description = `${query.durationMs}ms`;
    this.tooltip = new vscode.MarkdownString(
      `**SQL:** \`${query.sql}\`\n\n` +
        `**Duration:** ${query.durationMs}ms\n` +
        `**Rows:** ${query.rowCount}\n` +
        `**Time:** ${query.at}`,
    );

    if (query.durationMs > 500) {
      this.iconPath = new vscode.ThemeIcon(
        'flame',
        new vscode.ThemeColor('list.errorForeground'),
      );
    } else if (query.durationMs > 100) {
      this.iconPath = new vscode.ThemeIcon(
        'watch',
        new vscode.ThemeColor('list.warningForeground'),
      );
    } else {
      this.iconPath = new vscode.ThemeIcon('check');
    }

    this.command = {
      command: 'driftViewer.showQueryDetail',
      title: 'Show Query Detail',
      arguments: [query],
    };
    this.contextValue = 'perfQuery';
  }
}
