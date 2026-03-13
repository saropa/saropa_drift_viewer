/**
 * Composed diagnostic code registry and lookup helpers.
 */

import type { IDiagnosticCode } from '../diagnostic-types';
import { BEST_PRACTICE_CODES } from './best-practice-codes';
import { DATA_QUALITY_CODES } from './data-quality-codes';
import { NAMING_CODES, isSnakeCase, isSqlReservedWord, SQL_RESERVED_WORDS } from './naming-codes';
import { PERFORMANCE_CODES } from './performance-codes';
import { RUNTIME_CODES } from './runtime-codes';
import { SCHEMA_CODES } from './schema-codes';

/** Registry of all diagnostic codes. */
export const DIAGNOSTIC_CODES: Record<string, IDiagnosticCode> = {
  ...SCHEMA_CODES,
  ...PERFORMANCE_CODES,
  ...DATA_QUALITY_CODES,
  ...BEST_PRACTICE_CODES,
  ...NAMING_CODES,
  ...RUNTIME_CODES,
};

export { SQL_RESERVED_WORDS, isSnakeCase, isSqlReservedWord } from './naming-codes';

/** Get a diagnostic code by its identifier. */
export function getDiagnosticCode(code: string): IDiagnosticCode | undefined {
  return DIAGNOSTIC_CODES[code];
}

/** Get all diagnostic codes for a specific category. */
export function getDiagnosticCodesByCategory(
  category: string,
): IDiagnosticCode[] {
  return Object.values(DIAGNOSTIC_CODES).filter((c) => c.category === category);
}

/** Get all diagnostic code identifiers. */
export function getAllDiagnosticCodes(): string[] {
  return Object.keys(DIAGNOSTIC_CODES);
}
