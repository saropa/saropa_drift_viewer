/** Shared types for the schema search + cross-reference feature. */

export type SchemaSearchScope = 'all' | 'tables' | 'columns';

export interface ISchemaMatch {
  type: 'table' | 'column';
  table: string;
  column?: string;
  columnType?: string;
  isPk?: boolean;
  /** Row count for table-type matches. */
  rowCount?: number;
  /** Column count for table-type matches. */
  columnCount?: number;
  /** Other tables containing a column with the same name. */
  alsoIn?: string[];
}

export interface ICrossReference {
  columnName: string;
  tables: string[];
  missingFks: Array<{ from: string; to: string }>;
}

export interface ISchemaSearchResult {
  query: string;
  matches: ISchemaMatch[];
  crossReferences: ICrossReference[];
}

/** Messages sent from the webview to the extension host. */
export type SchemaSearchMessage =
  | { command: 'search'; query: string; scope: SchemaSearchScope; typeFilter?: string }
  | { command: 'navigate'; table: string };
