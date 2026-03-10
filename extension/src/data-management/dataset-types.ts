/** Foreign key with explicit source table (extends ForeignKey with fromTable). */
export interface IFkContext {
  fromTable: string;
  toTable: string;
}

export interface IDriftDataset {
  $schema: 'drift-dataset/v1';
  name: string;
  description?: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export interface IDriftDatasetsConfig {
  groups: Record<string, string[]>;
  datasets: Record<string, string>; // name → relative file path
}

export interface IValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface IDatasetImportResult {
  tables: { table: string; inserted: number }[];
  totalInserted: number;
}

export interface IResetResult {
  tables: { name: string; deletedRows: number }[];
  totalDeleted: number;
}
