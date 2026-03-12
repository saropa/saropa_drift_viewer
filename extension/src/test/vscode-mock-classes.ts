/**
 * Core mock classes for the vscode API.
 * Extracted from vscode-mock.ts for the 300-line limit.
 */

export class EventEmitter {
  private _listeners: Array<(...args: any[]) => void> = [];
  event = (listener: (...args: any[]) => void) => {
    this._listeners.push(listener);
    return { dispose: () => { /* no-op */ } };
  };
  fire(...args: any[]) {
    this._listeners.forEach((l) => l(...args));
  }
  dispose() {
    this._listeners.length = 0;
  }
}

// --- Output Channel ---

export class MockOutputChannel {
  readonly lines: string[] = [];
  constructor(public readonly name: string = 'test') {}
  appendLine(line: string): void { this.lines.push(line); }
  append(): void { /* no-op */ }
  clear(): void { /* no-op */ }
  show(): void { /* no-op */ }
  hide(): void { /* no-op */ }
  replace(): void { /* no-op */ }
  dispose(): void { /* no-op */ }
}

// --- Timeline support ---

export class TimelineItem {
  label: string;
  timestamp: number;
  id?: string;
  description?: string;
  iconPath?: any;
  command?: any;

  constructor(label: string, timestamp: number) {
    this.label = label;
    this.timestamp = timestamp;
  }
}

// --- Tree view support ---

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class ThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: ThemeColor,
  ) {}
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class MarkdownString {
  value: string;
  isTrusted?: boolean;
  constructor(value = '') {
    this.value = value;
  }
}

export class Hover {
  contents: MarkdownString | MarkdownString[];
  range?: Range;
  constructor(contents: MarkdownString | MarkdownString[], range?: Range) {
    this.contents = contents;
    this.range = range;
  }
}

// --- FileDecoration support ---

export class FileDecoration {
  badge?: string;
  tooltip?: string;
  color?: ThemeColor;
  propagate?: boolean;
  constructor(badge?: string, tooltip?: string, color?: ThemeColor) {
    this.badge = badge;
    this.tooltip = tooltip;
    this.color = color;
  }
}

// --- Terminal link support ---

export class TerminalLink {
  constructor(
    public readonly startIndex: number,
    public readonly length: number,
    public readonly tooltip?: string,
  ) {}
}

// --- CodeLens support ---

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    this.start = new Position(startLine, startCharacter);
    this.end = new Position(endLine, endCharacter);
  }
}

export class Location {
  public readonly uri: any;
  public readonly range: Range;

  constructor(uri: any, rangeOrPosition: Position | Range) {
    this.uri = uri;
    if (rangeOrPosition instanceof Range) {
      this.range = rangeOrPosition;
    } else {
      // Convert Position to zero-width Range (matches real vscode behavior)
      this.range = new Range(
        rangeOrPosition.line, rangeOrPosition.character,
        rangeOrPosition.line, rangeOrPosition.character,
      );
    }
  }
}

export const CancellationTokenNone = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => { /* no-op */ } }),
};

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

export class TreeItem {
  label?: string;
  description?: string;
  tooltip?: string | MarkdownString;
  iconPath?: ThemeIcon | { light: string; dark: string };
  collapsibleState?: TreeItemCollapsibleState;
  contextValue?: string;
  command?: any;

  constructor(
    label: string,
    collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None,
  ) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class MockTreeView {
  disposed = false;
  dispose() {
    this.disposed = true;
  }
}

/** Mock vscode.Memento for workspace/global state storage. */
export class MockMemento {
  private _data = new Map<string, any>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this._data.has(key) ? this._data.get(key) : defaultValue;
  }

  update(key: string, value: any): Thenable<void> {
    this._data.set(key, value);
    return Promise.resolve();
  }

  keys(): readonly string[] {
    return Array.from(this._data.keys());
  }

  clear(): void {
    this._data.clear();
  }
}
