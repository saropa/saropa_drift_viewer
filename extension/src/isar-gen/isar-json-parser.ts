/**
 * Parser for Isar JSON schema exports (v3.x/v4.x CollectionSchema format).
 * Converts JSON schema to the same IIsarCollection/IIsarEmbedded types
 * used by the Dart source parser.
 */

import {
  IIsarCollection,
  IIsarField,
  IIsarIndex,
  IIsarLink,
  IIsarParseResult,
} from './isar-gen-types';

/** Isar property type enum values (from Isar's CollectionSchema). */
const ISAR_TYPE_MAP: Record<number, string> = {
  0: 'bool',
  1: 'byte',
  2: 'int',
  3: 'float',
  4: 'int',     // long
  5: 'double',
  6: 'DateTime',
  7: 'String',
  8: 'Uint8List',  // bytes
  9: 'List<bool>',
  10: 'List<int>',    // byteList
  11: 'List<int>',    // intList
  12: 'List<double>', // floatList
  13: 'List<int>',    // longList
  14: 'List<double>', // doubleList
  15: 'List<DateTime>',
  16: 'List<String>',
};

/** JSON schema shape for a single collection. */
interface IJsonCollection {
  name: string;
  properties?: Array<{
    name: string;
    type: number;
  }>;
  indexes?: Array<{
    name?: string;
    unique?: boolean;
    properties: Array<{
      name: string;
      caseSensitive?: boolean;
    }>;
  }>;
  links?: Array<{
    name: string;
    target: string;
  }>;
}

/** Map a JSON property to an IIsarField. */
function mapProperty(
  prop: { name: string; type: number },
  line: number,
): IIsarField {
  const dartType = ISAR_TYPE_MAP[prop.type] ?? 'String';
  return {
    name: prop.name,
    dartType,
    isNullable: false,
    isId: prop.name === 'id',
    isIgnored: false,
    line,
  };
}

/** Map JSON indexes to IIsarIndex. */
function mapIndexes(
  indexes: IJsonCollection['indexes'],
): IIsarIndex[] {
  if (!indexes) return [];
  return indexes.map((idx) => ({
    properties: idx.properties.map((p) => p.name),
    unique: idx.unique ?? false,
    caseSensitive: idx.properties[0]?.caseSensitive ?? true,
    indexType: 'value' as const,
  }));
}

/** Map JSON links to IIsarLink. */
function mapLinks(links: IJsonCollection['links']): IIsarLink[] {
  if (!links) return [];
  return links.map((lnk, i) => ({
    propertyName: lnk.name,
    targetCollection: lnk.target,
    isMulti: false, // JSON schema doesn't distinguish; default to single
    isBacklink: false,
    line: i,
  }));
}

/**
 * Parse Isar JSON schema (single collection or array).
 * Accepts either a JSON string or the already-parsed object.
 */
export function parseIsarJsonSchema(
  input: string,
): IIsarParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('Invalid JSON: could not parse Isar schema');
  }

  const arr: IJsonCollection[] = Array.isArray(parsed)
    ? parsed
    : [parsed as IJsonCollection];

  const collections: IIsarCollection[] = [];
  for (const raw of arr) {
    if (!raw.name) {
      throw new Error('Missing "name" field in Isar JSON schema');
    }

    const fields: IIsarField[] = (raw.properties ?? []).map(
      (p, i) => mapProperty(p, i),
    );

    // Ensure an Id field exists
    if (!fields.some((f) => f.isId)) {
      fields.unshift({
        name: 'id',
        dartType: 'Id',
        isNullable: false,
        isId: true,
        isIgnored: false,
        line: 0,
      });
    }

    collections.push({
      className: raw.name,
      fields,
      links: mapLinks(raw.links),
      indexes: mapIndexes(raw.indexes),
      fileUri: '<json>',
      line: 0,
    });
  }

  // JSON schema doesn't include embedded objects
  return { collections, embeddeds: [] };
}
