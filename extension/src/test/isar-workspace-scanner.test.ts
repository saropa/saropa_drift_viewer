import * as assert from 'assert';
import {
  MARKER_RE,
  COLLECTION_COUNT_RE,
  EMBEDDED_COUNT_RE,
  formatDescription,
} from '../isar-gen/isar-workspace-scanner';
import type { IIsarFileInfo } from '../isar-gen/isar-workspace-scanner';

/** Dummy URI for IIsarFileInfo (not used in pure-logic tests). */
const DUMMY_URI = { fsPath: '/test.dart' } as IIsarFileInfo['uri'];

describe('IsarWorkspaceScanner', () => {
  describe('MARKER_RE', () => {
    it('should match @collection', () => {
      assert.ok(MARKER_RE.test('@collection'));
    });

    it('should match @Collection()', () => {
      assert.ok(MARKER_RE.test('@Collection()'));
    });

    it('should match @embedded', () => {
      assert.ok(MARKER_RE.test('@embedded'));
    });

    it('should match @Embedded()', () => {
      assert.ok(MARKER_RE.test('@Embedded()'));
    });

    it('should not match @Collection without parens', () => {
      assert.ok(!MARKER_RE.test('@Collection\nclass Foo'));
    });

    it('should not match plain text "collection"', () => {
      assert.ok(!MARKER_RE.test('collection'));
    });

    it('should match marker inside larger source text', () => {
      const src = 'import "isar.dart";\n\n@collection\nclass User {}';
      assert.ok(MARKER_RE.test(src));
    });
  });

  describe('COLLECTION_COUNT_RE', () => {
    it('should count multiple @collection annotations', () => {
      const src = '@collection\nclass A {}\n\n@collection\nclass B {}';
      const matches = src.match(COLLECTION_COUNT_RE) ?? [];
      assert.strictEqual(matches.length, 2);
    });

    it('should count mixed @collection and @Collection()', () => {
      const src = '@collection\nclass A {}\n\n@Collection()\nclass B {}';
      const matches = src.match(COLLECTION_COUNT_RE) ?? [];
      assert.strictEqual(matches.length, 2);
    });

    it('should return empty for no matches', () => {
      const matches = 'class Foo {}'.match(COLLECTION_COUNT_RE) ?? [];
      assert.strictEqual(matches.length, 0);
    });
  });

  describe('EMBEDDED_COUNT_RE', () => {
    it('should count @embedded annotations', () => {
      const src = '@embedded\nclass Addr {}\n\n@Embedded()\nclass Geo {}';
      const matches = src.match(EMBEDDED_COUNT_RE) ?? [];
      assert.strictEqual(matches.length, 2);
    });

    it('should not count @collection as embedded', () => {
      const src = '@collection\nclass User {}';
      const matches = src.match(EMBEDDED_COUNT_RE) ?? [];
      assert.strictEqual(matches.length, 0);
    });
  });

  describe('formatDescription', () => {
    it('should format single collection', () => {
      const info: IIsarFileInfo = {
        uri: DUMMY_URI, collectionCount: 1, embeddedCount: 0,
      };
      assert.strictEqual(formatDescription(info), '1 collection');
    });

    it('should pluralize multiple collections', () => {
      const info: IIsarFileInfo = {
        uri: DUMMY_URI, collectionCount: 3, embeddedCount: 0,
      };
      assert.strictEqual(formatDescription(info), '3 collections');
    });

    it('should format single embedded', () => {
      const info: IIsarFileInfo = {
        uri: DUMMY_URI, collectionCount: 0, embeddedCount: 1,
      };
      assert.strictEqual(formatDescription(info), '1 embedded');
    });

    it('should format both collections and embeddeds', () => {
      const info: IIsarFileInfo = {
        uri: DUMMY_URI, collectionCount: 2, embeddedCount: 1,
      };
      assert.strictEqual(
        formatDescription(info), '2 collections, 1 embedded',
      );
    });

    it('should return empty string for zero counts', () => {
      const info: IIsarFileInfo = {
        uri: DUMMY_URI, collectionCount: 0, embeddedCount: 0,
      };
      assert.strictEqual(formatDescription(info), '');
    });
  });
});
