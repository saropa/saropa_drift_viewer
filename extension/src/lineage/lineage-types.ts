/** A single node in the lineage tree. */
export interface ILineageNode {
  table: string;
  pkColumn: string;
  pkValue: unknown;
  /** First 5 columns of the row for quick preview. */
  preview: Record<string, unknown>;
  direction: 'upstream' | 'downstream' | 'root';
  /** The FK column that connects this node to its parent. */
  fkColumn?: string;
  children: ILineageNode[];
}

/** Result of a lineage trace operation. */
export interface ILineageResult {
  root: ILineageNode;
  upstreamCount: number;
  downstreamCount: number;
}

/** A single FK reference between two tables. */
export interface IFkRef {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

/** Bidirectional FK map for quick lookup. */
export interface IFkMap {
  /** FKs that point outward from a table (this table → parent). */
  outgoing: Map<string, IFkRef[]>;
  /** FKs that point inward to a table (child → this table). */
  incoming: Map<string, IFkRef[]>;
  /** Primary key column name per table (from schema metadata). */
  pkColumns: Map<string, string>;
}
