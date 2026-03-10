/** Column-level schema snapshot. */
export interface IColumnSnapshot {
  name: string;
  type: string;
  pk: boolean;
}

/** Foreign-key relationship snapshot. */
export interface IFkSnapshot {
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

/** Single table within a schema snapshot. */
export interface ITableSnapshot {
  name: string;
  columns: IColumnSnapshot[];
  fks: IFkSnapshot[];
}

/** Full schema snapshot captured at a specific generation. */
export interface ISchemaSnapshot {
  generation: number;
  timestamp: string;
  tables: ITableSnapshot[];
}

/** Category of schema change between two snapshots. */
export type SchemaChangeType =
  | 'table_added'
  | 'table_dropped'
  | 'column_added'
  | 'column_removed'
  | 'column_type_changed'
  | 'fk_added'
  | 'fk_removed';

/** A single schema change between two snapshots. */
export interface ISchemaChange {
  type: SchemaChangeType;
  table: string;
  detail: string;
}
