import type * as vscode from 'vscode';

import type { ISnippetExport, ISqlSnippet } from './snippet-types';

const STORAGE_KEY = 'snippets.library';

export class SnippetStore {
  constructor(private readonly _state: vscode.Memento) {}

  getAll(): ISqlSnippet[] {
    return this._state.get<ISqlSnippet[]>(STORAGE_KEY, []);
  }

  save(snippet: ISqlSnippet): void {
    const all = this.getAll();
    const idx = all.findIndex((s) => s.id === snippet.id);
    if (idx >= 0) {
      all[idx] = snippet;
    } else {
      all.push(snippet);
    }
    void this._state.update(STORAGE_KEY, all);
  }

  delete(id: string): void {
    const all = this.getAll().filter((s) => s.id !== id);
    void this._state.update(STORAGE_KEY, all);
  }

  getCategories(): string[] {
    const cats = new Set(this.getAll().map((s) => s.category));
    return [...cats].sort();
  }

  search(query: string): ISqlSnippet[] {
    const lower = query.toLowerCase();
    return this.getAll().filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.sql.toLowerCase().includes(lower) ||
        (s.description?.toLowerCase().includes(lower) ?? false),
    );
  }

  exportAll(): string {
    const data: ISnippetExport = {
      $schema: 'drift-snippets/v1',
      snippets: this.getAll(),
    };
    return JSON.stringify(data, null, 2);
  }

  importFrom(json: string): number {
    const data = JSON.parse(json) as ISnippetExport;
    if (data.$schema !== 'drift-snippets/v1') {
      throw new Error('Invalid snippet file: missing drift-snippets/v1 schema');
    }
    const existing = this.getAll();
    const existingIds = new Set(existing.map((s) => s.id));
    let added = 0;

    for (const snippet of data.snippets) {
      if (!existingIds.has(snippet.id)) {
        existing.push(snippet);
        added++;
      }
    }

    void this._state.update(STORAGE_KEY, existing);
    return added;
  }
}
