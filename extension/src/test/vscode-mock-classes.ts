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

export * from './vscode-mock-diagnostics';

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

/** Mock vscode.Uri for file paths. */
export class Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
  readonly fsPath: string;

  private constructor(scheme: string, authority: string, path: string, query: string, fragment: string) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
    this.fsPath = path;
  }

  static file(path: string): Uri {
    return new Uri('file', '', path, '', '');
  }

  static parse(value: string): Uri {
    return new Uri('file', '', value, '', '');
  }

  toString(): string {
    return `${this.scheme}://${this.path}`;
  }

  with(_change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(
      _change.scheme ?? this.scheme,
      _change.authority ?? this.authority,
      _change.path ?? this.path,
      _change.query ?? this.query,
      _change.fragment ?? this.fragment,
    );
  }
}
