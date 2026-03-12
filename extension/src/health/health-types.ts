export type MetricKey =
  | 'indexCoverage'
  | 'fkIntegrity'
  | 'nullDensity'
  | 'queryPerformance'
  | 'tableBalance'
  | 'schemaQuality';

export interface IHealthScore {
  overall: number;           // 0–100
  grade: string;             // A+ through F
  metrics: IHealthMetric[];
  recommendations: IRecommendation[];
}

export interface IMetricAction {
  label: string;
  command: string;
  args?: unknown;
  icon?: string;             // optional icon (e.g. '🔧', '📊')
}

export interface IHealthMetric {
  name: string;
  key: MetricKey;
  score: number;             // 0–100
  grade: string;
  weight: number;            // 0.0–1.0 (all weights sum to 1.0)
  summary: string;           // e.g. "11/12 FK columns indexed"
  details: string[];         // detailed findings
  linkedCommand?: string;    // VS Code command to open relevant panel (for card click)
  actions?: IMetricAction[]; // actionable fix buttons shown on the card
}

export interface IRecommendation {
  severity: 'error' | 'warning' | 'info';
  message: string;
  metric: string;
  action?: IMetricAction;    // optional one-click fix action
}
