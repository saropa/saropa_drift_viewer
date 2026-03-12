import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';
import type {
  IDashboardLayout,
  IHealthScorerProvider,
  IWidgetConfig,
  WebviewToExtensionMessage,
  WidgetType,
} from './dashboard-types';
import { DashboardState } from './dashboard-state';
import { buildDashboardHtml } from './dashboard-html';
import { getDefaultWidgetConfig, WidgetDataFetcher } from './widget-data-fetcher';
import { getWidgetDefinition, getWidgetTypeInfoList } from './widget-registry';

/** Singleton webview panel for the custom dashboard builder. */
export class DashboardPanel {
  private static _currentPanel: DashboardPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _client: DriftApiClient;
  private readonly _state: DashboardState;
  private readonly _fetcher: WidgetDataFetcher;
  private _layout: IDashboardLayout;

  /** Get the current panel instance if it exists. */
  static get currentPanel(): DashboardPanel | undefined {
    return DashboardPanel._currentPanel;
  }

  /** Create or show the dashboard panel. */
  static createOrShow(
    extensionUri: vscode.Uri,
    client: DriftApiClient,
    layout: IDashboardLayout,
    state: DashboardState,
    healthScorer?: IHealthScorerProvider,
  ): void {
    const column = vscode.ViewColumn.One;

    if (DashboardPanel._currentPanel) {
      DashboardPanel._currentPanel._updateLayout(layout);
      DashboardPanel._currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'driftDashboard',
      'Dashboard',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );
    DashboardPanel._currentPanel = new DashboardPanel(panel, client, layout, state, healthScorer);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    client: DriftApiClient,
    layout: IDashboardLayout,
    state: DashboardState,
    healthScorer?: IHealthScorerProvider,
  ) {
    this._panel = panel;
    this._client = client;
    this._layout = layout;
    this._state = state;
    this._fetcher = new WidgetDataFetcher(client, healthScorer);

    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg as WebviewToExtensionMessage),
      null,
      this._disposables,
    );

    this._render();
    this._refreshAllWidgets();
  }

  /** Refresh all widgets (called on generation change). */
  async refreshAll(): Promise<void> {
    await this._refreshAllWidgets();
  }

  /** Save the current layout with a new name. */
  saveAs(name: string): void {
    this._layout.name = name;
    this._state.save(this._layout);
    vscode.window.showInformationMessage(`Dashboard "${name}" saved.`);
  }

  private _updateLayout(layout: IDashboardLayout): void {
    this._layout = layout;
    this._render();
    this._refreshAllWidgets();
  }

  private async _render(): Promise<void> {
    const widgetTypes = getWidgetTypeInfoList();
    const initialHtml = new Map<string, string>();
    this._panel.webview.html = buildDashboardHtml(this._layout, widgetTypes, initialHtml);
  }

  private async _refreshAllWidgets(): Promise<void> {
    if (this._layout.widgets.length === 0) return;

    const updates = await this._fetcher.fetchAllAsArray(this._layout.widgets);
    this._panel.webview.postMessage({ command: 'updateAll', updates });
  }

  private async _refreshWidget(id: string): Promise<void> {
    const widget = this._layout.widgets.find((w) => w.id === id);
    if (!widget) return;

    const result = await this._fetcher.fetchOne(widget);
    this._panel.webview.postMessage({
      command: 'updateWidget',
      id: result.id,
      html: result.html,
    });
  }

  private async _handleMessage(msg: WebviewToExtensionMessage): Promise<void> {
    switch (msg.command) {
      case 'addWidget':
        await this._addWidget(msg.type, msg.config);
        break;

      case 'removeWidget':
        this._removeWidget(msg.id);
        break;

      case 'swapWidgets':
        this._swapWidgets(msg.idA, msg.idB);
        break;

      case 'resizeWidget':
        this._resizeWidget(msg.id, msg.w, msg.h);
        break;

      case 'editWidget':
        await this._editWidget(msg.id, msg.config);
        break;

      case 'refreshAll':
        await this._refreshAllWidgets();
        break;

      case 'refreshWidget':
        await this._refreshWidget(msg.id);
        break;

      case 'saveLayout':
        this.saveAs(msg.name);
        break;

      case 'loadLayout': {
        const layout = this._state.load(msg.name);
        if (layout) {
          this._updateLayout(layout);
        }
        break;
      }

      case 'getConfigSchema':
        await this._sendConfigSchema(msg.type, msg.existingConfig);
        break;

      case 'executeAction':
        if (msg.actionCommand) {
          vscode.commands.executeCommand(msg.actionCommand, msg.args);
        }
        break;
    }
  }

  private async _sendConfigSchema(
    type: WidgetType,
    existingConfig: Record<string, unknown>,
  ): Promise<void> {
    const def = getWidgetDefinition(type);
    if (!def) return;

    const tables = await this._fetcher.getTableNames();
    this._panel.webview.postMessage({
      command: 'showConfigForm',
      schema: def.configSchema,
      existingConfig: existingConfig || getDefaultWidgetConfig(type),
      tables,
    });
  }

  private async _addWidget(type: WidgetType, config: Record<string, unknown>): Promise<void> {
    const def = getWidgetDefinition(type);
    if (!def) return;

    const newWidget: IWidgetConfig = {
      id: generateId(),
      type,
      title: config.title as string || def.label,
      gridX: this._findNextGridX(),
      gridY: this._findNextGridY(),
      gridW: def.defaultSize.w,
      gridH: def.defaultSize.h,
      config,
    };

    this._layout.widgets.push(newWidget);
    this._saveAndNotify();

    const result = await this._fetcher.fetchOne(newWidget);
    this._panel.webview.postMessage({
      command: 'updateWidget',
      id: result.id,
      html: result.html,
    });
  }

  private _removeWidget(id: string): void {
    this._layout.widgets = this._layout.widgets.filter((w) => w.id !== id);
    this._saveAndNotify();
  }

  private _swapWidgets(idA: string, idB: string): void {
    const widgetA = this._layout.widgets.find((w) => w.id === idA);
    const widgetB = this._layout.widgets.find((w) => w.id === idB);
    if (!widgetA || !widgetB) return;

    const tempX = widgetA.gridX;
    const tempY = widgetA.gridY;
    widgetA.gridX = widgetB.gridX;
    widgetA.gridY = widgetB.gridY;
    widgetB.gridX = tempX;
    widgetB.gridY = tempY;

    this._saveAndNotify();
  }

  private _resizeWidget(id: string, w: number, h: number): void {
    const widget = this._layout.widgets.find((wgt) => wgt.id === id);
    if (!widget) return;

    widget.gridW = Math.max(1, Math.min(this._layout.columns, w));
    widget.gridH = Math.max(1, Math.min(3, h));
    this._saveAndNotify();
  }

  private async _editWidget(id: string, config: Record<string, unknown>): Promise<void> {
    const widget = this._layout.widgets.find((w) => w.id === id);
    if (!widget) return;

    widget.config = { ...widget.config, ...config };
    if (config.title) {
      widget.title = String(config.title);
    }
    this._saveAndNotify();

    await this._refreshWidget(id);
  }

  private _findNextGridX(): number {
    if (this._layout.widgets.length === 0) return 0;
    const maxX = Math.max(...this._layout.widgets.map((w) => w.gridX + w.gridW));
    return maxX >= this._layout.columns ? 0 : maxX;
  }

  private _findNextGridY(): number {
    if (this._layout.widgets.length === 0) return 0;
    const nextX = this._findNextGridX();
    if (nextX === 0) {
      return Math.max(...this._layout.widgets.map((w) => w.gridY + w.gridH));
    }
    const widgetsOnLastRow = this._layout.widgets.filter(
      (w) => w.gridY === Math.max(...this._layout.widgets.map((w2) => w2.gridY))
    );
    if (widgetsOnLastRow.length > 0) {
      return widgetsOnLastRow[0].gridY;
    }
    return 0;
  }

  private _saveAndNotify(): void {
    this._state.save(this._layout);
    this._panel.webview.postMessage({
      command: 'layoutChanged',
      layout: this._layout,
    });
  }

  private _dispose(): void {
    DashboardPanel._currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}

function generateId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}
