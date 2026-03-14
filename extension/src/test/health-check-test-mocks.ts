/**
 * Shared mock API setup functions for health-check-runner tests.
 */

import * as sinon from 'sinon';

/** Mock a successful /api/health response. */
export function mockHealthOk(fetchStub: sinon.SinonStub): void {
  fetchStub.withArgs(sinon.match(/\/api\/health$/)).resolves({
    ok: true,
    json: async () => ({ ok: true }),
  });
}

/** Mock a failed /api/health response. */
export function mockHealthFail(fetchStub: sinon.SinonStub): void {
  fetchStub.withArgs(sinon.match(/\/api\/health$/)).rejects(
    new Error('connection refused'),
  );
}

/** Mock /api/index-suggestions with the given data. */
export function mockIndexSuggestions(fetchStub: sinon.SinonStub, data: any[]): void {
  fetchStub.withArgs(sinon.match(/\/api\/index-suggestions$/)).resolves({
    ok: true,
    json: async () => data,
  });
}

/** Mock /api/analytics/anomalies with the given data. */
export function mockAnomalies(fetchStub: sinon.SinonStub, data: any[]): void {
  fetchStub.withArgs(sinon.match(/\/api\/analytics\/anomalies$/)).resolves({
    ok: true,
    json: async () => ({ anomalies: data }),
  });
}

/** Mock a failed /api/index-suggestions response. */
export function mockIndexSuggestionsFail(fetchStub: sinon.SinonStub): void {
  fetchStub.withArgs(sinon.match(/\/api\/index-suggestions$/)).resolves({
    ok: false,
    status: 500,
  });
}

/** Mock a failed /api/analytics/anomalies response. */
export function mockAnomaliesFail(fetchStub: sinon.SinonStub): void {
  fetchStub.withArgs(sinon.match(/\/api\/analytics\/anomalies$/)).resolves({
    ok: false,
    status: 500,
  });
}

/** Mock /api/schema-metadata with the given tables. */
export function mockSchemaMetadata(fetchStub: sinon.SinonStub, tables: any[] = []): void {
  fetchStub.withArgs(sinon.match(/\/api\/schema-metadata$/)).resolves({
    ok: true,
    json: async () => tables,
  });
}

/** Mock /api/performance. */
export function mockPerformance(fetchStub: sinon.SinonStub): void {
  fetchStub.withArgs(sinon.match(/\/api\/performance$/)).resolves({
    ok: true,
    json: async () => ({ queries: [], totalQueries: 0, avgDuration: 0 }),
  });
}

/** Mock /api/size-analytics. */
export function mockSizeAnalytics(fetchStub: sinon.SinonStub): void {
  fetchStub.withArgs(sinon.match(/\/api\/size-analytics$/)).resolves({
    ok: true,
    json: async () => ({ tables: [], totalSize: 0 }),
  });
}

/** Mock /api/tables/.../fk-meta. */
export function mockTableFkMeta(fetchStub: sinon.SinonStub): void {
  fetchStub.withArgs(sinon.match(/\/api\/tables\/.*\/fk-meta$/)).resolves({
    ok: true,
    json: async () => [],
  });
}

/** Mock /api/tables/.../null-counts. */
export function mockNullCounts(fetchStub: sinon.SinonStub): void {
  fetchStub.withArgs(sinon.match(/\/api\/tables\/.*\/null-counts$/)).resolves({
    ok: true,
    json: async () => ({}),
  });
}

/** Mock /api/sql. */
export function mockSql(fetchStub: sinon.SinonStub): void {
  fetchStub.withArgs(sinon.match(/\/api\/sql$/)).resolves({
    ok: true,
    json: async () => ({ columns: ['result'], rows: [[0]] }),
  });
}

/** Mock all health-check-related APIs at once. */
export function mockAllHealthCheckApis(
  fetchStub: sinon.SinonStub,
  indexSuggestions: any[] = [],
  anomalies: any[] = [],
): void {
  mockHealthOk(fetchStub);
  mockSchemaMetadata(fetchStub, []);
  mockIndexSuggestions(fetchStub, indexSuggestions);
  mockAnomalies(fetchStub, anomalies);
  mockPerformance(fetchStub);
  mockSizeAnalytics(fetchStub);
  mockTableFkMeta(fetchStub);
  mockNullCounts(fetchStub);
  mockSql(fetchStub);
}
