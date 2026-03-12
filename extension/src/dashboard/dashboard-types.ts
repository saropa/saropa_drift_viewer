/** Widget type identifiers for the dashboard. */
export type WidgetType =
  | 'tableStats'
  | 'tablePreview'
  | 'queryResult'
  | 'chart'
  | 'rowCount'
  | 'healthScore'
  | 'invariantStatus'
  | 'dvrStatus'
  | 'watchDiff'
  | 'customText';

/** Chart types supported by the chart widget. */
export type ChartType = 'bar' | 'pie' | 'line';

/** Configuration field types for widget config forms. */
export type ConfigFieldType = 'tableSelect' | 'text' | 'number' | 'select' | 'checkbox';

/** Schema for widget configuration fields. */
export interface IConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  default?: unknown;
  options?: string[];
  required?: boolean;
}

/** Dashboard layout configuration. */
export interface IDashboardLayout {
  version: 1;
  name: string;
  columns: number;
  widgets: IWidgetConfig[];
}

/** Individual widget configuration. */
export interface IWidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  config: Record<string, unknown>;
}

/** Widget data that has been fetched and is ready for rendering. */
export interface IWidgetData {
  id: string;
  html: string;
  error?: string;
}

/** Message from webview to extension. */
export type WebviewToExtensionMessage =
  | { command: 'addWidget'; type: WidgetType; config: Record<string, unknown> }
  | { command: 'removeWidget'; id: string }
  | { command: 'swapWidgets'; idA: string; idB: string }
  | { command: 'resizeWidget'; id: string; w: number; h: number }
  | { command: 'editWidget'; id: string; config: Record<string, unknown> }
  | { command: 'refreshAll' }
  | { command: 'refreshWidget'; id: string }
  | { command: 'saveLayout'; name: string }
  | { command: 'loadLayout'; name: string }
  | { command: 'openAddWidgetPicker' }
  | { command: 'openLayoutManager' }
  | { command: 'executeAction'; actionCommand: string; args?: unknown }
  | { command: 'getConfigSchema'; type: WidgetType; existingConfig: Record<string, unknown> };

/** Message from extension to webview. */
export type ExtensionToWebviewMessage =
  | { command: 'init'; layout: IDashboardLayout; widgetTypes: IWidgetTypeInfo[] }
  | { command: 'updateWidget'; id: string; html: string }
  | { command: 'updateAll'; updates: IWidgetData[] }
  | { command: 'layoutChanged'; layout: IDashboardLayout }
  | { command: 'showError'; message: string };

/** Widget type info for the add widget picker. */
export interface IWidgetTypeInfo {
  type: WidgetType;
  label: string;
  icon: string;
  description: string;
}

/** Health scorer provider interface for dependency injection. */
export interface IHealthScorerProvider {
  compute: (client: unknown) => Promise<unknown>;
}

/** Escape HTML special characters to prevent XSS. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Convert health grade letter to CSS class for coloring. */
export function gradeColorClass(grade: string): string {
  const letter = grade.charAt(0).toUpperCase();
  if (letter === 'A') return 'grade-a';
  if (letter === 'B') return 'grade-b';
  if (letter === 'C') return 'grade-c';
  if (letter === 'D') return 'grade-d';
  return 'grade-f';
}
