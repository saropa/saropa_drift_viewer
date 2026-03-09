import * as vscode from 'vscode';

export interface CellChange {
  kind: 'cell';
  id: string;
  table: string;
  pkColumn: string;
  pkValue: unknown;
  column: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

export interface RowInsert {
  kind: 'insert';
  id: string;
  table: string;
  values: Record<string, unknown>;
  timestamp: number;
}

export interface RowDelete {
  kind: 'delete';
  id: string;
  table: string;
  pkColumn: string;
  pkValue: unknown;
  timestamp: number;
}

export type PendingChange = CellChange | RowInsert | RowDelete;

let nextId = 1;
function generateId(): string {
  return `change-${nextId++}`;
}

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}

/** Describes a single change for logging. */
export function describeChange(change: PendingChange): string {
  switch (change.kind) {
    case 'cell':
      return (
        `EDIT ${change.table}.${change.column} ` +
        `(${change.pkColumn}=${formatValue(change.pkValue)}): ` +
        `${formatValue(change.oldValue)} \u2192 ${formatValue(change.newValue)}`
      );
    case 'insert': {
      const pairs = Object.entries(change.values)
        .map(([k, v]) => `${k}: ${formatValue(v)}`)
        .join(', ');
      return `INSERT ${change.table}: {${pairs}}`;
    }
    case 'delete':
      return (
        `DELETE ${change.table} ` +
        `(${change.pkColumn}=${formatValue(change.pkValue)})`
      );
  }
}

/** Group changes by table name, preserving insertion order. */
export function groupByTable(
  changes: readonly PendingChange[],
): Map<string, PendingChange[]> {
  const byTable = new Map<string, PendingChange[]>();
  for (const c of changes) {
    const list = byTable.get(c.table);
    if (list) {
      list.push(c);
    } else {
      byTable.set(c.table, [c]);
    }
  }
  return byTable;
}

export class ChangeTracker implements vscode.Disposable {
  private _changes: PendingChange[] = [];
  private _undoStack: PendingChange[][] = [];
  private _redoStack: PendingChange[][] = [];
  private _lastLogMessage = '';

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly _out: vscode.OutputChannel) {}

  private _log(msg: string): void {
    this._lastLogMessage = msg;
    this._out.appendLine(`[${timestamp()}] ${msg}`);
  }

  /** The most recent log message (for external listeners like LogCaptureBridge). */
  get lastLogMessage(): string {
    return this._lastLogMessage;
  }

  private _saveUndoState(): void {
    this._undoStack.push(this._changes.map((c) => ({ ...c })));
    this._redoStack.length = 0;
  }

  addCellChange(
    change: Omit<CellChange, 'kind' | 'id' | 'timestamp'>,
  ): void {
    this._saveUndoState();
    const existing = this._changes.find(
      (c) =>
        c.kind === 'cell' &&
        c.table === change.table &&
        c.pkValue === change.pkValue &&
        c.column === change.column,
    ) as CellChange | undefined;

    if (existing) {
      existing.newValue = change.newValue;
      existing.timestamp = Date.now();
      this._log(describeChange(existing));
    } else {
      const entry: CellChange = {
        ...change,
        kind: 'cell',
        id: generateId(),
        timestamp: Date.now(),
      };
      this._changes.push(entry);
      this._log(describeChange(entry));
    }
    this._onDidChange.fire();
  }

  addRowInsert(table: string, values: Record<string, unknown>): void {
    this._saveUndoState();
    const ins: RowInsert = {
      kind: 'insert',
      id: generateId(),
      table,
      values,
      timestamp: Date.now(),
    };
    this._changes.push(ins);
    this._log(describeChange(ins));
    this._onDidChange.fire();
  }

  addRowDelete(
    table: string,
    pkColumn: string,
    pkValue: unknown,
  ): void {
    this._saveUndoState();
    const del: RowDelete = {
      kind: 'delete',
      id: generateId(),
      table,
      pkColumn,
      pkValue,
      timestamp: Date.now(),
    };
    this._changes.push(del);
    this._log(describeChange(del));
    this._onDidChange.fire();
  }

  removeChange(id: string): void {
    const idx = this._changes.findIndex((c) => c.id === id);
    if (idx < 0) return;
    this._saveUndoState();
    const removed = this._changes.splice(idx, 1)[0];
    this._log(`REMOVE change: ${describeChange(removed)}`);
    this._onDidChange.fire();
  }

  undo(): void {
    if (this._undoStack.length === 0) return;
    const before = this._changes.length;
    this._redoStack.push(this._changes.map((c) => ({ ...c })));
    this._changes = this._undoStack.pop()!;
    this._log(`UNDO (${before} \u2192 ${this._changes.length} changes)`);
    this._onDidChange.fire();
  }

  redo(): void {
    if (this._redoStack.length === 0) return;
    const before = this._changes.length;
    this._undoStack.push(this._changes.map((c) => ({ ...c })));
    this._changes = this._redoStack.pop()!;
    this._log(`REDO (${before} \u2192 ${this._changes.length} changes)`);
    this._onDidChange.fire();
  }

  discardAll(): void {
    if (this._changes.length === 0) return;
    this._saveUndoState();
    const count = this._changes.length;
    this._changes = [];
    this._log(`DISCARD ALL (${count} changes cleared)`);
    this._onDidChange.fire();
  }

  logGenerateSql(): void {
    this._log(`GENERATE SQL (${this._changes.length} changes)`);
  }

  get changes(): readonly PendingChange[] {
    return this._changes;
  }

  get changeCount(): number {
    return this._changes.length;
  }

  get canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
