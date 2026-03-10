import * as assert from 'assert';
import { toDriftType } from '../migration-gen/dart-type-mapper';

describe('toDriftType', () => {
  it('should map INTEGER to DriftSqlType.int', () => {
    assert.strictEqual(toDriftType('INTEGER'), 'DriftSqlType.int');
  });

  it('should map TEXT to DriftSqlType.string', () => {
    assert.strictEqual(toDriftType('TEXT'), 'DriftSqlType.string');
  });

  it('should map REAL to DriftSqlType.double', () => {
    assert.strictEqual(toDriftType('REAL'), 'DriftSqlType.double');
  });

  it('should map BLOB to DriftSqlType.blob', () => {
    assert.strictEqual(toDriftType('BLOB'), 'DriftSqlType.blob');
  });

  it('should map BOOLEAN to DriftSqlType.bool', () => {
    assert.strictEqual(toDriftType('BOOLEAN'), 'DriftSqlType.bool');
  });

  it('should map DATETIME to DriftSqlType.dateTime', () => {
    assert.strictEqual(
      toDriftType('DATETIME'), 'DriftSqlType.dateTime',
    );
  });

  it('should map BIGINT to DriftSqlType.bigInt', () => {
    assert.strictEqual(toDriftType('BIGINT'), 'DriftSqlType.bigInt');
  });

  it('should be case-insensitive', () => {
    assert.strictEqual(toDriftType('integer'), 'DriftSqlType.int');
    assert.strictEqual(toDriftType('Text'), 'DriftSqlType.string');
    assert.strictEqual(toDriftType('real'), 'DriftSqlType.double');
  });

  it('should fall back to DriftSqlType.string for unknown types', () => {
    assert.strictEqual(
      toDriftType('VARCHAR'), 'DriftSqlType.string',
    );
    assert.strictEqual(
      toDriftType('UNKNOWN'), 'DriftSqlType.string',
    );
  });
});
