/**
 * Suggests CREATE INDEX statements based on query plan analysis and SQL parsing.
 * Uses regex-based heuristics to extract WHERE, JOIN, and ORDER BY columns.
 */

import type { DriftApiClient } from '../api-client';
import type { IParsedPlan, IIndexSuggestion } from './query-cost-types';

export class IndexSuggester {
  constructor(private readonly _client: DriftApiClient) {}

  async suggest(
    sql: string,
    plan: IParsedPlan,
  ): Promise<IIndexSuggestion[]> {
    const suggestions: IIndexSuggestion[] = [];
    const existingIndexes = await this._getExistingIndexes();

    for (const node of plan.nodes) {
      this._suggestForNode(sql, node, existingIndexes, suggestions);
    }

    // Suggest for temp B-tree (ORDER BY / GROUP BY without index)
    this._suggestForTempBTrees(sql, plan, existingIndexes, suggestions);

    return suggestions;
  }

  private _suggestForNode(
    sql: string,
    node: IParsedPlan['nodes'][number],
    existingIndexes: Set<string>,
    suggestions: IIndexSuggestion[],
  ): void {
    if (node.isFullScan && node.table) {
      const whereColumns = this.extractWhereColumns(sql, node.table);
      const joinColumns = this.extractJoinColumns(sql, node.table);
      const targetColumns = [...whereColumns, ...joinColumns];

      if (targetColumns.length > 0) {
        const indexName = `idx_${node.table}_${targetColumns.join('_')}`;
        if (!existingIndexes.has(indexName)) {
          const colList = targetColumns
            .map((c) => `"${c}"`)
            .join(', ');
          suggestions.push({
            sql: `CREATE INDEX "${indexName}" ON "${node.table}"(${colList});`,
            reason: `Avoids full scan on "${node.table}" when filtering by ${targetColumns.join(', ')}`,
            impact: 'high',
          });
        }
      }
    }

    for (const child of node.children) {
      this._suggestForNode(sql, child, existingIndexes, suggestions);
    }
  }

  private _suggestForTempBTrees(
    sql: string,
    plan: IParsedPlan,
    existingIndexes: Set<string>,
    suggestions: IIndexSuggestion[],
  ): void {
    const hasTempBTree = this._hasTempBTree(plan.nodes);
    if (!hasTempBTree) return;

    const orderColumns = this.extractOrderByColumns(sql);
    if (orderColumns.length === 0) return;

    const table = this.extractMainTable(sql);
    if (!table) return;

    const indexName = `idx_${table}_${orderColumns.join('_')}`;
    if (existingIndexes.has(indexName)) return;

    const colList = orderColumns.map((c) => `"${c}"`).join(', ');
    suggestions.push({
      sql: `CREATE INDEX "${indexName}" ON "${table}"(${colList});`,
      reason: `Avoids temporary sort for ORDER BY ${orderColumns.join(', ')}`,
      impact: 'medium',
    });
  }

  private _hasTempBTree(nodes: IParsedPlan['nodes']): boolean {
    for (const node of nodes) {
      if (node.operation === 'use_temp_btree') return true;
      if (this._hasTempBTree(node.children)) return true;
    }
    return false;
  }

  private async _getExistingIndexes(): Promise<Set<string>> {
    const result = await this._client.sql(
      "SELECT name FROM sqlite_master WHERE type='index'",
    );
    return new Set(result.rows.map((r) => String(r[0])));
  }

  extractWhereColumns(sql: string, table: string): string[] {
    const whereMatch = sql.match(
      /WHERE\s+(.+?)(?:GROUP|ORDER|LIMIT|$)/is,
    );
    if (!whereMatch) return [];

    const columns: string[] = [];
    // Match table.col or alias.col or bare col with comparison operators
    const colPattern = new RegExp(
      `(?:${table}\\.|"${table}"\\.)?"?(\\w+)"?\\s*[=<>!]`,
      'gi',
    );
    let match;
    while ((match = colPattern.exec(whereMatch[1])) !== null) {
      columns.push(match[1]);
    }
    return [...new Set(columns)];
  }

  extractJoinColumns(sql: string, table: string): string[] {
    const columns: string[] = [];
    const joinPattern = new RegExp(
      `(?:${table}\\.)?"?(\\w+)"?\\s*=\\s*\\w+\\.\\w+`
      + `|\\w+\\.\\w+\\s*=\\s*(?:${table}\\.)?"?(\\w+)"?`,
      'gi',
    );
    let match;
    while ((match = joinPattern.exec(sql)) !== null) {
      if (match[1]) columns.push(match[1]);
      if (match[2]) columns.push(match[2]);
    }
    return [...new Set(columns)];
  }

  extractOrderByColumns(sql: string): string[] {
    const match = sql.match(/ORDER\s+BY\s+(.+?)(?:LIMIT|$)/is);
    if (!match) return [];
    return match[1]
      .split(',')
      .map((c) =>
        c.trim().replace(/\s+(ASC|DESC)$/i, '').replace(/"/g, ''),
      );
  }

  extractMainTable(sql: string): string | null {
    const match = sql.match(/FROM\s+"?(\w+)"?/i);
    return match ? match[1] : null;
  }
}
