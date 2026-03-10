/** Enum storage strategies supported by Isar. */
export type IsarEnumStrategy = 'ordinal' | 'ordinal32' | 'name' | 'value';

/** An Isar field parsed from Dart source or JSON schema. */
export interface IIsarField {
  name: string;
  dartType: string;
  isNullable: boolean;
  isId: boolean;
  isIgnored: boolean;
  enumerated?: IsarEnumStrategy;
  customName?: string;
  line: number;
}

/** An Isar link (IsarLink or IsarLinks) parsed from source. */
export interface IIsarLink {
  propertyName: string;
  targetCollection: string;
  isMulti: boolean;
  isBacklink: boolean;
  backlinkTo?: string;
  line: number;
}

/** An Isar index parsed from source. */
export interface IIsarIndex {
  properties: string[];
  unique: boolean;
  caseSensitive: boolean;
  indexType: 'value' | 'hash' | 'hashElements';
}

/** A parsed @embedded class. */
export interface IIsarEmbedded {
  className: string;
  customName?: string;
  fields: IIsarField[];
  fileUri: string;
  line: number;
}

/** A parsed @collection class. */
export interface IIsarCollection {
  className: string;
  customName?: string;
  fields: IIsarField[];
  links: IIsarLink[];
  indexes: IIsarIndex[];
  fileUri: string;
  line: number;
}

/** Result of parsing Isar source (Dart or JSON). */
export interface IIsarParseResult {
  collections: IIsarCollection[];
  embeddeds: IIsarEmbedded[];
}

/** User-configurable mapping options. */
export interface IIsarGenConfig {
  enumStrategy: 'auto' | 'integer' | 'text';
  embeddedStrategy: 'json' | 'flatten';
  listStrategy: Record<string, 'json' | 'table'>;
  junctionTableNames: Record<string, string>;
  includeIndexes: boolean;
  includeComments: boolean;
}

/** A generated Drift column definition. */
export interface IDriftColumnDef {
  getterName: string;
  columnType: string;
  builderChain: string;
  comment?: string;
}

/** A generated Drift index definition. */
export interface IDriftIndexDef {
  columns: string[];
  unique: boolean;
}

/** A generated Drift table definition. */
export interface IDriftTableDef {
  className: string;
  tableName?: string;
  columns: IDriftColumnDef[];
  primaryKeyColumns: string[];
  indexes: IDriftIndexDef[];
  isJunctionTable: boolean;
  sourceCollection?: string;
}

/** Full result of the mapping process. */
export interface IIsarMappingResult {
  tables: IDriftTableDef[];
  junctionTables: IDriftTableDef[];
  warnings: string[];
  skippedBacklinks: string[];
}

// ---- Webview messages ----

export interface IIsarGenUpdateConfigMessage {
  command: 'updateConfig';
  config: Partial<IIsarGenConfig>;
}

export interface IIsarGenGenerateMessage {
  command: 'generate';
}

export interface IIsarGenSaveMessage {
  command: 'save';
}

export interface IIsarGenCopyMessage {
  command: 'copy';
}

export type IsarGenWebviewMessage =
  | IIsarGenUpdateConfigMessage
  | IIsarGenGenerateMessage
  | IIsarGenSaveMessage
  | IIsarGenCopyMessage;

/** Default config for new sessions. */
export function defaultIsarGenConfig(): IIsarGenConfig {
  return {
    enumStrategy: 'auto',
    embeddedStrategy: 'json',
    listStrategy: {},
    junctionTableNames: {},
    includeIndexes: true,
    includeComments: true,
  };
}
