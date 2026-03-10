import type { IDiagramForeignKey } from '../api-types';

/** A column ready for documentation rendering. */
export interface IDocColumn {
  name: string;
  type: string;
  pk: boolean;
  nullable: boolean;
  fk?: { toTable: string; toColumn: string };
  description: string;
}

/** A table ready for documentation rendering. */
export interface IDocTable {
  name: string;
  description: string;
  columns: IDocColumn[];
  referencedBy: IDiagramForeignKey[];
  rowCount: number;
}

/** Top-level data model passed to renderers. */
export interface ISchemaDocsData {
  generatedAt: string;
  tables: IDocTable[];
  totalRows: number;
  totalFks: number;
  diagramSvg?: string;
}
