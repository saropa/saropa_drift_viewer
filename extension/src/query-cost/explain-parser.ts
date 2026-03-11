/**
 * Parses EXPLAIN QUERY PLAN output into typed plan nodes with warnings.
 * Reuses buildExplainTree() from the existing explain module for tree construction.
 */

import type { DriftApiClient } from '../api-client';
import { buildExplainTree, IExplainNode } from '../explain/explain-panel';
import type {
  IParsedPlan,
  IPlanNode,
  IPlanWarning,
  IPerformanceSummary,
} from './query-cost-types';

export class ExplainParser {
  async explain(
    client: DriftApiClient,
    sql: string,
  ): Promise<IParsedPlan> {
    const result = await client.explainSql(sql);
    const tree = buildExplainTree(result.rows);
    const nodes = tree.map((n) => this._convertNode(n));
    const warnings = this._generateWarnings(nodes);
    const summary = this._computeSummary(nodes);
    return { nodes, warnings, summary };
  }

  private _convertNode(node: IExplainNode): IPlanNode {
    const detail = node.detail;
    const children = node.children.map((c) => this._convertNode(c));

    const scanMatch = detail.match(/^SCAN TABLE (\w+)/);
    if (scanMatch) {
      return {
        id: node.id,
        parent: node.parent,
        detail,
        operation: 'scan',
        table: scanMatch[1],
        isFullScan:
          !detail.includes('USING INDEX')
          && !detail.includes('USING COVERING INDEX'),
        children,
      };
    }

    // SCAN SUBQUERY also classified as scan, but no table
    if (detail.match(/^SCAN SUBQUERY/)) {
      return {
        id: node.id,
        parent: node.parent,
        detail,
        operation: 'scan',
        isFullScan: false,
        children,
      };
    }

    const searchMatch = detail.match(
      /^SEARCH TABLE (\w+) USING (?:COVERING )?INDEX (\w+)/,
    );
    if (searchMatch) {
      return {
        id: node.id,
        parent: node.parent,
        detail,
        operation: 'search',
        table: searchMatch[1],
        index: searchMatch[2],
        isFullScan: false,
        children,
      };
    }

    if (detail.includes('USE TEMP B-TREE')) {
      return {
        id: node.id,
        parent: node.parent,
        detail,
        operation: 'use_temp_btree',
        isFullScan: false,
        children,
      };
    }

    if (detail.includes('COMPOUND')) {
      return {
        id: node.id,
        parent: node.parent,
        detail,
        operation: 'compound',
        isFullScan: false,
        children,
      };
    }

    return {
      id: node.id,
      parent: node.parent,
      detail,
      operation: 'other',
      isFullScan: false,
      children,
    };
  }

  private _generateWarnings(nodes: IPlanNode[]): IPlanWarning[] {
    const warnings: IPlanWarning[] = [];
    this._walkWarnings(nodes, warnings);
    return warnings;
  }

  private _walkWarnings(
    nodes: IPlanNode[],
    warnings: IPlanWarning[],
  ): void {
    for (const node of nodes) {
      if (node.isFullScan && node.table) {
        warnings.push({
          severity: 'warning',
          message: `Full table scan on "${node.table}"`,
          table: node.table,
          suggestion: `Consider adding an index on frequently filtered columns of "${node.table}"`,
        });
      }
      if (node.operation === 'use_temp_btree') {
        warnings.push({
          severity: 'info',
          message: 'Temporary B-tree used for sorting',
          suggestion:
            'Consider adding an index on ORDER BY / GROUP BY columns',
        });
      }
      this._walkWarnings(node.children, warnings);
    }
  }

  private _computeSummary(nodes: IPlanNode[]): IPerformanceSummary {
    let scanCount = 0;
    let indexCount = 0;
    let tempBTreeCount = 0;
    let totalNodes = 0;

    const walk = (list: IPlanNode[]): void => {
      for (const node of list) {
        totalNodes++;
        if (node.isFullScan) scanCount++;
        if (node.operation === 'search') indexCount++;
        if (node.operation === 'use_temp_btree') tempBTreeCount++;
        walk(node.children);
      }
    };
    walk(nodes);

    return { scanCount, indexCount, tempBTreeCount, totalNodes };
  }
}
