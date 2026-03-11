/**
 * Shared interfaces for the Query Cost Analyzer feature.
 */

/** Enriched plan node with operation classification. */
export interface IPlanNode {
  id: number;
  parent: number;
  detail: string;
  operation: 'scan' | 'search' | 'use_temp_btree' | 'compound' | 'other';
  table?: string;
  index?: string;
  isFullScan: boolean;
  children: IPlanNode[];
}

/** Warning generated from plan analysis. */
export interface IPlanWarning {
  severity: 'warning' | 'info';
  message: string;
  table?: string;
  suggestion?: string;
}

/** Performance summary derived from plan analysis. */
export interface IPerformanceSummary {
  scanCount: number;
  indexCount: number;
  tempBTreeCount: number;
  totalNodes: number;
}

/** Result of parsing an explain plan. */
export interface IParsedPlan {
  nodes: IPlanNode[];
  warnings: IPlanWarning[];
  summary: IPerformanceSummary;
}

/** Client-side index suggestion based on plan + SQL analysis. */
export interface IIndexSuggestion {
  sql: string;
  reason: string;
  impact: 'high' | 'medium' | 'low';
}
