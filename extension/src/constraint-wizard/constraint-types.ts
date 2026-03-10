/** Supported constraint kinds for the wizard. */
export type ConstraintKind = 'unique' | 'check' | 'not_null';

/** A draft constraint being designed in the wizard. */
export interface IConstraintDraft {
  id: string;
  kind: ConstraintKind;
  table: string;
  columns?: string[];     // UNIQUE
  expression?: string;    // CHECK
  column?: string;        // NOT NULL
}

/** A single row that violates a proposed constraint. */
export interface IViolation {
  rowPk: unknown;
  values: Record<string, unknown>;
}

/** Result of testing a constraint against live data. */
export interface IConstraintTestResult {
  constraintId: string;
  valid: boolean;
  violationCount: number;
  violations: IViolation[];
}

// ---- Webview → Extension messages ----

export interface IAddConstraintMessage {
  command: 'addConstraint';
  kind: ConstraintKind;
}

export interface IRemoveConstraintMessage {
  command: 'removeConstraint';
  id: string;
}

export interface IUpdateConstraintMessage {
  command: 'updateConstraint';
  index: number;
  columns?: string[];
  expression?: string;
  column?: string;
}

export interface ITestConstraintMessage {
  command: 'testConstraint';
  id: string;
}

export interface ITestAllMessage {
  command: 'testAll';
}

export interface IGenerateMessage {
  command: 'generateDart' | 'generateSql';
}

export type ConstraintWizardMessage =
  | IAddConstraintMessage
  | IRemoveConstraintMessage
  | IUpdateConstraintMessage
  | ITestConstraintMessage
  | ITestAllMessage
  | IGenerateMessage;
