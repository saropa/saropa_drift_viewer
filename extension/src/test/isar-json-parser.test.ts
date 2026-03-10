import * as assert from 'assert';
import { parseIsarJsonSchema } from '../isar-gen/isar-json-parser';

describe('IsarJsonParser', () => {
  it('should parse a minimal collection', () => {
    const json = JSON.stringify({
      name: 'User',
      properties: [
        { name: 'name', type: 7 },
        { name: 'age', type: 2 },
      ],
    });
    const result = parseIsarJsonSchema(json);
    assert.strictEqual(result.collections.length, 1);
    assert.strictEqual(result.collections[0].className, 'User');
    // id + name + age
    assert.strictEqual(result.collections[0].fields.length, 3);
  });

  it('should add Id field if missing', () => {
    const json = JSON.stringify({
      name: 'Item',
      properties: [{ name: 'label', type: 7 }],
    });
    const result = parseIsarJsonSchema(json);
    const idField = result.collections[0].fields.find((f) => f.isId);
    assert.ok(idField);
    assert.strictEqual(idField.dartType, 'Id');
  });

  it('should not duplicate Id if already present', () => {
    const json = JSON.stringify({
      name: 'Item',
      properties: [
        { name: 'id', type: 2 },
        { name: 'label', type: 7 },
      ],
    });
    const result = parseIsarJsonSchema(json);
    const ids = result.collections[0].fields.filter((f) => f.isId);
    assert.strictEqual(ids.length, 1);
  });

  it('should map property types correctly', () => {
    const json = JSON.stringify({
      name: 'Mixed',
      properties: [
        { name: 'flag', type: 0 },    // bool
        { name: 'count', type: 2 },   // int
        { name: 'score', type: 5 },   // double
        { name: 'date', type: 6 },    // DateTime
        { name: 'title', type: 7 },   // String
      ],
    });
    const result = parseIsarJsonSchema(json);
    const fields = result.collections[0].fields.filter((f) => !f.isId);
    assert.strictEqual(fields[0].dartType, 'bool');
    assert.strictEqual(fields[1].dartType, 'int');
    assert.strictEqual(fields[2].dartType, 'double');
    assert.strictEqual(fields[3].dartType, 'DateTime');
    assert.strictEqual(fields[4].dartType, 'String');
  });

  it('should parse indexes', () => {
    const json = JSON.stringify({
      name: 'User',
      properties: [{ name: 'email', type: 7 }],
      indexes: [{
        unique: true,
        properties: [{ name: 'email', caseSensitive: true }],
      }],
    });
    const result = parseIsarJsonSchema(json);
    assert.strictEqual(result.collections[0].indexes.length, 1);
    assert.ok(result.collections[0].indexes[0].unique);
  });

  it('should parse links', () => {
    const json = JSON.stringify({
      name: 'Post',
      properties: [{ name: 'title', type: 7 }],
      links: [{ name: 'author', target: 'User' }],
    });
    const result = parseIsarJsonSchema(json);
    assert.strictEqual(result.collections[0].links.length, 1);
    assert.strictEqual(
      result.collections[0].links[0].targetCollection,
      'User',
    );
  });

  it('should parse array of collections', () => {
    const json = JSON.stringify([
      { name: 'User', properties: [] },
      { name: 'Post', properties: [] },
    ]);
    const result = parseIsarJsonSchema(json);
    assert.strictEqual(result.collections.length, 2);
  });

  it('should reject invalid JSON', () => {
    assert.throws(
      () => parseIsarJsonSchema('not json'),
      /Invalid JSON/,
    );
  });

  it('should reject schema without name', () => {
    assert.throws(
      () => parseIsarJsonSchema(JSON.stringify({ properties: [] })),
      /Missing "name"/,
    );
  });

  it('should return empty embeddeds', () => {
    const json = JSON.stringify({ name: 'User', properties: [] });
    const result = parseIsarJsonSchema(json);
    assert.strictEqual(result.embeddeds.length, 0);
  });
});
