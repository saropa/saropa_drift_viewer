/**
 * Diagnostic and code action mock classes for the vscode API.
 * Extracted from vscode-mock-classes.ts for the 300-line limit.
 */

import { Location, Range } from './vscode-mock-classes';

// --- Diagnostics support ---

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;
  source?: string;
  code?: string | number;
  relatedInformation?: DiagnosticRelatedInformation[];

  constructor(range: Range, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

export class DiagnosticRelatedInformation {
  location: Location;
  message: string;
  constructor(location: Location, message: string) {
    this.location = location;
    this.message = message;
  }
}

export class MockDiagnosticCollection {
  readonly name: string;
  private _entries = new Map<string, Diagnostic[]>();
  clearedCount = 0;
  disposed = false;

  constructor(name: string) {
    this.name = name;
  }

  set(uri: any, diagnostics: Diagnostic[]): void {
    this._entries.set(uri.toString(), diagnostics);
  }

  clear(): void {
    this._entries.clear();
    this.clearedCount++;
  }

  get(uri: any): Diagnostic[] | undefined {
    return this._entries.get(uri.toString());
  }

  /** Test helper: return all entries as a Map. */
  entries(): Map<string, Diagnostic[]> {
    return new Map(this._entries);
  }

  /** Test helper: return all diagnostics. */
  get diagnostics(): Map<string, Diagnostic[]> {
    return this._entries;
  }

  dispose(): void {
    this._entries.clear();
    this.disposed = true;
  }
}

// --- Code Action support ---

export const CodeActionKind = {
  QuickFix: 'quickfix' as const,
  Refactor: 'refactor' as const,
};

export class CodeAction {
  title: string;
  kind?: string;
  command?: { command: string; title: string; arguments?: any[] };
  diagnostics?: Diagnostic[];

  constructor(title: string, kind?: string) {
    this.title = title;
    this.kind = kind;
  }
}

export class CodeLens {
  range: Range;
  command?: { title: string; command: string; arguments?: any[] };
  constructor(range: Range, command?: { title: string; command: string; arguments?: any[] }) {
    this.range = range;
    this.command = command;
  }
}
