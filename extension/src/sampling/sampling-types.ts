/** Shared types for the Data Sampling Explorer feature. */

export type SamplingMode = 'random' | 'stratified' | 'percentile' | 'cohort';

export interface ISamplingConfig {
  table: string;
  mode: SamplingMode;
  sampleSize: number;
  stratifyColumn?: string;
  percentileColumn?: string;
  percentileMin?: number;
  percentileMax?: number;
  cohortColumn?: string;
}

export interface ISamplingResult {
  mode: SamplingMode;
  totalRows: number;
  sampledRows: number;
  columns: string[];
  rows: Record<string, unknown>[];
  sql: string;
  durationMs: number;
  stats?: ICohortStats[];
}

export interface ICohortStats {
  cohortValue: string;
  count: number;
  percentage: number;
  numericStats?: {
    column: string;
    avg: number;
    min: number;
    max: number;
  };
  nullRate: number;
}
