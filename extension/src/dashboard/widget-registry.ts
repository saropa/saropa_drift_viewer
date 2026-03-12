import type { DriftApiClient, TableMetadata } from '../api-client';
import type { IHealthScore } from '../health/health-types';
import {
  escapeHtml,
  gradeColorClass,
  type ChartType,
  type IConfigField,
  type IHealthScorerProvider,
  type IWidgetTypeInfo,
  type WidgetType,
} from './dashboard-types';

/** Definition for a widget type including data fetching and rendering. */
export interface IWidgetDefinition {
  type: WidgetType;
  label: string;
  icon: string;
  description: string;
  defaultSize: { w: number; h: number };
  configSchema: IConfigField[];
  fetchData: (
    client: DriftApiClient,
    config: Record<string, unknown>,
    healthScorer?: IHealthScorerProvider,
  ) => Promise<unknown>;
  renderHtml: (data: unknown, config: Record<string, unknown>) => string;
}

const esc = escapeHtml;

function renderMiniTable(columns: string[], rows: unknown[][]): string {
  if (rows.length === 0) {
    return '<p class="empty-data">No data</p>';
  }
  const headerCells = columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const bodyRows = rows.slice(0, 10).map((row) => {
    const cells = row.map((cell) => `<td>${esc(String(cell ?? ''))}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table class="mini-table">
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>${rows.length > 10 ? `<p class="more-rows">+${rows.length - 10} more rows</p>` : ''}`;
}

function renderSvgChart(
  data: { columns: string[]; rows: unknown[][] },
  chartType: ChartType,
): string {
  if (!data.rows || data.rows.length === 0) {
    return '<p class="empty-data">No chart data</p>';
  }

  const labels = data.rows.map((r) => String(r[0] ?? ''));
  const values = data.rows.map((r) => Number(r[1]) || 0);
  const maxVal = Math.max(...values, 1);

  if (chartType === 'bar') {
    const barWidth = Math.min(40, 200 / values.length);
    const gap = 4;
    const chartWidth = values.length * (barWidth + gap);
    const chartHeight = 100;

    const bars = values.map((v, i) => {
      const height = (v / maxVal) * (chartHeight - 20);
      const x = i * (barWidth + gap);
      const y = chartHeight - height - 15;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${height}" fill="var(--vscode-charts-blue)" />
        <text x="${x + barWidth / 2}" y="${chartHeight - 2}" text-anchor="middle" font-size="8" fill="var(--vscode-foreground)">${esc(labels[i].substring(0, 6))}</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="chart-svg">${bars}</svg>`;
  }

  if (chartType === 'pie') {
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const colors = [
      'var(--vscode-charts-blue)',
      'var(--vscode-charts-green)',
      'var(--vscode-charts-yellow)',
      'var(--vscode-charts-orange)',
      'var(--vscode-charts-red)',
      'var(--vscode-charts-purple)',
    ];
    let cumulativeAngle = 0;
    const slices = values.map((v, i) => {
      const angle = (v / total) * 360;
      const startAngle = cumulativeAngle;
      cumulativeAngle += angle;
      const largeArc = angle > 180 ? 1 : 0;
      const startRad = (startAngle - 90) * Math.PI / 180;
      const endRad = (startAngle + angle - 90) * Math.PI / 180;
      const x1 = 50 + 40 * Math.cos(startRad);
      const y1 = 50 + 40 * Math.sin(startRad);
      const x2 = 50 + 40 * Math.cos(endRad);
      const y2 = 50 + 40 * Math.sin(endRad);
      const color = colors[i % colors.length];
      return `<path d="M50,50 L${x1},${y1} A40,40 0 ${largeArc},1 ${x2},${y2} Z" fill="${color}" />`;
    }).join('');

    return `<svg viewBox="0 0 100 100" class="chart-svg pie-chart">${slices}</svg>`;
  }

  if (chartType === 'line') {
    const chartWidth = 200;
    const chartHeight = 100;
    const stepX = values.length > 1 ? (chartWidth - 20) / (values.length - 1) : 0;
    const points = values.map((v, i) => {
      const x = 10 + i * stepX;
      const y = chartHeight - 15 - ((v / maxVal) * (chartHeight - 30));
      return `${x},${y}`;
    }).join(' ');

    return `<svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="chart-svg">
      <polyline points="${points}" fill="none" stroke="var(--vscode-charts-blue)" stroke-width="2" />
      ${values.map((v, i) => {
        const x = 10 + i * stepX;
        const y = chartHeight - 15 - ((v / maxVal) * (chartHeight - 30));
        return `<circle cx="${x}" cy="${y}" r="3" fill="var(--vscode-charts-blue)" />`;
      }).join('')}
    </svg>`;
  }

  return '<p class="empty-data">Unknown chart type</p>';
}

/** Registry of all available widget types. */
export const WIDGET_REGISTRY: IWidgetDefinition[] = [
  {
    type: 'tableStats',
    label: 'Table Stats',
    icon: '\u{1F4CA}',
    description: 'Show row count and column info for a table',
    defaultSize: { w: 1, h: 1 },
    configSchema: [
      { key: 'table', label: 'Table', type: 'tableSelect', required: true },
    ],
    fetchData: async (client, config) => {
      const meta = await client.schemaMetadata();
      return meta.find((t) => t.name === config.table);
    },
    renderHtml: (data, config) => {
      if (!data) {
        return `<p class="empty-data">Table "${esc(String(config.table))}" not found</p>`;
      }
      const table = data as TableMetadata;
      return `<div class="widget-table-stats">
        <div class="stat-row"><span class="stat-label">Rows</span><span class="stat-value">${table.rowCount.toLocaleString()}</span></div>
        <div class="stat-row"><span class="stat-label">Columns</span><span class="stat-value">${table.columns.length}</span></div>
      </div>`;
    },
  },

  {
    type: 'tablePreview',
    label: 'Table Preview',
    icon: '\u{1F5C2}',
    description: 'Show recent rows from a table',
    defaultSize: { w: 2, h: 2 },
    configSchema: [
      { key: 'table', label: 'Table', type: 'tableSelect', required: true },
      { key: 'limit', label: 'Max Rows', type: 'number', default: 5 },
    ],
    fetchData: async (client, config) => {
      const limit = Number(config.limit) || 5;
      return client.sql(`SELECT * FROM "${config.table}" LIMIT ${limit}`);
    },
    renderHtml: (data, _config) => {
      const result = data as { columns: string[]; rows: unknown[][] };
      return renderMiniTable(result.columns, result.rows);
    },
  },

  {
    type: 'queryResult',
    label: 'Query Result',
    icon: '\u{1F50D}',
    description: 'Run a custom SQL query and display results',
    defaultSize: { w: 2, h: 2 },
    configSchema: [
      { key: 'sql', label: 'SQL Query', type: 'text', required: true },
      { key: 'limit', label: 'Max Rows', type: 'number', default: 10 },
    ],
    fetchData: async (client, config) => {
      const limit = Number(config.limit) || 10;
      const sql = String(config.sql || '');
      const sqlWithLimit = sql.toLowerCase().includes(' limit ')
        ? sql
        : `${sql} LIMIT ${limit}`;
      return client.sql(sqlWithLimit);
    },
    renderHtml: (data, _config) => {
      const result = data as { columns: string[]; rows: unknown[][] };
      return renderMiniTable(result.columns, result.rows);
    },
  },

  {
    type: 'chart',
    label: 'Chart',
    icon: '\u{1F4C8}',
    description: 'Visualize query results as a chart',
    defaultSize: { w: 2, h: 2 },
    configSchema: [
      { key: 'sql', label: 'SQL (col1=label, col2=value)', type: 'text', required: true },
      { key: 'chartType', label: 'Chart Type', type: 'select', options: ['bar', 'pie', 'line'], default: 'bar' },
    ],
    fetchData: async (client, config) => client.sql(String(config.sql || 'SELECT 1')),
    renderHtml: (data, config) => {
      const chartType = (config.chartType as ChartType) || 'bar';
      return renderSvgChart(data as { columns: string[]; rows: unknown[][] }, chartType);
    },
  },

  {
    type: 'rowCount',
    label: 'Row Count',
    icon: '\u{1F522}',
    description: 'Display the row count for a table',
    defaultSize: { w: 1, h: 1 },
    configSchema: [
      { key: 'table', label: 'Table', type: 'tableSelect', required: true },
    ],
    fetchData: async (client, config) => {
      const result = await client.sql(`SELECT COUNT(*) AS cnt FROM "${config.table}"`);
      return (result.rows[0] as unknown[])[0];
    },
    renderHtml: (data, config) => {
      return `<div class="widget-counter">
        <span class="counter-value">${Number(data).toLocaleString()}</span>
        <span class="counter-label">${esc(String(config.table))} rows</span>
      </div>`;
    },
  },

  {
    type: 'healthScore',
    label: 'Health Score',
    icon: '\u2764',
    description: 'Show overall database health score',
    defaultSize: { w: 2, h: 1 },
    configSchema: [],
    fetchData: async (client, _config, healthScorer) => {
      if (!healthScorer) {
        return { overall: 0, grade: '?', metrics: [], recommendations: [] };
      }
      return healthScorer.compute(client);
    },
    renderHtml: (data, _config) => {
      const score = data as IHealthScore;
      const gradeClass = gradeColorClass(score.grade);
      return `<div class="widget-health">
        <div class="health-grade ${gradeClass}">${esc(score.grade)}</div>
        <div class="health-score">${score.overall}/100</div>
        <div class="health-metrics">
          ${score.metrics.slice(0, 3).map((m) =>
            `<span class="health-metric">${esc(m.name)}: ${m.grade}</span>`
          ).join('')}
        </div>
      </div>`;
    },
  },

  {
    type: 'invariantStatus',
    label: 'Invariant Status',
    icon: '\u{1F6E1}',
    description: 'Show data invariant check results',
    defaultSize: { w: 2, h: 1 },
    configSchema: [],
    fetchData: async (client) => {
      const anomalies = await client.anomalies();
      const errors = anomalies.filter((a) => a.severity === 'error');
      const warnings = anomalies.filter((a) => a.severity === 'warning');
      return { total: anomalies.length, errors: errors.length, warnings: warnings.length, items: anomalies.slice(0, 5) };
    },
    renderHtml: (data, _config) => {
      const result = data as { total: number; errors: number; warnings: number; items: Array<{ message: string; severity: string }> };
      const passing = result.total === 0;
      return `<div class="widget-invariants">
        <div class="invariant-summary ${passing ? 'passing' : 'failing'}">
          ${passing ? '\u2705' : '\u274C'} ${result.errors} errors, ${result.warnings} warnings
        </div>
        <div class="invariant-list">
          ${result.items.map((item) =>
            `<div class="invariant-item ${item.severity}">${item.severity === 'error' ? '\u274C' : '\u26A0'} ${esc(item.message)}</div>`
          ).join('')}
        </div>
      </div>`;
    },
  },

  {
    type: 'dvrStatus',
    label: 'DVR Status',
    icon: '\u23FA',
    description: 'Show query recording status',
    defaultSize: { w: 1, h: 1 },
    configSchema: [],
    fetchData: async (client) => {
      const perf = await client.performance();
      return { totalQueries: perf.totalQueries, avgMs: perf.avgDurationMs, slowCount: perf.slowQueries.length };
    },
    renderHtml: (data, _config) => {
      const result = data as { totalQueries: number; avgMs: number; slowCount: number };
      return `<div class="widget-dvr">
        <div class="dvr-stat"><span class="dvr-value">${result.totalQueries}</span><span class="dvr-label">queries</span></div>
        <div class="dvr-stat"><span class="dvr-value">${result.avgMs.toFixed(1)}ms</span><span class="dvr-label">avg</span></div>
        <div class="dvr-stat"><span class="dvr-value">${result.slowCount}</span><span class="dvr-label">slow</span></div>
      </div>`;
    },
  },

  {
    type: 'watchDiff',
    label: 'Watch Diff',
    icon: '\u{1F440}',
    description: 'Show watched table change summary',
    defaultSize: { w: 2, h: 1 },
    configSchema: [
      { key: 'table', label: 'Table', type: 'tableSelect', required: true },
    ],
    fetchData: async (client, config) => {
      const result = await client.sql(`SELECT COUNT(*) AS cnt FROM "${config.table}"`);
      const count = (result.rows[0] as unknown[])[0];
      return { table: config.table, rowCount: Number(count) };
    },
    renderHtml: (data, _config) => {
      const result = data as { table: string; rowCount: number };
      return `<div class="widget-watch">
        <div class="watch-table">${esc(String(result.table))}</div>
        <div class="watch-count">${result.rowCount.toLocaleString()} rows</div>
        <div class="watch-hint">Watching for changes...</div>
      </div>`;
    },
  },

  {
    type: 'customText',
    label: 'Custom Text',
    icon: '\u{1F4DD}',
    description: 'Add notes or static text',
    defaultSize: { w: 1, h: 1 },
    configSchema: [
      { key: 'text', label: 'Text Content', type: 'text', default: 'Notes...' },
    ],
    fetchData: async (_client, config) => config.text || '',
    renderHtml: (data, _config) => {
      return `<div class="widget-text">${esc(String(data))}</div>`;
    },
  },
];

/** Get widget type info for the add widget picker. */
export function getWidgetTypeInfoList(): IWidgetTypeInfo[] {
  return WIDGET_REGISTRY.map((def) => ({
    type: def.type,
    label: def.label,
    icon: def.icon,
    description: def.description,
  }));
}

/** Find a widget definition by type. */
export function getWidgetDefinition(type: WidgetType): IWidgetDefinition | undefined {
  return WIDGET_REGISTRY.find((def) => def.type === type);
}
