/** Assertion types the regression test generator can produce. */
export type AssertionType =
  | 'rowCount'
  | 'fkIntegrity'
  | 'notNull'
  | 'unique'
  | 'valueRange';

/** A single inferred assertion about the database state. */
export interface IAssertion {
  type: AssertionType;
  table: string;
  column?: string;
  /** SQL query that verifies this assertion. */
  sql: string;
  /** Human-readable expectation: "equals 1250" or "is empty". */
  expectation: string;
  /** Why this assertion was inferred. */
  reason: string;
  /** How likely this is a real invariant. */
  confidence: 'high' | 'medium';
}
