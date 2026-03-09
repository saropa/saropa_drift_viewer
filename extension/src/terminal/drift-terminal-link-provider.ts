import * as vscode from 'vscode';
import { DriftApiClient } from '../api-client';
import { LogCaptureBridge } from '../debug/log-capture-bridge';
import { findClosestMatches } from './fuzzy-match';

type MatchType = 'table' | 'column' | 'fk_error';

/** Custom terminal link carrying SQLite error context. */
export class DriftTerminalLink extends vscode.TerminalLink {
  constructor(
    startIndex: number,
    length: number,
    public readonly tableName: string | null,
    public readonly matchType: MatchType,
    public readonly columnName?: string,
  ) {
    const tip = tableName
      ? `Drift: look up "${tableName}"`
      : 'Drift: view foreign keys';
    super(startIndex, length, tip);
  }
}

interface IPatternDef {
  regex: RegExp;
  extract(m: RegExpExecArray): {
    start: number;
    length: number;
    table: string | null;
    type: MatchType;
    column?: string;
  };
}

/** SQLite error patterns that extract table/column names. */
const PATTERNS: IPatternDef[] = [
  {
    regex: /no such table:\s*(\w+)/i,
    extract: (m) => ({
      start: m.index + m[0].indexOf(m[1]),
      length: m[1].length,
      table: m[1],
      type: 'table',
    }),
  },
  {
    regex: /no such column:\s*(\w+)\.(\w+)/i,
    extract: (m) => ({
      start: m.index + m[0].indexOf(m[1]),
      length: m[1].length + 1 + m[2].length,
      table: m[1],
      type: 'column',
      column: m[2],
    }),
  },
  {
    regex: /UNIQUE constraint failed:\s*(\w+)\.(\w+)/i,
    extract: (m) => ({
      start: m.index + m[0].indexOf(m[1]),
      length: m[1].length,
      table: m[1],
      type: 'table',
    }),
  },
  {
    regex: /NOT NULL constraint failed:\s*(\w+)\.(\w+)/i,
    extract: (m) => ({
      start: m.index + m[0].indexOf(m[1]),
      length: m[1].length,
      table: m[1],
      type: 'table',
    }),
  },
  {
    regex: /table\s+(\w+)\s+already exists/i,
    extract: (m) => ({
      start: m.index + m[0].indexOf(m[1]),
      length: m[1].length,
      table: m[1],
      type: 'table',
    }),
  },
  {
    regex: /FOREIGN KEY constraint failed/i,
    extract: (m) => ({
      start: m.index,
      length: m[0].length,
      table: null,
      type: 'fk_error',
    }),
  },
];

/** Callback to reveal a table in the Database Explorer tree view. */
export type RevealTableFn = (name: string) => Promise<void>;

export class DriftTerminalLinkProvider
  implements vscode.TerminalLinkProvider<DriftTerminalLink>
{
  constructor(
    private readonly _client: DriftApiClient,
    private readonly _revealTable: RevealTableFn,
    private readonly _logBridge?: LogCaptureBridge,
  ) {}

  provideTerminalLinks(
    context: vscode.TerminalLinkContext,
  ): DriftTerminalLink[] {
    const links: DriftTerminalLink[] = [];
    for (const { regex, extract } of PATTERNS) {
      const match = regex.exec(context.line);
      if (!match) continue;
      const info = extract(match);
      links.push(
        new DriftTerminalLink(
          info.start,
          info.length,
          info.table,
          info.type,
          info.column,
        ),
      );
    }
    return links;
  }

  async handleTerminalLink(link: DriftTerminalLink): Promise<void> {
    if (link.matchType === 'fk_error') {
      this._logEvent('Foreign key constraint — showing all tables');
      await this._showTablePicker('Foreign key error. Select a table:');
      return;
    }

    const target = link.tableName!;
    const tableNames = await this._fetchTableNames();
    if (!tableNames) return;

    if (tableNames.includes(target)) {
      this._logEvent(`Exact match: "${target}"`);
      await this._revealTable(target);
      return;
    }

    const suggestions = findClosestMatches(target, tableNames, 3);
    if (suggestions.length > 0 && suggestions[0].distance <= 2) {
      const best = suggestions[0].name;
      this._logEvent(
        `Fuzzy: "${target}" → "${best}" (distance ${suggestions[0].distance})`,
      );
      const action = await vscode.window.showInformationMessage(
        `Table "${target}" not found. Did you mean "${best}"?`,
        'View Table',
        'Show All Tables',
      );
      if (action === 'View Table') await this._revealTable(best);
      if (action === 'Show All Tables') {
        await this._showTablePicker(undefined, tableNames);
      }
    } else {
      this._logEvent(`No close match for "${target}"`);
      await this._showTablePicker(
        `No exact match for "${target}". Select a table:`,
        tableNames,
      );
    }
  }

  private async _fetchTableNames(): Promise<string[] | undefined> {
    try {
      const meta = await this._client.schemaMetadata();
      return meta.map((t) => t.name);
    } catch {
      vscode.window.showWarningMessage(
        'Drift debug server not reachable — cannot look up tables.',
      );
      return undefined;
    }
  }

  private async _showTablePicker(
    title?: string,
    preloaded?: string[],
  ): Promise<void> {
    const tableNames = preloaded ?? (await this._fetchTableNames());
    if (!tableNames) return;
    if (tableNames.length === 0) {
      vscode.window.showInformationMessage('No tables found.');
      return;
    }
    const picked = await vscode.window.showQuickPick(tableNames.sort(), {
      placeHolder: title ?? 'Select a table',
    });
    if (picked) await this._revealTable(picked);
  }

  private _logEvent(message: string): void {
    this._logBridge?.writeTerminalLinkEvent(message);
  }
}
