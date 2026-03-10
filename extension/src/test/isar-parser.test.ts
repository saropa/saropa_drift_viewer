import * as assert from 'assert';
import { parseIsarCollections } from '../isar-gen/isar-parser';

describe('IsarParser', () => {
  it('should parse a simple @collection class', () => {
    const src = `
@collection
class User {
  Id id = Isar.autoIncrement;
  late String name;
  late int age;
}`;
    const result = parseIsarCollections(src, 'user.dart');
    assert.strictEqual(result.collections.length, 1);
    assert.strictEqual(result.collections[0].className, 'User');
    assert.strictEqual(result.collections[0].fileUri, 'user.dart');
    assert.strictEqual(result.collections[0].fields.length, 3);
  });

  it('should detect Id fields', () => {
    const src = `
@collection
class Item {
  Id id = Isar.autoIncrement;
  late String label;
}`;
    const result = parseIsarCollections(src, 'item.dart');
    const idField = result.collections[0].fields.find((f) => f.isId);
    assert.ok(idField);
    assert.strictEqual(idField.name, 'id');
    assert.strictEqual(idField.dartType, 'Id');
  });

  it('should parse nullable fields', () => {
    const src = `
@collection
class Post {
  Id id = Isar.autoIncrement;
  late String? subtitle;
  late int? rating;
}`;
    const result = parseIsarCollections(src, 'post.dart');
    const fields = result.collections[0].fields;
    const subtitle = fields.find((f) => f.name === 'subtitle');
    const rating = fields.find((f) => f.name === 'rating');
    assert.ok(subtitle?.isNullable);
    assert.ok(rating?.isNullable);
  });

  it('should skip @ignore fields', () => {
    const src = `
@collection
class Task {
  Id id = Isar.autoIncrement;
  late String title;
  @ignore
  late bool isSelected;
}`;
    const result = parseIsarCollections(src, 'task.dart');
    const ignored = result.collections[0].fields.find(
      (f) => f.name === 'isSelected',
    );
    assert.ok(ignored?.isIgnored);
  });

  it('should parse @Name annotations on fields', () => {
    const src = `
@collection
class Product {
  Id id = Isar.autoIncrement;
  @Name('product_title')
  late String title;
}`;
    const result = parseIsarCollections(src, 'product.dart');
    const title = result.collections[0].fields.find(
      (f) => f.name === 'title',
    );
    assert.strictEqual(title?.customName, 'product_title');
  });

  it('should parse IsarLink (single)', () => {
    const src = `
@collection
class Post {
  Id id = Isar.autoIncrement;
  late String title;
  final author = IsarLink<User>();
}`;
    const result = parseIsarCollections(src, 'post.dart');
    const links = result.collections[0].links;
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].propertyName, 'author');
    assert.strictEqual(links[0].targetCollection, 'User');
    assert.strictEqual(links[0].isMulti, false);
  });

  it('should parse IsarLinks (multi)', () => {
    const src = `
@collection
class Teacher {
  Id id = Isar.autoIncrement;
  late String name;
  final students = IsarLinks<Student>();
}`;
    const result = parseIsarCollections(src, 'teacher.dart');
    const links = result.collections[0].links;
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].propertyName, 'students');
    assert.strictEqual(links[0].targetCollection, 'Student');
    assert.strictEqual(links[0].isMulti, true);
  });

  it('should detect @Backlink annotations', () => {
    const src = `
@collection
class User {
  Id id = Isar.autoIncrement;
  @Backlink(to: 'author')
  final posts = IsarLinks<Post>();
}`;
    const result = parseIsarCollections(src, 'user.dart');
    const link = result.collections[0].links[0];
    assert.ok(link.isBacklink);
    assert.strictEqual(link.backlinkTo, 'author');
  });

  it('should parse @Index with unique', () => {
    const src = `
@collection
class User {
  Id id = Isar.autoIncrement;
  @Index(unique: true)
  late String email;
}`;
    const result = parseIsarCollections(src, 'user.dart');
    const indexes = result.collections[0].indexes;
    assert.strictEqual(indexes.length, 1);
    assert.ok(indexes[0].unique);
    assert.deepStrictEqual(indexes[0].properties, ['email']);
  });

  it('should parse composite indexes', () => {
    const src = `
@collection
class User {
  Id id = Isar.autoIncrement;
  @Index(composite: [CompositeIndex('lastName')])
  late String firstName;
  late String lastName;
}`;
    const result = parseIsarCollections(src, 'user.dart');
    const indexes = result.collections[0].indexes;
    assert.strictEqual(indexes.length, 1);
    assert.deepStrictEqual(
      indexes[0].properties,
      ['firstName', 'lastName'],
    );
  });

  it('should parse @enumerated annotation', () => {
    const src = `
@collection
class Task {
  Id id = Isar.autoIncrement;
  @enumerated
  late Priority priority;
}`;
    const result = parseIsarCollections(src, 'task.dart');
    const priority = result.collections[0].fields.find(
      (f) => f.name === 'priority',
    );
    assert.strictEqual(priority?.enumerated, 'ordinal');
  });

  it('should parse @Enumerated(EnumType.name)', () => {
    const src = `
@collection
class Config {
  Id id = Isar.autoIncrement;
  @Enumerated(EnumType.name)
  late Theme theme;
}`;
    const result = parseIsarCollections(src, 'config.dart');
    const theme = result.collections[0].fields.find(
      (f) => f.name === 'theme',
    );
    assert.strictEqual(theme?.enumerated, 'name');
  });

  it('should parse @embedded classes', () => {
    const src = `
@embedded
class Address {
  late String street;
  late String city;
}

@collection
class User {
  Id id = Isar.autoIncrement;
  late String name;
}`;
    const result = parseIsarCollections(src, 'user.dart');
    assert.strictEqual(result.embeddeds.length, 1);
    assert.strictEqual(result.embeddeds[0].className, 'Address');
    assert.strictEqual(result.embeddeds[0].fields.length, 2);
  });

  it('should handle multiple collections in one file', () => {
    const src = `
@collection
class Post {
  Id id = Isar.autoIncrement;
  late String title;
}

@collection
class Comment {
  Id id = Isar.autoIncrement;
  late String text;
}`;
    const result = parseIsarCollections(src, 'models.dart');
    assert.strictEqual(result.collections.length, 2);
    assert.strictEqual(result.collections[0].className, 'Post');
    assert.strictEqual(result.collections[1].className, 'Comment');
  });

  it('should skip non-Isar classes', () => {
    const src = `
class MyWidget extends StatelessWidget {
  final String title;
  MyWidget(this.title);
}

@collection
class User {
  Id id = Isar.autoIncrement;
  late String name;
}`;
    const result = parseIsarCollections(src, 'mixed.dart');
    assert.strictEqual(result.collections.length, 1);
    assert.strictEqual(result.collections[0].className, 'User');
  });

  it('should parse nullable Id field', () => {
    const src = `
@collection
class Item {
  Id? id;
  late String name;
}`;
    const result = parseIsarCollections(src, 'item.dart');
    const idField = result.collections[0].fields.find((f) => f.isId);
    assert.ok(idField);
    assert.ok(idField.isNullable);
  });

  it('should parse List types', () => {
    const src = `
@collection
class Article {
  Id id = Isar.autoIncrement;
  late List<String> tags;
  late List<int> scores;
}`;
    const result = parseIsarCollections(src, 'article.dart');
    const tags = result.collections[0].fields.find(
      (f) => f.name === 'tags',
    );
    assert.strictEqual(tags?.dartType, 'List<String>');
    const scores = result.collections[0].fields.find(
      (f) => f.name === 'scores',
    );
    assert.strictEqual(scores?.dartType, 'List<int>');
  });

  it('should handle @Collection() with parentheses', () => {
    const src = `
@Collection()
class Event {
  Id id = Isar.autoIncrement;
  late String title;
}`;
    const result = parseIsarCollections(src, 'event.dart');
    assert.strictEqual(result.collections.length, 1);
    assert.strictEqual(result.collections[0].className, 'Event');
  });
});
