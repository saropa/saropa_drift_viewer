import * as vscode from 'vscode';
import { ChangeTracker, PendingChange } from './change-tracker';

/** Messages sent from the webview to the extension. */
interface CellEditMsg {
  command: 'cellEdit';
  table: string;
  pkColumn: string;
  pkValue: unknown;
  column: string;
  oldValue: unknown;
  newValue: unknown;
}
interface RowDeleteMsg {
  command: 'rowDelete';
  table: string;
  pkColumn: string;
  pkValue: unknown;
}
interface RowInsertMsg {
  command: 'rowInsert';
  table: string;
  values: Record<string, unknown>;
}
interface UndoMsg { command: 'undo'; }
interface RedoMsg { command: 'redo'; }
interface DiscardMsg { command: 'discardAll'; }

type EditMessage =
  | CellEditMsg | RowDeleteMsg | RowInsertMsg
  | UndoMsg | RedoMsg | DiscardMsg;

function isEditMessage(msg: unknown): msg is EditMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const cmd = (msg as Record<string, unknown>).command;
  return (
    cmd === 'cellEdit' || cmd === 'rowDelete' || cmd === 'rowInsert' ||
    cmd === 'undo' || cmd === 'redo' || cmd === 'discardAll'
  );
}

/**
 * Bridge between the webview (injected editing JS) and the ChangeTracker.
 * Also provides the JS script to inject into the webview HTML.
 */
export class EditingBridge implements vscode.Disposable {
  private _webview: vscode.Webview | undefined;
  private readonly _disposables: vscode.Disposable[] = [];

  constructor(private readonly _tracker: ChangeTracker) {
    this._disposables.push(
      this._tracker.onDidChange(() => this._syncToWebview()),
    );
  }

  /** Attach to a webview panel to receive messages and push state back. */
  attach(webview: vscode.Webview): void {
    this._webview = webview;
  }

  detach(): void {
    this._webview = undefined;
  }

  /** Handle a message from the webview. Returns true if handled. */
  handleMessage(msg: unknown): boolean {
    if (!isEditMessage(msg)) return false;

    switch (msg.command) {
      case 'cellEdit':
        this._tracker.addCellChange({
          table: msg.table,
          pkColumn: msg.pkColumn,
          pkValue: msg.pkValue,
          column: msg.column,
          oldValue: msg.oldValue,
          newValue: msg.newValue,
        });
        break;
      case 'rowDelete':
        this._tracker.addRowDelete(msg.table, msg.pkColumn, msg.pkValue);
        break;
      case 'rowInsert':
        this._tracker.addRowInsert(msg.table, msg.values);
        break;
      case 'undo':
        this._tracker.undo();
        break;
      case 'redo':
        this._tracker.redo();
        break;
      case 'discardAll':
        this._tracker.discardAll();
        break;
    }
    return true;
  }

  private _syncToWebview(): void {
    if (!this._webview) return;
    const payload: PendingChange[] = [...this._tracker.changes];
    this._webview.postMessage({ command: 'pendingChanges', changes: payload });
  }

  /** Returns inline JS to inject into the webview HTML for cell editing. */
  static injectedScript(): string {
    // This script is injected as a <script> block in the webview HTML.
    // It uses acquireVsCodeApi() to send edit messages back to the extension.
    return EDITING_SCRIPT;
  }

  dispose(): void {
    this._webview = undefined;
    for (const d of this._disposables) d.dispose();
    this._disposables.length = 0;
  }
}

/**
 * Inline JS injected into the Saropa Drift Advisor webview to enable cell editing.
 * Kept as a single template string so it can be injected via <script> tag.
 */
const EDITING_SCRIPT = `
(function() {
  const vscodeApi = window._vscodeApi || (window._vscodeApi = acquireVsCodeApi());
  let pendingChanges = [];
  let editingEnabled = true;

  // --- Detect table metadata ---
  // The server HTML renders tables with class "data-table".
  // Each table has a data-table-name attribute (or we read it from the heading).

  function getTableMeta(table) {
    const name = table.dataset.tableName || table.closest('[data-table-name]')?.dataset.tableName || 'unknown';
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
    // Heuristic: first column or column named "id" / "_id" is the PK
    let pkIdx = headers.findIndex(h => h === 'id' || h === '_id');
    if (pkIdx < 0) pkIdx = 0;
    return { name, headers, pkColumn: headers[pkIdx], pkIdx };
  }

  function getCellValue(td) {
    const raw = td.dataset.rawValue;
    if (raw !== undefined) return raw === 'null' ? null : raw;
    return td.textContent.trim();
  }

  // --- Cell editing ---
  document.addEventListener('dblclick', function(e) {
    if (!editingEnabled) return;
    const td = e.target.closest('td');
    if (!td) return;
    const tr = td.closest('tr');
    const table = td.closest('table');
    if (!table || !tr) return;

    const meta = getTableMeta(table);
    const colIdx = Array.from(tr.children).indexOf(td);
    if (colIdx < 0 || colIdx >= meta.headers.length) return;

    // Don't edit the PK column
    if (colIdx === meta.pkIdx) return;

    // Already editing?
    if (td.querySelector('input')) return;

    const oldValue = getCellValue(td);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldValue === null ? '' : String(oldValue);
    input.style.cssText = 'width:100%;box-sizing:border-box;font:inherit;padding:2px 4px;';

    const originalContent = td.innerHTML;
    td.innerHTML = '';
    td.appendChild(input);
    input.focus();
    input.select();

    function commit() {
      const newValue = input.value === '' ? null : input.value;
      td.innerHTML = originalContent;
      if (newValue !== oldValue) {
        td.textContent = newValue === null ? 'NULL' : String(newValue);
        td.style.backgroundColor = 'rgba(255, 200, 0, 0.25)';
        td.title = 'Pending change';
        const pkTd = tr.children[meta.pkIdx];
        vscodeApi.postMessage({
          command: 'cellEdit',
          table: meta.name,
          pkColumn: meta.pkColumn,
          pkValue: getCellValue(pkTd),
          column: meta.headers[colIdx],
          oldValue: oldValue,
          newValue: newValue,
        });
      }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { td.innerHTML = originalContent; }
    });
  });

  // --- Row delete via context menu ---
  document.addEventListener('contextmenu', function(e) {
    if (!editingEnabled) return;
    const tr = e.target.closest('tr');
    const table = e.target.closest('table');
    if (!tr || !table || tr.closest('thead')) return;

    e.preventDefault();
    const meta = getTableMeta(table);
    const pkTd = tr.children[meta.pkIdx];
    if (!pkTd) return;

    // Simple confirm via a floating button
    const btn = document.createElement('button');
    btn.textContent = 'Delete this row?';
    btn.style.cssText = 'position:fixed;z-index:9999;padding:4px 12px;' +
      'background:#d32f2f;color:#fff;border:none;border-radius:4px;cursor:pointer;' +
      'font-size:13px;top:' + e.clientY + 'px;left:' + e.clientX + 'px;';
    document.body.appendChild(btn);

    function cleanup() { btn.remove(); document.removeEventListener('click', onOutside); }
    function onOutside() { cleanup(); }
    setTimeout(() => document.addEventListener('click', onOutside), 0);

    btn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      cleanup();
      tr.style.textDecoration = 'line-through';
      tr.style.opacity = '0.4';
      tr.style.backgroundColor = 'rgba(211, 47, 47, 0.15)';
      vscodeApi.postMessage({
        command: 'rowDelete',
        table: meta.name,
        pkColumn: meta.pkColumn,
        pkValue: getCellValue(pkTd),
      });
    });
  });

  // --- Add Row button ---
  function addInsertButtons() {
    document.querySelectorAll('table').forEach(function(table) {
      if (table.querySelector('.drift-add-row-btn')) return;
      const meta = getTableMeta(table);
      const btn = document.createElement('button');
      btn.className = 'drift-add-row-btn';
      btn.textContent = '+ Add Row';
      btn.style.cssText = 'margin:8px 0;padding:4px 12px;font-size:13px;' +
        'cursor:pointer;background:#2e7d32;color:#fff;border:none;border-radius:4px;';
      btn.addEventListener('click', function() {
        const values = {};
        meta.headers.forEach(function(h, i) {
          if (i !== meta.pkIdx) values[h] = null;
        });
        // Add a visual row
        const tbody = table.querySelector('tbody') || table;
        const newRow = document.createElement('tr');
        newRow.style.backgroundColor = 'rgba(46, 125, 50, 0.15)';
        meta.headers.forEach(function(h, i) {
          const td = document.createElement('td');
          td.textContent = i === meta.pkIdx ? '(auto)' : 'NULL';
          newRow.appendChild(td);
        });
        tbody.appendChild(newRow);
        vscodeApi.postMessage({ command: 'rowInsert', table: meta.name, values: values });
      });
      table.parentNode.insertBefore(btn, table.nextSibling);
    });
  }

  // --- Receive state from extension ---
  window.addEventListener('message', function(event) {
    const msg = event.data;
    if (msg.command === 'pendingChanges') {
      pendingChanges = msg.changes || [];
    }
    if (msg.command === 'editingEnabled') {
      editingEnabled = msg.enabled;
    }
  });

  // Run once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addInsertButtons);
  } else {
    addInsertButtons();
  }

  // Re-run after dynamic content loads (the server HTML may fetch and render tables async)
  const observer = new MutationObserver(function() { addInsertButtons(); });
  observer.observe(document.body, { childList: true, subtree: true });
})();
`;
