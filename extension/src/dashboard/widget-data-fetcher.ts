import type { DriftApiClient } from '../api-client';
import { escapeHtml, type IHealthScorerProvider, type IWidgetConfig, type IWidgetData } from './dashboard-types';
import { getWidgetDefinition, WIDGET_REGISTRY } from './widget-registry';

/** Fetches data for dashboard widgets and renders them to HTML. */
export class WidgetDataFetcher {
  constructor(
    private readonly _client: DriftApiClient,
    private readonly _healthScorer?: IHealthScorerProvider,
  ) {}

  /** Fetch data for a single widget and render to HTML. */
  async fetchOne(widget: IWidgetConfig): Promise<IWidgetData> {
    const def = getWidgetDefinition(widget.type);
    if (!def) {
      return {
        id: widget.id,
        html: '<p class="widget-error">Unknown widget type</p>',
        error: `Unknown widget type: ${widget.type}`,
      };
    }

    try {
      const data = await def.fetchData(this._client, widget.config, this._healthScorer);
      const html = def.renderHtml(data, widget.config);
      return { id: widget.id, html };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        id: widget.id,
        html: `<p class="widget-error">\u26A0 ${escapeHtml(message)}</p>`,
        error: message,
      };
    }
  }

  /** Fetch data for all widgets in parallel. Returns a map of widget ID to rendered HTML. */
  async fetchAll(widgets: IWidgetConfig[]): Promise<Map<string, IWidgetData>> {
    const results = new Map<string, IWidgetData>();

    const fetches = widgets.map(async (widget) => {
      const result = await this.fetchOne(widget);
      results.set(widget.id, result);
    });

    await Promise.all(fetches);
    return results;
  }

  /** Fetch data for all widgets and return as an array for webview update. */
  async fetchAllAsArray(widgets: IWidgetConfig[]): Promise<IWidgetData[]> {
    const map = await this.fetchAll(widgets);
    return Array.from(map.values());
  }

  /** Get available table names for widget configuration. */
  async getTableNames(): Promise<string[]> {
    try {
      const metadata = await this._client.schemaMetadata();
      return metadata.map((t) => t.name);
    } catch {
      return [];
    }
  }
}

/** Re-export for backward compatibility. */
export type { IHealthScorerProvider } from './dashboard-types';

/** Get default configuration for a widget type. */
export function getDefaultWidgetConfig(type: string): Record<string, unknown> {
  const def = WIDGET_REGISTRY.find((w) => w.type === type);
  if (!def) return {};

  const config: Record<string, unknown> = {};
  for (const field of def.configSchema) {
    if (field.default !== undefined) {
      config[field.key] = field.default;
    }
  }
  return config;
}
