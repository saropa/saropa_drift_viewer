/**
 * Re-exports the composed diagnostic code registry from codes/.
 * Kept for backward compatibility; new code may import from './codes'.
 */

export {
  DIAGNOSTIC_CODES,
  getAllDiagnosticCodes,
  getDiagnosticCode,
  getDiagnosticCodesByCategory,
  isSnakeCase,
  isSqlReservedWord,
  SQL_RESERVED_WORDS,
} from './codes';
