import * as vscode from 'vscode';
import type { IDashboardLayout } from './dashboard-types';

const DASHBOARD_LIST_KEY = 'dashboard.list';
const DASHBOARD_CURRENT_KEY = 'dashboard.current';

/** Manages dashboard layout persistence using VS Code workspace state. */
export class DashboardState {
  constructor(private readonly _state: vscode.Memento) {}

  /** Save a dashboard layout. Updates the current dashboard pointer. */
  save(layout: IDashboardLayout): void {
    this._state.update(`dashboard.${layout.name}`, layout);
    this._state.update(DASHBOARD_CURRENT_KEY, layout.name);

    const list = this.listSaved();
    if (!list.includes(layout.name)) {
      this._state.update(DASHBOARD_LIST_KEY, [...list, layout.name]);
    }
  }

  /** Load a dashboard layout by name, or the current one if no name provided. */
  load(name?: string): IDashboardLayout | undefined {
    const key = name ?? this._state.get<string>(DASHBOARD_CURRENT_KEY);
    if (!key) return undefined;
    return this._state.get<IDashboardLayout>(`dashboard.${key}`);
  }

  /** List all saved dashboard names. */
  listSaved(): string[] {
    return this._state.get<string[]>(DASHBOARD_LIST_KEY, []);
  }

  /** Delete a saved dashboard. */
  delete(name: string): void {
    this._state.update(`dashboard.${name}`, undefined);

    const list = this.listSaved().filter((n) => n !== name);
    this._state.update(DASHBOARD_LIST_KEY, list);

    if (this._state.get<string>(DASHBOARD_CURRENT_KEY) === name) {
      this._state.update(DASHBOARD_CURRENT_KEY, list.length > 0 ? list[0] : undefined);
    }
  }

  /** Get the name of the currently active dashboard. */
  getCurrentName(): string | undefined {
    return this._state.get<string>(DASHBOARD_CURRENT_KEY);
  }

  /** Create a default empty layout. */
  static createDefault(name: string = 'default'): IDashboardLayout {
    return {
      version: 1,
      name,
      columns: 4,
      widgets: [],
    };
  }
}
