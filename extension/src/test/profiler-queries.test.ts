import * as assert from 'assert';
import {
  buildProfileQueries,
  assembleProfile,
  isNumericType,
} from '../profiler/profiler-queries';

describe('isNumericType', () => {
  it('should match all numeric type names (case-insensitive)', () => {
    const numeric = [
      'INTEGER', 'REAL', 'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC',
      'BIGINT', 'integer', 'Real', 'float',
    ];
    for (const t of numeric) {
      assert.strictEqual(isNumericType(t), true, `${t} should be numeric`);
    }
  });

  it('should not match non-numeric types', () => {
    for (const t of ['TEXT', 'BLOB', '']) {
      assert.strictEqual(isNumericType(t), false, `'${t}' should not be numeric`);
    }
  });
});

describe('buildProfileQueries', () => {
  it('should always include summary and topValues', () => {
    const queries = buildProfileQueries('users', 'name', 'TEXT');
    const names = queries.map((q) => q.name);
    assert.ok(names.includes('summary'));
    assert.ok(names.includes('topValues'));
  });

  it('should include numeric queries for INTEGER', () => {
    const queries = buildProfileQueries('users', 'age', 'INTEGER');
    const names = queries.map((q) => q.name);
    assert.ok(names.includes('numericStats'));
    assert.ok(names.includes('median'));
    assert.ok(names.includes('histogram'));
    assert.ok(names.includes('outliers'));
  });

  it('should include numeric queries for REAL', () => {
    const queries = buildProfileQueries('data', 'score', 'REAL');
    const names = queries.map((q) => q.name);
    assert.ok(names.includes('numericStats'));
    assert.ok(names.includes('median'));
  });

  it('should include text queries for TEXT', () => {
    const queries = buildProfileQueries('users', 'email', 'TEXT');
    const names = queries.map((q) => q.name);
    assert.ok(names.includes('textStats'));
    assert.ok(names.includes('lengthHistogram'));
    assert.ok(names.includes('patterns'));
  });

  it('should treat BLOB as non-numeric', () => {
    const queries = buildProfileQueries('files', 'data', 'BLOB');
    const names = queries.map((q) => q.name);
    assert.ok(names.includes('textStats'));
    assert.ok(!names.includes('numericStats'));
  });

  it('should return 6 queries for numeric columns', () => {
    const queries = buildProfileQueries('t', 'c', 'INTEGER');
    assert.strictEqual(queries.length, 6);
  });

  it('should return 5 queries for text columns', () => {
    const queries = buildProfileQueries('t', 'c', 'TEXT');
    assert.strictEqual(queries.length, 5);
  });

  it('should quote table and column names in SQL', () => {
    const queries = buildProfileQueries('my table', 'my col', 'TEXT');
    for (const q of queries) {
      assert.ok(
        q.sql.includes('"my table"'),
        `query ${q.name} should quote table: ${q.sql}`,
      );
      assert.ok(
        q.sql.includes('"my col"'),
        `query ${q.name} should quote column: ${q.sql}`,
      );
    }
  });

  it('should escape double-quotes in identifiers', () => {
    const queries = buildProfileQueries('tab"le', 'co"l', 'INTEGER');
    for (const q of queries) {
      assert.ok(
        q.sql.includes('"tab""le"'),
        `query ${q.name} should escape table quotes`,
      );
      assert.ok(
        q.sql.includes('"co""l"'),
        `query ${q.name} should escape column quotes`,
      );
    }
  });

  it('should generate valid SQL keywords in summary', () => {
    const queries = buildProfileQueries('t', 'c', 'TEXT');
    const summary = queries.find((q) => q.name === 'summary');
    assert.ok(summary);
    assert.ok(summary.sql.includes('COUNT(*)'));
    assert.ok(summary.sql.includes('COUNT(DISTINCT'));
  });
});

describe('assembleProfile', () => {
  it('should assemble basic summary from results', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[100, 95, 5, 42]]);
    results.set('topValues', []);

    const profile = assembleProfile('users', 'age', 'INTEGER', results);
    assert.strictEqual(profile.totalRows, 100);
    assert.strictEqual(profile.nonNullCount, 95);
    assert.strictEqual(profile.nullCount, 5);
    assert.strictEqual(profile.distinctCount, 42);
  });

  it('should compute null percentage correctly', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[200, 160, 40, 10]]);
    results.set('topValues', []);

    const profile = assembleProfile('t', 'c', 'TEXT', results);
    assert.strictEqual(profile.nullPercentage, 20);
  });

  it('should handle zero total rows', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[0, 0, 0, 0]]);
    results.set('topValues', []);

    const profile = assembleProfile('t', 'c', 'TEXT', results);
    assert.strictEqual(profile.nullPercentage, 0);
    assert.strictEqual(profile.totalRows, 0);
  });

  it('should handle empty results map gracefully', () => {
    const results = new Map<string, unknown[][]>();
    const profile = assembleProfile('t', 'c', 'INTEGER', results);
    assert.strictEqual(profile.totalRows, 0);
    assert.strictEqual(profile.nonNullCount, 0);
    assert.deepStrictEqual(profile.topValues, []);
  });

  it('should compute stdDev from variance', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[100, 100, 0, 10]]);
    results.set('topValues', []);
    results.set('numericStats', [[1, 100, 50, 25]]);

    const profile = assembleProfile('t', 'c', 'INTEGER', results);
    assert.strictEqual(profile.stdDev, 5);
  });

  it('should handle negative variance (floating point)', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[10, 10, 0, 1]]);
    results.set('topValues', []);
    results.set('numericStats', [[5, 5, 5, -0.0001]]);

    const profile = assembleProfile('t', 'c', 'INTEGER', results);
    assert.strictEqual(profile.stdDev, 0);
  });

  it('should parse top values with percentages', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[100, 80, 20, 5]]);
    results.set('topValues', [
      ['apple', 30],
      ['banana', 20],
    ]);

    const profile = assembleProfile('t', 'c', 'TEXT', results);
    assert.strictEqual(profile.topValues.length, 2);
    assert.strictEqual(profile.topValues[0].value, 'apple');
    assert.strictEqual(profile.topValues[0].count, 30);
    assert.strictEqual(profile.topValues[0].percentage, 37.5);
  });

  it('should parse histogram buckets', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[100, 100, 0, 50]]);
    results.set('topValues', []);
    results.set('numericStats', [[1, 10, 5, 4]]);
    results.set('median', [[5]]);
    results.set('histogram', [
      [0, 40, 1, 3],
      [1, 60, 4, 10],
    ]);
    results.set('outliers', [[0]]);

    const profile = assembleProfile('t', 'c', 'INTEGER', results);
    assert.strictEqual(profile.histogram!.length, 2);
    assert.strictEqual(profile.histogram![0].count, 40);
    assert.strictEqual(profile.histogram![0].percentage, 40);
    assert.strictEqual(profile.histogram![1].bucketMin, 4);
  });

  it('should add null anomaly when nulls exceed 5%', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[100, 90, 10, 5]]);
    results.set('topValues', []);

    const profile = assembleProfile('t', 'c', 'TEXT', results);
    assert.ok(profile.anomalies.length > 0);
    assert.strictEqual(profile.anomalies[0].severity, 'warning');
    assert.ok(profile.anomalies[0].message.includes('10.0%'));
  });

  it('should not add null anomaly when nulls at 5%', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[100, 95, 5, 10]]);
    results.set('topValues', []);

    const profile = assembleProfile('t', 'c', 'TEXT', results);
    const nullAnomalies = profile.anomalies.filter(
      (a) => a.message.includes('NULL'),
    );
    assert.strictEqual(nullAnomalies.length, 0);
  });

  it('should add outlier anomaly for numeric columns', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[100, 100, 0, 50]]);
    results.set('topValues', []);
    results.set('numericStats', [[1, 100, 50, 100]]);
    results.set('median', [[50]]);
    results.set('histogram', []);
    results.set('outliers', [[3]]);

    const profile = assembleProfile('t', 'c', 'INTEGER', results);
    const outlierAnomalies = profile.anomalies.filter(
      (a) => a.message.includes('outlier'),
    );
    assert.strictEqual(outlierAnomalies.length, 1);
    assert.strictEqual(outlierAnomalies[0].severity, 'info');
    assert.ok(outlierAnomalies[0].message.includes('3'));
  });

  it('should not add outlier anomaly when count is 0', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[100, 100, 0, 50]]);
    results.set('topValues', []);
    results.set('numericStats', [[1, 10, 5, 4]]);
    results.set('median', [[5]]);
    results.set('histogram', []);
    results.set('outliers', [[0]]);

    const profile = assembleProfile('t', 'c', 'INTEGER', results);
    const outlierAnomalies = profile.anomalies.filter(
      (a) => a.message.includes('outlier'),
    );
    assert.strictEqual(outlierAnomalies.length, 0);
  });

  it('should set isNumeric based on type', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[0, 0, 0, 0]]);
    results.set('topValues', []);

    const numProfile = assembleProfile('t', 'c', 'INTEGER', results);
    assert.strictEqual(numProfile.isNumeric, true);

    const textProfile = assembleProfile('t', 'c', 'TEXT', results);
    assert.strictEqual(textProfile.isNumeric, false);
  });

  it('should parse text stats', () => {
    const results = new Map<string, unknown[][]>();
    results.set('summary', [[50, 48, 2, 40]]);
    results.set('topValues', []);
    results.set('textStats', [[3, 100, 25.5, 2]]);
    results.set('lengthHistogram', []);
    results.set('patterns', [['@gmail.com', 20]]);

    const profile = assembleProfile('t', 'c', 'TEXT', results);
    assert.strictEqual(profile.minLength, 3);
    assert.strictEqual(profile.maxLength, 100);
    assert.strictEqual(profile.avgLength, 25.5);
    assert.strictEqual(profile.emptyCount, 2);
    assert.strictEqual(profile.patterns!.length, 1);
    assert.strictEqual(profile.patterns![0].pattern, '@gmail.com');
  });
});
