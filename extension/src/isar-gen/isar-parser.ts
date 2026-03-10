/**
 * Regex-based parser for Isar collection definitions from Dart source.
 * Extracts @collection classes, @embedded classes, fields, links, and indexes.
 */

import { extractClassBody } from '../schema-diff/dart-parser';
import {
  IIsarField,
  IIsarIndex,
  IIsarLink,
  IIsarParseResult,
  IsarEnumStrategy,
} from './isar-gen-types';

// ---- Regex patterns ----

const COLLECTION_RE =
  /(@(?:collection|Collection\(\)))\s*\n\s*class\s+(\w+)/g;

const EMBEDDED_RE =
  /(@(?:embedded|Embedded\(\)))\s*\n\s*class\s+(\w+)/g;

/** Count newlines before `index` to get a 0-based line number. */
function lineAt(source: string, index: number): number {
  let count = 0;
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') count++;
  }
  return count;
}

/** Find the opening brace of the class starting at `classKeywordIdx`. */
function findClassBrace(
  source: string,
  classKeywordIdx: number,
): number {
  const sub = source.substring(classKeywordIdx);
  const m = /\{/.exec(sub);
  return m ? classKeywordIdx + m.index : -1;
}

/**
 * Collect all annotation lines immediately above a field or class member.
 * Scans backwards from the line before the given position.
 */
function collectAnnotations(
  lines: string[],
  fieldLineIdx: number,
): string[] {
  const result: string[] = [];
  for (let i = fieldLineIdx - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('@') || trimmed.startsWith('//')) {
      result.unshift(trimmed);
    } else {
      break;
    }
  }
  return result;
}

/** Parse the @Name('...') annotation value. */
function parseNameAnnotation(annotations: string[]): string | undefined {
  for (const a of annotations) {
    const m = /@Name\(\s*['"](\w+)['"]\s*\)/.exec(a);
    if (m) return m[1];
  }
  return undefined;
}

/** Check if @ignore is present. */
function isIgnored(annotations: string[]): boolean {
  return annotations.some((a) => a.startsWith('@ignore'));
}

/** Check if @Backlink is present and extract the target property. */
function parseBacklink(
  annotations: string[],
): { isBacklink: boolean; backlinkTo?: string } {
  for (const a of annotations) {
    const m = /@Backlink\(\s*to:\s*['"](\w+)['"]\s*\)/.exec(a);
    if (m) return { isBacklink: true, backlinkTo: m[1] };
  }
  return { isBacklink: false };
}

/** Parse the @enumerated or @Enumerated(EnumType.xxx) annotation. */
function parseEnumAnnotation(
  annotations: string[],
): IsarEnumStrategy | undefined {
  for (const a of annotations) {
    if (a === '@enumerated') return 'ordinal';
    const m = /@Enumerated\(\s*EnumType\.(\w+)\s*\)/.exec(a);
    if (m) return m[1] as IsarEnumStrategy;
  }
  return undefined;
}

/** Parse @Index annotations into IIsarIndex objects. */
function parseIndexAnnotations(
  annotations: string[],
  primaryField: string,
): IIsarIndex[] {
  const indexes: IIsarIndex[] = [];
  for (const a of annotations) {
    if (!a.startsWith('@Index')) continue;
    const unique = /unique\s*:\s*true/.test(a);
    const cs = !/caseSensitive\s*:\s*false/.test(a);
    let indexType: 'value' | 'hash' | 'hashElements' = 'value';
    if (/IndexType\.hash\b/.test(a)) indexType = 'hash';
    if (/IndexType\.hashElements/.test(a)) indexType = 'hashElements';

    const compositeProps: string[] = [primaryField];
    const compositeRe = /CompositeIndex\(\s*['"](\w+)['"]/g;
    let cm: RegExpExecArray | null;
    while ((cm = compositeRe.exec(a)) !== null) {
      compositeProps.push(cm[1]);
    }

    indexes.push({
      properties: compositeProps,
      unique,
      caseSensitive: cs,
      indexType,
    });
  }
  return indexes;
}

/** Parse a field declaration line and return an IIsarField. */
function parseFieldLine(
  line: string,
  lineNumber: number,
  annotations: string[],
): IIsarField | null {
  let name: string, dartType: string, nullable: boolean, isId = false;

  const idM = /(?:late\s+)?Id(\??)\s+(\w+)\s*(?:=[^;]*)?\s*;/.exec(line);
  const lateM = !idM ? /late\s+([\w<>]+)(\??)\s+(\w+)\s*;/.exec(line) : null;
  const nullM = !idM && !lateM
    ? /^([\w<>]+)\?\s+(\w+)\s*;/.exec(line.trim()) : null;

  if (idM) {
    name = idM[2]; dartType = 'Id'; nullable = idM[1] === '?'; isId = true;
  } else if (lateM) {
    name = lateM[3]; dartType = lateM[1]; nullable = lateM[2] === '?';
  } else if (nullM) {
    name = nullM[2]; dartType = nullM[1]; nullable = true;
  } else {
    return null;
  }

  return {
    name, dartType, isNullable: nullable, isId,
    isIgnored: isIgnored(annotations),
    customName: parseNameAnnotation(annotations),
    enumerated: isId ? undefined : parseEnumAnnotation(annotations),
    line: lineNumber,
  };
}

/** Parse an IsarLink or IsarLinks declaration. */
function parseLinkLine(
  line: string,
  lineNumber: number,
  annotations: string[],
): IIsarLink | null {
  const multiM = /final\s+(\w+)\s*=\s*IsarLinks<(\w+)>\(\s*\)\s*;/.exec(line);
  const singleM = !multiM
    ? /final\s+(\w+)\s*=\s*IsarLink<(\w+)>\(\s*\)\s*;/.exec(line) : null;
  const m = multiM ?? singleM;
  if (!m) return null;

  const bl = parseBacklink(annotations);
  return {
    propertyName: m[1],
    targetCollection: m[2],
    isMulti: !!multiM,
    isBacklink: bl.isBacklink,
    backlinkTo: bl.backlinkTo,
    line: lineNumber,
  };
}

/**
 * Parse fields and links from a class body.
 * Returns separate lists to keep concerns clear.
 */
function parseClassMembers(
  body: string,
  bodyStartLine: number,
): {
  fields: IIsarField[];
  links: IIsarLink[];
  indexes: IIsarIndex[];
} {
  const lines = body.split('\n');
  const fields: IIsarField[] = [];
  const links: IIsarLink[] = [];
  const allIndexes: IIsarIndex[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@')) {
      continue;
    }

    const annotations = collectAnnotations(lines, i);
    const absLine = bodyStartLine + i;

    // Try link first (more specific pattern)
    const link = parseLinkLine(trimmed, absLine, annotations);
    if (link) {
      links.push(link);
      continue;
    }

    // Try field
    const field = parseFieldLine(trimmed, absLine, annotations);
    if (field) {
      fields.push(field);
      const idxes = parseIndexAnnotations(annotations, field.name);
      allIndexes.push(...idxes);
    }
  }

  return { fields, links, indexes: allIndexes };
}

/** Parse @Name annotation on a class (appears above the class keyword). */
function parseClassNameAnnotation(
  source: string,
  annotationIdx: number,
): string | undefined {
  // Look backwards from the annotation to find @Name
  const before = source.substring(
    Math.max(0, annotationIdx - 200),
    annotationIdx,
  );
  const lines = before.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    const m = /@Name\(\s*['"](\w+)['"]\s*\)/.exec(trimmed);
    if (m) return m[1];
    if (!trimmed.startsWith('@') && !trimmed.startsWith('//') && trimmed) {
      break;
    }
  }
  return undefined;
}

/** Scan source for classes matching `re` and parse their members. */
function scanClasses(
  source: string,
  re: RegExp,
): Array<{ className: string; customName?: string; members: ReturnType<typeof parseClassMembers>; line: number }> {
  const results: Array<{ className: string; customName?: string; members: ReturnType<typeof parseClassMembers>; line: number }> = [];
  const freshRe = new RegExp(re.source, re.flags);
  let match: RegExpExecArray | null;
  while ((match = freshRe.exec(source)) !== null) {
    const braceIdx = findClassBrace(source, match.index);
    if (braceIdx === -1) continue;
    const body = extractClassBody(source, braceIdx);
    results.push({
      className: match[2],
      customName: parseClassNameAnnotation(source, match.index),
      members: parseClassMembers(body, lineAt(source, braceIdx) + 1),
      line: lineAt(source, match.index),
    });
  }
  return results;
}

/** Parse all Isar @collection and @embedded classes from Dart source. */
export function parseIsarCollections(
  source: string,
  fileUri: string,
): IIsarParseResult {
  const collections = scanClasses(source, COLLECTION_RE).map((c) => ({
    className: c.className, customName: c.customName,
    fields: c.members.fields, links: c.members.links,
    indexes: c.members.indexes, fileUri, line: c.line,
  }));
  const embeddeds = scanClasses(source, EMBEDDED_RE).map((c) => ({
    className: c.className, customName: c.customName,
    fields: c.members.fields, fileUri, line: c.line,
  }));
  return { collections, embeddeds };
}
