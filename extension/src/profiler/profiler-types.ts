/** A named SQL query to run against the debug server. */
export interface IProfileQuery {
  name: string;
  sql: string;
}

/** A single histogram bucket (numeric value or text length). */
export interface IHistogramBucket {
  bucketMin: number;
  bucketMax: number;
  count: number;
  percentage: number;
}

/** A frequently-occurring value with its count. */
export interface ITopValue {
  value: string;
  count: number;
  percentage: number;
}

/** An extracted text pattern (e.g., email domain). */
export interface IPattern {
  pattern: string;
  count: number;
  percentage: number;
}

/** An anomaly detected in the column data. */
export interface IProfileAnomaly {
  message: string;
  severity: 'warning' | 'info';
}

/** Full statistical profile for a single column. */
export interface IColumnProfile {
  table: string;
  column: string;
  type: string;
  isNumeric: boolean;

  // Universal
  totalRows: number;
  nonNullCount: number;
  nullCount: number;
  nullPercentage: number;
  distinctCount: number;
  topValues: ITopValue[];

  // Numeric only
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  stdDev?: number;
  histogram?: IHistogramBucket[];
  outlierCount?: number;

  // Text only
  minLength?: number;
  maxLength?: number;
  avgLength?: number;
  emptyCount?: number;
  lengthHistogram?: IHistogramBucket[];
  patterns?: IPattern[];

  // Computed anomalies
  anomalies: IProfileAnomaly[];
}
