/**
 * Maps parsed Isar collections to Drift table definitions.
 * Handles type mapping, link resolution, and embedded object strategies.
 */

import { TableNameMapper } from '../codelens/table-name-mapper';
import {
  IDriftColumnDef,
  IDriftIndexDef,
  IDriftTableDef,
  IIsarCollection,
  IIsarEmbedded,
  IIsarField,
  IIsarGenConfig,
  IIsarMappingResult,
} from './isar-gen-types';

/** Map of Isar/Dart primitive types to Drift column info. */
const PRIMITIVE_MAP: Record<string, { col: string; builder: string }> = {
  'String': { col: 'TextColumn', builder: 'text()' },
  'int': { col: 'IntColumn', builder: 'integer()' },
  'double': { col: 'RealColumn', builder: 'real()' },
  'bool': { col: 'BoolColumn', builder: 'boolean()' },
  'DateTime': { col: 'DateTimeColumn', builder: 'dateTime()' },
  'Uint8List': { col: 'BlobColumn', builder: 'blob()' },
  'byte': { col: 'IntColumn', builder: 'integer()' },
  'short': { col: 'IntColumn', builder: 'integer()' },
  'float': { col: 'RealColumn', builder: 'real()' },
};

/** Convert PascalCase class name to snake_case table name. */
function toSnake(name: string): string {
  return TableNameMapper.dartClassToSnakeCase(name);
}

/** Map a single Isar field to a Drift column definition. */
function mapField(
  field: IIsarField,
  embeddedNames: Set<string>,
  config: IIsarGenConfig,
  warnings: string[],
): IDriftColumnDef | null {
  if (field.isIgnored) return null;

  // Id field → autoIncrement primary key
  if (field.isId) {
    return {
      getterName: field.name,
      columnType: 'IntColumn',
      builderChain: 'integer().autoIncrement()',
    };
  }

  // Enum field
  if (field.enumerated) {
    return mapEnumField(field, config);
  }

  // Embedded object type (JSON mode; flatten is handled by caller)
  if (embeddedNames.has(field.dartType)) {
    return mapEmbeddedField(field);
  }

  // List types → JSON text
  const listMatch = /^List<(\w+)>$/.exec(field.dartType);
  if (listMatch) {
    return mapListField(field, listMatch[1], warnings);
  }

  // Primitive types
  const prim = PRIMITIVE_MAP[field.dartType];
  if (prim) {
    const nullable = field.isNullable ? '.nullable()' : '';
    return {
      getterName: field.customName ?? field.name,
      columnType: prim.col,
      builderChain: prim.builder.replace('()', `${nullable}()`),
    };
  }

  // Unknown type — treat as JSON text with warning
  warnings.push(
    `Unknown type '${field.dartType}' for '${field.name}' → TextColumn (JSON)`,
  );
  const nullable = field.isNullable ? '.nullable()' : '';
  return {
    getterName: field.customName ?? field.name,
    columnType: 'TextColumn',
    builderChain: `text${nullable}()`,
    comment: `JSON-serialized from Isar ${field.dartType}`,
  };
}

/** Map an enum field based on config strategy. */
function mapEnumField(
  field: IIsarField,
  config: IIsarGenConfig,
): IDriftColumnDef {
  const useText = config.enumStrategy === 'text'
    || (config.enumStrategy === 'auto' && field.enumerated === 'name');
  const nullable = field.isNullable ? '.nullable()' : '';
  const [col, builder, label] = useText
    ? ['TextColumn', `text${nullable}()`, 'name'] as const
    : ['IntColumn', `integer${nullable}()`, 'ordinal'] as const;
  return {
    getterName: field.customName ?? field.name,
    columnType: col, builderChain: builder,
    comment: `Enum ${field.dartType} stored as ${label}`,
  };
}

/** Map an embedded object field as JSON text. Flatten is handled by the caller. */
function mapEmbeddedField(field: IIsarField): IDriftColumnDef {
  const nullable = field.isNullable ? '.nullable()' : '';
  return {
    getterName: field.customName ?? field.name,
    columnType: 'TextColumn',
    builderChain: `text${nullable}()`,
    comment: `JSON-serialized ${field.dartType}`,
  };
}

/** Map a List<T> field to JSON text column. */
function mapListField(
  field: IIsarField,
  innerType: string,
  warnings: string[],
): IDriftColumnDef {
  const nullable = field.isNullable ? '.nullable()' : '';
  warnings.push(
    `List<${innerType}> on '${field.name}' serialized as JSON text`,
  );
  return {
    getterName: field.customName ?? field.name,
    columnType: 'TextColumn',
    builderChain: `text${nullable}()`,
    comment: `JSON-serialized from Isar ${field.dartType}`,
  };
}

/** Build flattened columns for an embedded field. */
function flattenEmbedded(
  field: IIsarField,
  embedded: IIsarEmbedded,
): IDriftColumnDef[] {
  const prefix = field.customName ?? field.name;
  return embedded.fields
    .filter((ef) => !ef.isIgnored)
    .map((ef) => {
      const prim = PRIMITIVE_MAP[ef.dartType];
      const nullable = field.isNullable || ef.isNullable
        ? '.nullable()'
        : '';
      const col = prim?.col ?? 'TextColumn';
      const base = prim?.builder ?? 'text()';
      return {
        getterName: `${prefix}_${ef.name}`,
        columnType: col,
        builderChain: base.replace('()', `${nullable}()`),
        comment: `Flattened from ${embedded.className}.${ef.name}`,
      };
    });
}

/** Map Isar indexes to Drift index definitions. */
function mapIndexes(
  collection: IIsarCollection,
  fieldNameMap: Map<string, string>,
): IDriftIndexDef[] {
  return collection.indexes.map((idx) => ({
    columns: idx.properties.map((p) => fieldNameMap.get(p) ?? p),
    unique: idx.unique,
  }));
}

/**
 * Map all Isar collections + embeddeds to Drift table definitions.
 */
export function mapIsarToDrift(
  collections: IIsarCollection[],
  embeddeds: IIsarEmbedded[],
  config: IIsarGenConfig,
): IIsarMappingResult {
  const warnings: string[] = [];
  const skippedBacklinks: string[] = [];
  const tables: IDriftTableDef[] = [];
  const junctionTables: IDriftTableDef[] = [];
  const embeddedMap = new Map(embeddeds.map((e) => [e.className, e]));
  const embeddedNames = new Set(embeddeds.map((e) => e.className));

  for (const coll of collections) {
    const columns: IDriftColumnDef[] = [];
    const pkColumns: string[] = [];
    const fieldNameMap = new Map<string, string>();

    // Map fields
    for (const field of coll.fields) {
      // Flatten embedded if configured
      if (
        config.embeddedStrategy === 'flatten'
        && embeddedNames.has(field.dartType)
      ) {
        const emb = embeddedMap.get(field.dartType);
        if (emb) {
          const flat = flattenEmbedded(field, emb);
          columns.push(...flat);
          continue;
        }
      }

      const col = mapField(field, embeddedNames, config, warnings);
      if (!col) continue;
      columns.push(col);
      fieldNameMap.set(field.name, col.getterName);
      if (field.isId) pkColumns.push(col.getterName);
    }

    // Map links
    for (const link of coll.links) {
      if (link.isBacklink) {
        skippedBacklinks.push(
          `${coll.className}.${link.propertyName} (@Backlink)`,
        );
        continue;
      }

      if (link.isMulti) {
        // Many-to-many → junction table
        const srcSnake = toSnake(coll.className);
        const defaultName = `${srcSnake}_${toSnake(link.propertyName)}`;
        const jKey = `${coll.className}.${link.propertyName}`;
        const tblName = config.junctionTableNames[jKey] ?? defaultName;
        const tgtSnake = toSnake(link.targetCollection);

        junctionTables.push({
          className: tblName,
          tableName: tblName,
          columns: [
            {
              getterName: `${srcSnake}_id`,
              columnType: 'IntColumn',
              builderChain: 'integer()',
              comment: `FK → ${coll.className}.id`,
            },
            {
              getterName: `${tgtSnake}_id`,
              columnType: 'IntColumn',
              builderChain: 'integer()',
              comment: `FK → ${link.targetCollection}.id`,
            },
          ],
          primaryKeyColumns: [`${srcSnake}_id`, `${tgtSnake}_id`],
          indexes: [],
          isJunctionTable: true,
          sourceCollection: coll.className,
        });
      } else {
        // Single link → FK column
        const fkName = `${toSnake(link.propertyName)}_id`;
        columns.push({
          getterName: fkName,
          columnType: 'IntColumn',
          builderChain: 'integer().nullable()',
          comment: `FK → ${link.targetCollection}.id (from IsarLink)`,
        });
      }
    }

    // Indexes
    const indexes = config.includeIndexes
      ? mapIndexes(coll, fieldNameMap)
      : [];

    tables.push({
      className: coll.customName ?? coll.className,
      columns,
      primaryKeyColumns: pkColumns,
      indexes,
      isJunctionTable: false,
      sourceCollection: coll.className,
    });
  }

  return { tables, junctionTables, warnings, skippedBacklinks };
}
