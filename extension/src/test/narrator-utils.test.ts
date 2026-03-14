import * as assert from 'assert';
import {
  capitalize, formatValue, singularize,
} from '../narrator';

describe('singularize', () => {
  it('handles trailing s', () => {
    assert.strictEqual(singularize('orders'), 'order');
    assert.strictEqual(singularize('users'), 'user');
    assert.strictEqual(singularize('items'), 'item');
  });

  it('handles ies -> y', () => {
    assert.strictEqual(singularize('categories'), 'category');
    assert.strictEqual(singularize('companies'), 'company');
  });

  it('handles es endings', () => {
    assert.strictEqual(singularize('classes'), 'class');
    assert.strictEqual(singularize('boxes'), 'box');
  });

  it('preserves non-plural words', () => {
    assert.strictEqual(singularize('data'), 'data');
    assert.strictEqual(singularize('status'), 'status');
    assert.strictEqual(singularize('bus'), 'bus');
  });

  it('handles short words', () => {
    assert.strictEqual(singularize('as'), 'as');
    assert.strictEqual(singularize('is'), 'is');
  });
});

describe('capitalize', () => {
  it('capitalizes first letter', () => {
    assert.strictEqual(capitalize('hello'), 'Hello');
    assert.strictEqual(capitalize('orders'), 'Orders');
  });

  it('handles empty string', () => {
    assert.strictEqual(capitalize(''), '');
  });

  it('handles already capitalized', () => {
    assert.strictEqual(capitalize('Hello'), 'Hello');
  });
});

describe('formatValue', () => {
  it('formats null', () => {
    assert.strictEqual(formatValue(null), 'NULL');
  });

  it('formats undefined', () => {
    assert.strictEqual(formatValue(undefined), '');
  });

  it('formats strings with quotes', () => {
    assert.strictEqual(formatValue('hello'), '"hello"');
  });

  it('formats numbers', () => {
    assert.strictEqual(formatValue(42), '42');
    assert.strictEqual(formatValue(3.14), '3.14');
  });

  it('formats booleans', () => {
    assert.strictEqual(formatValue(true), 'true');
    assert.strictEqual(formatValue(false), 'false');
  });
});
