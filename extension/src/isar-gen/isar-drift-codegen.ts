/**
 * Generates Drift table class Dart source from mapped Isar definitions.
 */

import { snakeToCamel, snakeToPascal } from '../dart-names';
import {
  IDriftTableDef,
  IIsarGenConfig,
  IIsarMappingResult,
} from './isar-gen-types';

/** Indent helper. */
function indent(n: number): string {
  return '  '.repeat(n);
}

/** Generate a single Drift column getter line. */
function genColumn(
  col: IDriftTableDef['columns'][0],
  config: IIsarGenConfig,
): string[] {
  const lines: string[] = [];
  if (config.includeComments && col.comment) {
    lines.push(`${indent(1)}/// ${col.comment}`);
  }
  const camel = snakeToCamel(col.getterName);
  lines.push(
    `${indent(1)}${col.columnType} get ${camel} => ${col.builderChain};`,
  );
  return lines;
}

/** Generate the primaryKey override if needed. */
function genPrimaryKey(table: IDriftTableDef): string[] {
  if (table.primaryKeyColumns.length === 0) return [];

  // If the only PK is 'id' with autoIncrement, Drift handles it implicitly
  if (
    table.primaryKeyColumns.length === 1
    && table.primaryKeyColumns[0] === 'id'
    && !table.isJunctionTable
  ) {
    return [];
  }

  const cols = table.primaryKeyColumns
    .map((c) => snakeToCamel(c))
    .join(', ');
  return [
    '',
    `${indent(1)}@override`,
    `${indent(1)}Set<Column> get primaryKey => {${cols}};`,
  ];
}

/** Generate uniqueKeys override for unique indexes. */
function genUniqueKeys(table: IDriftTableDef): string[] {
  const uniques = table.indexes.filter((i) => i.unique);
  if (uniques.length === 0) return [];

  const sets = uniques
    .map((idx) => {
      const cols = idx.columns.map((c) => snakeToCamel(c)).join(', ');
      return `{${cols}}`;
    })
    .join(', ');

  return [
    '',
    `${indent(1)}@override`,
    `${indent(1)}List<Set<Column>> get uniqueKeys => [${sets}];`,
  ];
}

/** Generate a complete Drift table class. */
function genTable(
  table: IDriftTableDef,
  config: IIsarGenConfig,
): string[] {
  const className = table.isJunctionTable
    ? snakeToPascal(table.className)
    : `${table.className}Table`;

  const lines: string[] = [];
  if (config.includeComments && table.sourceCollection) {
    lines.push(`/// Generated from Isar @collection ${table.sourceCollection}`);
  }
  lines.push(`class ${className} extends Table {`);

  // Columns
  for (const col of table.columns) {
    lines.push(...genColumn(col, config));
  }

  // Primary key
  lines.push(...genPrimaryKey(table));

  // Unique keys
  lines.push(...genUniqueKeys(table));

  // Table name override for junction tables
  if (table.tableName) {
    lines.push('');
    lines.push(`${indent(1)}@override`);
    lines.push(
      `${indent(1)}String get tableName => '${table.tableName}';`,
    );
  }

  lines.push('}');
  return lines;
}

/**
 * Generate complete Dart file content from an Isar mapping result.
 */
export function generateDriftSource(
  result: IIsarMappingResult,
  config: IIsarGenConfig,
): string {
  const lines: string[] = [];

  // Header
  lines.push(
    '// Generated from Isar schema — use as a starting point for Drift tables.',
  );
  lines.push(
    '// Review and adjust types, constraints, and relationships as needed.',
  );
  lines.push('');
  lines.push("import 'package:drift/drift.dart';");
  lines.push('');

  // Main tables
  for (const table of result.tables) {
    lines.push(...genTable(table, config));
    lines.push('');
  }

  // Junction tables
  for (const jt of result.junctionTables) {
    lines.push(...genTable(jt, config));
    lines.push('');
  }

  // Warnings as comments
  if (result.warnings.length > 0) {
    lines.push('// --- Mapping warnings ---');
    for (const w of result.warnings) {
      lines.push(`// WARNING: ${w}`);
    }
    lines.push('');
  }

  if (result.skippedBacklinks.length > 0) {
    lines.push('// --- Skipped backlinks (virtual in Isar) ---');
    for (const bl of result.skippedBacklinks) {
      lines.push(`// SKIPPED: ${bl}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
