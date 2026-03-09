import * as assert from 'assert';
import { levenshtein, findClosestMatches } from '../terminal/fuzzy-match';

describe('levenshtein', () => {
  it('should return 0 for identical strings', () => {
    assert.strictEqual(levenshtein('hello', 'hello'), 0);
  });

  it('should return string length for empty vs non-empty', () => {
    assert.strictEqual(levenshtein('', 'abc'), 3);
    assert.strictEqual(levenshtein('abc', ''), 3);
  });

  it('should return 0 for two empty strings', () => {
    assert.strictEqual(levenshtein('', ''), 0);
  });

  it('should handle single substitution', () => {
    assert.strictEqual(levenshtein('cat', 'bat'), 1);
  });

  it('should handle single insertion', () => {
    assert.strictEqual(levenshtein('cat', 'cats'), 1);
  });

  it('should handle single deletion', () => {
    assert.strictEqual(levenshtein('cats', 'cat'), 1);
  });

  it('should handle transposition (2 edits)', () => {
    assert.strictEqual(levenshtein('ab', 'ba'), 2);
  });

  it('should handle real typo: user_settigns → user_settings', () => {
    assert.strictEqual(levenshtein('user_settigns', 'user_settings'), 2);
  });

  it('should handle completely different strings', () => {
    assert.strictEqual(levenshtein('abc', 'xyz'), 3);
  });
});

describe('findClosestMatches', () => {
  const tables = ['users', 'orders', 'products', 'user_settings', 'categories'];

  it('should return exact match with distance 0', () => {
    const results = findClosestMatches('users', tables, 3);
    assert.strictEqual(results[0].name, 'users');
    assert.strictEqual(results[0].distance, 0);
  });

  it('should match case-insensitively', () => {
    const results = findClosestMatches('USERS', tables, 3);
    assert.strictEqual(results[0].name, 'users');
    assert.strictEqual(results[0].distance, 0);
  });

  it('should find close match for typo', () => {
    const results = findClosestMatches('user_settigns', tables, 3);
    assert.strictEqual(results[0].name, 'user_settings');
    assert.ok(results[0].distance <= 2);
  });

  it('should respect maxResults', () => {
    const results = findClosestMatches('x', tables, 2);
    assert.strictEqual(results.length, 2);
  });

  it('should sort by ascending distance', () => {
    const results = findClosestMatches('order', tables, 5);
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i].distance >= results[i - 1].distance);
    }
  });

  it('should handle empty candidates', () => {
    const results = findClosestMatches('users', [], 3);
    assert.strictEqual(results.length, 0);
  });
});
