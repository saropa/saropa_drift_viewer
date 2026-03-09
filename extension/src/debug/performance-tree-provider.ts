import * as vscode from 'vscode';
import { DriftApiClient } from '../api-client';
import {
  CategoryItem,
  PerfTreeItem,
  PerformanceData,
  QueryItem,
  SummaryItem,
} from './performance-items';

const emptyStats: PerformanceData = {
  totalQueries: 0,
  totalDurationMs: 0,
  avgDurationMs: 0,
  slowQueries: [],
  recentQueries: [],
};

export class PerformanceTreeProvider
  implements vscode.TreeDataProvider<PerfTreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    PerfTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _data: PerformanceData | null = null;
  private _refreshing = false;
  private _refreshTimer: ReturnType<typeof setInterval> | undefined;

  getTreeItem(element: PerfTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PerfTreeItem): PerfTreeItem[] {
    const data = this._data ?? emptyStats;

    if (!element) {
      return [
        new SummaryItem(data),
        new CategoryItem('slow', data.slowQueries.length),
        new CategoryItem('recent', data.recentQueries.length),
      ];
    }

    if (element instanceof CategoryItem) {
      const queries =
        element.category === 'slow' ? data.slowQueries : data.recentQueries;
      return queries.map((q) => new QueryItem(q));
    }

    return [];
  }

  async refresh(client: DriftApiClient): Promise<void> {
    if (this._refreshing) return;
    this._refreshing = true;
    try {
      this._data = await client.performance();
    } catch {
      this._data = null;
    } finally {
      this._refreshing = false;
    }
    this._onDidChangeTreeData.fire();
  }

  startAutoRefresh(client: DriftApiClient, intervalMs: number): void {
    this.stopAutoRefresh();
    this._refreshTimer = setInterval(() => this.refresh(client), intervalMs);
  }

  stopAutoRefresh(): void {
    if (this._refreshTimer !== undefined) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
  }

  get data(): PerformanceData | null {
    return this._data;
  }
}
