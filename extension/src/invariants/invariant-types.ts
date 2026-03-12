/**
 * Shared types for the Data Invariant Checker feature.
 */

/** What query result constitutes a passing invariant. */
export type InvariantExpectation = 'zero_rows' | 'non_zero';

/** Severity level for invariant violations. */
export type InvariantSeverity = 'error' | 'warning' | 'info';

/**
 * A data invariant rule definition.
 * Defines a SQL query that should return specific results to pass.
 */
export interface IInvariant {
  /** Unique identifier. */
  id: string;

  /** Human-readable name for this rule. */
  name: string;

  /** Primary table this rule applies to (used for diagnostic mapping). */
  table: string;

  /** SQL query that returns violating rows. */
  sql: string;

  /** What result constitutes a pass: 'zero_rows' or 'non_zero'. */
  expectation: InvariantExpectation;

  /** How severe a violation is. */
  severity: InvariantSeverity;

  /** Whether this invariant is active. */
  enabled: boolean;

  /** Result of the last evaluation, if any. */
  lastResult?: IInvariantResult;
}

/**
 * Result of evaluating an invariant.
 */
export interface IInvariantResult {
  /** Whether the invariant passed. */
  passed: boolean;

  /** Number of violating rows (-1 if query failed). */
  violationCount: number;

  /** Sample of violating rows (capped at 20). */
  violatingRows: Record<string, unknown>[];

  /** When the check was performed (timestamp). */
  checkedAt: number;

  /** How long the check took (ms). */
  durationMs: number;

  /** Error message if the query failed. */
  error?: string;
}

/**
 * A pre-built invariant template for quick rule creation.
 */
export interface IInvariantTemplate {
  /** Template name. */
  name: string;

  /** Generated SQL query. */
  sql: string;

  /** Expected result type. */
  expectation: InvariantExpectation;

  /** Default severity for this template. */
  severity: InvariantSeverity;
}

/**
 * Message sent from webview to extension.
 */
export interface IInvariantWebviewMessage {
  command:
    | 'refresh'
    | 'runAll'
    | 'runOne'
    | 'add'
    | 'addRule'
    | 'edit'
    | 'remove'
    | 'toggle'
    | 'viewViolations'
    | 'addFromTemplate';
  id?: string;
  invariant?: Partial<IInvariant>;
  table?: string;
}

/**
 * Summary of invariant status for display.
 */
export interface IInvariantSummary {
  totalEnabled: number;
  passingCount: number;
  failingCount: number;
  lastCheckTime?: number;
}
