import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';

import 'package:saropa_drift_viewer/saropa_drift_viewer.dart';

void main() {
  test('start with enabled: false is a no-op and does not throw', () async {
    await DriftDebugServer.start(
      query: (_) async => <Map<String, dynamic>>[],
      enabled: false,
    );
  });

  test('DriftDebugErrorLogger callbacks never throw', () {
    final log = DriftDebugErrorLogger.logCallback(prefix: 'Test');
    final error = DriftDebugErrorLogger.errorCallback(prefix: 'Test');

    expect(() => log('message'), returnsNormally);
    expect(
      () => error(Exception('test'), StackTrace.current),
      returnsNormally,
    );
  });

  test('DriftDebugErrorLogger.callbacks returns both callbacks', () {
    final c = DriftDebugErrorLogger.callbacks(prefix: 'Test');
    expect(c.log, isNotNull);
    expect(c.error, isNotNull);
    expect(() => c.log('x'), returnsNormally);
    expect(
      () => c.error(Exception('e'), StackTrace.current),
      returnsNormally,
    );
  });

  test(
      'DriftDebugErrorLogger.logCallback with empty prefix and empty message does not throw',
      () {
    final log = DriftDebugErrorLogger.logCallback(prefix: '');
    expect(() => log(''), returnsNormally);
  });

  test('DriftDebugErrorLogger.errorCallback with empty prefix does not throw',
      () {
    final error = DriftDebugErrorLogger.errorCallback(prefix: '');
    expect(
      () => error(Exception('e'), StackTrace.current),
      returnsNormally,
    );
  });

  test('stop when server not started is no-op and does not throw', () async {
    await DriftDebugServer.stop();
  });

  group('param validation', () {
    test('start with port -1 throws ArgumentError and server is not running',
        () async {
      expect(
        DriftDebugServer.start(
          query: (_) async => <Map<String, dynamic>>[],
          enabled: true,
          port: -1,
        ),
        throwsA(isA<ArgumentError>().having(
          (e) => e.message,
          'message',
          contains('Port must be'),
        )),
      );
      expect(DriftDebugServer.port, isNull);
    });

    test('start with port 70000 throws ArgumentError and server is not running',
        () async {
      expect(
        DriftDebugServer.start(
          query: (_) async => <Map<String, dynamic>>[],
          enabled: true,
          port: 70000,
        ),
        throwsA(isA<ArgumentError>()),
      );
      expect(DriftDebugServer.port, isNull);
    });

    test('start with only basicAuthUser (no password) throws ArgumentError',
        () async {
      expect(
        DriftDebugServer.start(
          query: (_) async => <Map<String, dynamic>>[],
          enabled: true,
          port: 0,
          basicAuthUser: 'user',
          basicAuthPassword: null,
        ),
        throwsA(isA<ArgumentError>().having(
          (e) => e.message,
          'message',
          contains('Basic auth requires both'),
        )),
      );
    });

    test('start with only basicAuthPassword (no user) throws ArgumentError',
        () async {
      expect(
        DriftDebugServer.start(
          query: (_) async => <Map<String, dynamic>>[],
          enabled: true,
          port: 0,
          basicAuthUser: null,
          basicAuthPassword: 'pass',
        ),
        throwsA(isA<ArgumentError>()),
      );
    });
  });

  group('defensive behavior: query and edge cases', () {
    tearDown(() async {
      await DriftDebugServer.stop();
    });

    test('when query throws, GET /api/tables returns 500 and JSON error',
        () async {
      await DriftDebugServer.stop();
      await DriftDebugServer.start(
        query: (_) async => throw Exception('query failed'),
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/tables');
        final resp = await req.close();
        final body = await resp.transform(utf8.decoder).join();
        expect(
          resp.statusCode,
          HttpStatus.internalServerError,
          reason:
              'Query throws should yield 500; got ${resp.statusCode} body: $body',
        );
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['error'], isNotNull);
        expect(decoded['error'].toString(), contains('query failed'));
      } finally {
        client.close();
      }
    });

    // Server normalizes null/non-List via _normalizeRows; empty list yields 200 + [].
    test(
        'when query returns empty list, GET /api/tables returns 200 with empty list',
        () async {
      await DriftDebugServer.start(
        query: (_) async => <Map<String, dynamic>>[],
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/tables');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as List<dynamic>;
        expect(decoded, isEmpty);
      } finally {
        client.close();
      }
    });

    test('GET /api/table/unknown_table returns 400 and JSON error', () async {
      await DriftDebugServer.start(
        query: (String sql) async {
          if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
            return [
              {'name': 'items'}
            ];
          }
          return <Map<String, dynamic>>[];
        },
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req =
            await client.get('localhost', port!, '/api/table/unknown_table');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.badRequest);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['error'], contains('Unknown table'));
        expect(decoded['error'], contains('unknown_table'));
      } finally {
        client.close();
      }
    });

    test('limit=0 or negative uses default limit, offset negative uses 0',
        () async {
      await DriftDebugServer.start(
        query: (String sql) async {
          if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
            return [
              {'name': 'items'}
            ];
          }
          if (sql.contains('SELECT * FROM "items"')) {
            return [
              {'id': 1, 'name': 'a'},
              {'id': 2, 'name': 'b'},
            ];
          }
          return <Map<String, dynamic>>[];
        },
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final reqLimit0 = await client.getUrl(Uri.parse(
            'http://localhost:$port/api/table/items?limit=0&offset=0'));
        final resp0 = await reqLimit0.close();
        expect(resp0.statusCode, HttpStatus.ok);
        final body0 = await resp0.transform(utf8.decoder).join();
        final list0 = jsonDecode(body0) as List<dynamic>;
        expect(list0.length, 2);

        final reqOffsetNeg = await client.getUrl(Uri.parse(
            'http://localhost:$port/api/table/items?limit=10&offset=-5'));
        final respNeg = await reqOffsetNeg.close();
        expect(respNeg.statusCode, HttpStatus.ok);
        final bodyNeg = await respNeg.transform(utf8.decoder).join();
        final listNeg = jsonDecode(bodyNeg) as List<dynamic>;
        expect(listNeg.length, 2);
      } finally {
        client.close();
      }
    });

    test(
        'getDatabaseBytes returning empty list returns 200 with zero-length body',
        () async {
      await DriftDebugServer.start(
        query: (String sql) async {
          if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
            return [
              {'name': 'items'}
            ];
          }
          return <Map<String, dynamic>>[];
        },
        enabled: true,
        port: 0,
        getDatabaseBytes: () async => <int>[],
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/database');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        final body = await resp.toList();
        final bytes = body.expand((b) => b).toList();
        expect(bytes, isEmpty);
      } finally {
        client.close();
      }
    });
  });

  group('export endpoints', () {
    late Future<List<Map<String, dynamic>>> Function(String sql) mockQuery;

    setUp(() {
      mockQuery = (String sql) async {
        if (sql.contains('ORDER BY type, name')) {
          return [
            {
              'type': 'table',
              'name': 'items',
              'sql': 'CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT);',
            },
          ];
        }
        if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
          return [
            {'name': 'items'}
          ];
        }
        if (sql.contains('COUNT(*)') && sql.contains('items')) {
          return [
            {'c': 2}
          ];
        }
        if (sql.contains('SELECT * FROM "items"')) {
          return [
            {'id': 1, 'name': 'first'},
            {'id': 2, 'name': "second's"},
          ];
        }
        if (sql.contains('PRAGMA table_info("items")')) {
          return [
            {
              'cid': 0,
              'name': 'id',
              'type': 'INTEGER',
              'notnull': 1,
              'dflt_value': null,
              'pk': 1
            },
            {
              'cid': 1,
              'name': 'name',
              'type': 'TEXT',
              'notnull': 0,
              'dflt_value': null,
              'pk': 0
            },
          ];
        }
        if (sql.contains('SELECT') &&
            !sql.contains('INSERT') &&
            !sql.contains('sqlite_master')) {
          return [
            {'id': 1, 'name': 'first'}
          ];
        }
        return <Map<String, dynamic>>[];
      };
    });

    tearDown(() async {
      await DriftDebugServer.stop();
    });

    test('GET /api/schema returns schema SQL without data', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/schema');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        final body = await resp.transform(utf8.decoder).join();
        expect(body, contains('CREATE TABLE items'));
        expect(body, isNot(contains('INSERT INTO')));
        expect(
            resp.headers.value('content-disposition'), contains('schema.sql'));
      } finally {
        client.close();
      }
    });

    test('GET /api/schema/diagram returns tables, columns, and foreign keys',
        () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/schema/diagram');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        expect(
            resp.headers.value('content-type'), contains('application/json'));
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded, contains('tables'));
        expect(decoded, contains('foreignKeys'));

        final tables = decoded['tables'] as List<dynamic>;
        expect(tables, isNotEmpty);
        final first = tables.first as Map<String, dynamic>;
        expect(first, containsPair('name', 'items'));
        final columns = first['columns'] as List<dynamic>;
        expect(columns.map((c) => (c as Map)['name']).toList(), ['id', 'name']);

        final fks = decoded['foreignKeys'] as List<dynamic>;
        expect(fks, isEmpty);
      } finally {
        client.close();
      }
    });

    test('GET /api/schema/metadata returns tables with columns, types, pk, and rowCount',
        () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req =
            await client.get('localhost', port!, '/api/schema/metadata');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        expect(
            resp.headers.value('content-type'), contains('application/json'));
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded, contains('tables'));

        final tables = decoded['tables'] as List<dynamic>;
        expect(tables, hasLength(1));

        final table = tables.first as Map<String, dynamic>;
        expect(table, containsPair('name', 'items'));
        expect(table, contains('rowCount'));
        expect(table['rowCount'], 2);

        final columns = table['columns'] as List<dynamic>;
        expect(columns, hasLength(2));

        final idCol = columns[0] as Map<String, dynamic>;
        expect(idCol, containsPair('name', 'id'));
        expect(idCol, containsPair('type', 'INTEGER'));
        expect(idCol, containsPair('pk', true));

        final nameCol = columns[1] as Map<String, dynamic>;
        expect(nameCol, containsPair('name', 'name'));
        expect(nameCol, containsPair('type', 'TEXT'));
        expect(nameCol, containsPair('pk', false));
      } finally {
        client.close();
      }
    });

    test('GET /api/dump returns schema plus INSERT statements', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/dump');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        final body = await resp.transform(utf8.decoder).join();
        expect(body, contains('CREATE TABLE items'));
        expect(body, contains('INSERT INTO "items"'));
        expect(body, contains("'first'"));
        expect(body, contains("'second''s'"));
        expect(resp.headers.value('content-disposition'), contains('dump.sql'));
      } finally {
        client.close();
      }
    });

    test('GET /api/table/<name> with limit and offset returns JSON array',
        () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.getUrl(Uri.parse(
            'http://localhost:$port/api/table/items?limit=10&offset=0'));
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        expect(
            resp.headers.value('content-type'), contains('application/json'));
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as List<dynamic>;
        expect(decoded, hasLength(2));
        expect(decoded[0], containsPair('name', 'first'));
      } finally {
        client.close();
      }
    });

    test('GET /api/table/<name>/count returns JSON with count', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req =
            await client.get('localhost', port!, '/api/table/items/count');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        expect(
            resp.headers.value('content-type'), contains('application/json'));
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded, containsPair('count', 2));
      } finally {
        client.close();
      }
    });

    test('GET /api/table/<name>/columns returns column names', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req =
            await client.get('localhost', port!, '/api/table/items/columns');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as List<dynamic>;
        expect(decoded, ['id', 'name']);
      } finally {
        client.close();
      }
    });

    test('POST /api/sql rejects body when Content-Type is not application/json',
        () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.post('localhost', port!, '/api/sql');
        req.headers.contentType = ContentType.text;
        req.write(jsonEncode(<String, String>{'sql': 'SELECT 1'}));
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.badRequest);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['error'], contains('Content-Type'));
      } finally {
        client.close();
      }
    });

    test('POST /api/sql runs read-only SQL and returns rows', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.post('localhost', port!, '/api/sql');
        req.headers.contentType = ContentType.json;
        req.write(jsonEncode(<String, String>{'sql': 'SELECT 1'}));
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded.containsKey('rows'), isTrue);
        expect(decoded['rows'] as List, isNotEmpty);
      } finally {
        client.close();
      }
    });

    test('POST /api/sql accepts SELECT with keyword inside string literal',
        () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.post('localhost', port!, '/api/sql');
        req.headers.contentType = ContentType.json;
        req.write(jsonEncode(<String, String>{"sql": "SELECT 'INSERT' AS x"}));
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded.containsKey('rows'), isTrue);
      } finally {
        client.close();
      }
    });

    test('POST /api/sql rejects non-SELECT SQL', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.post('localhost', port!, '/api/sql');
        req.headers.contentType = ContentType.json;
        req.write(jsonEncode(<String, String>{
          'sql': 'INSERT INTO items (name) VALUES (\'x\')'
        }));
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.badRequest);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['error'], contains('read-only'));
      } finally {
        client.close();
      }
    });

    test('POST /api/sql rejects multi-statement SQL', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.post('localhost', port!, '/api/sql');
        req.headers.contentType = ContentType.json;
        req.write(jsonEncode(<String, String>{'sql': 'SELECT 1; SELECT 2'}));
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.badRequest);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['error'], contains('read-only'));
      } finally {
        client.close();
      }
    });

    test('POST /api/sql rejects WITH ... INSERT', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.post('localhost', port!, '/api/sql');
        req.headers.contentType = ContentType.json;
        req.write(jsonEncode(<String, String>{
          'sql':
              'WITH x AS (SELECT 1) INSERT INTO items (name) SELECT \'a\' FROM x'
        }));
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.badRequest);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['error'], contains('read-only'));
      } finally {
        client.close();
      }
    });

    test('GET / serves HTML with SQL history UI', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        expect(resp.headers.value('content-type'), contains('text/html'));
        final body = await resp.transform(utf8.decoder).join();
        expect(body, contains('id="sql-history"'));
        expect(body, contains("drift-viewer-sql-history"));
      } finally {
        client.close();
      }
    });

    test(
        'GET /api/generation returns JSON with generation number for live refresh',
        () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/generation');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded.containsKey('generation'), isTrue);
        expect(decoded['generation'], isA<int>());
        expect((decoded['generation'] as int), greaterThanOrEqualTo(0));
      } finally {
        client.close();
      }
    });

    test(
        'GET /api/generation?since=N accepts query param and returns same format',
        () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        // since=-1 ensures server skips long-poll (generation >= 0 > -1) and returns immediately.
        final req = await client.getUrl(
            Uri.parse('http://localhost:$port/api/generation?since=-1'));
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded.containsKey('generation'), isTrue);
        expect(decoded['generation'], isA<int>());
      } finally {
        client.close();
      }
    });
  });

  group('secure dev tunnel auth', () {
    late Future<List<Map<String, dynamic>>> Function(String sql) mockQuery;

    setUp(() {
      mockQuery = (String sql) async {
        if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
          return [
            {'name': 'items'}
          ];
        }
        return <Map<String, dynamic>>[];
      };
    });

    tearDown(() async {
      await DriftDebugServer.stop();
    });

    test('request without auth gets 401 when authToken is set', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
        authToken: 'secret-token',
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/tables');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.unauthorized);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['error'], contains('Authentication required'));
      } finally {
        client.close();
      }
    });

    test('request with Bearer token succeeds when authToken is set', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
        authToken: 'secret-token',
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/tables');
        req.headers.set('Authorization', 'Bearer secret-token');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
      } finally {
        client.close();
      }
    });

    test('request with query param token gets 401 (token in URL not supported)',
        () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
        authToken: 'secret-token',
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.getUrl(
          Uri.parse('http://localhost:$port/api/tables?token=secret-token'),
        );
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.unauthorized);
      } finally {
        client.close();
      }
    });

    test('request with Basic auth succeeds when basicAuthUser/Password set',
        () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
        basicAuthUser: 'dev',
        basicAuthPassword: 'pass',
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final credentials = base64.encode(utf8.encode('dev:pass'));
      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/tables');
        req.headers.set('Authorization', 'Basic $credentials');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
      } finally {
        client.close();
      }
    });

    test('request without auth gets 401 when only Basic auth is set', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
        basicAuthUser: 'dev',
        basicAuthPassword: 'pass',
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/health');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.unauthorized);
      } finally {
        client.close();
      }
    });

    test('empty authToken does not require auth (treated as disabled)',
        () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
        authToken: '',
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/tables');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
      } finally {
        client.close();
      }
    });
  });

  group('GET /api/database (raw SQLite file)', () {
    late Future<List<Map<String, dynamic>>> Function(String sql) mockQuery;

    setUp(() {
      mockQuery = (String sql) async {
        if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
          return [
            {'name': 'items'}
          ];
        }
        return <Map<String, dynamic>>[];
      };
    });

    tearDown(() async {
      await DriftDebugServer.stop();
    });

    test('returns 501 when getDatabaseBytes not provided', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/database');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.notImplemented);
        expect(
            resp.headers.value('content-type'), contains('application/json'));
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['error'], contains('getDatabaseBytes'));
      } finally {
        client.close();
      }
    });

    test('returns 200 and database bytes when getDatabaseBytes provided',
        () async {
      const sqliteHeader = [
        0x53,
        0x51,
        0x4c,
        0x69,
        0x74,
        0x65
      ]; // "SQLite" magic
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
        getDatabaseBytes: () async =>
            List<int>.from(sqliteHeader)..addAll(List.filled(100, 0)),
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/database');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        expect(resp.headers.value('content-disposition'),
            contains('database.sqlite'));
        expect(resp.headers.value('content-type'), contains('octet-stream'));
        final body = await resp.toList();
        final bytes = body.expand((b) => b).toList();
        expect(bytes, hasLength(106));
        expect(bytes.take(6).toList(), sqliteHeader);
      } finally {
        client.close();
      }
    });
  });

  group('Snapshot / time travel', () {
    late Future<List<Map<String, dynamic>>> Function(String sql) mockQuery;

    setUp(() {
      mockQuery = (String sql) async {
        if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
          return [
            {'name': 'items'}
          ];
        }
        if (sql.contains('COUNT(*)') && sql.contains('items')) {
          return [
            {'c': 2}
          ];
        }
        if (sql.contains('SELECT * FROM "items"')) {
          return [
            {'id': 1, 'name': 'a'},
            {'id': 2, 'name': 'b'},
          ];
        }
        return <Map<String, dynamic>>[];
      };
    });

    tearDown(() async {
      await DriftDebugServer.stop();
    });

    test('POST /api/snapshot captures state and GET returns metadata',
        () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);
      final p = port!;

      final client = HttpClient();
      try {
        final postReq = await client.post('localhost', p, '/api/snapshot');
        final postResp = await postReq.close();
        expect(postResp.statusCode, HttpStatus.ok);
        final postBody = await postResp.transform(utf8.decoder).join();
        final postData = jsonDecode(postBody) as Map<String, dynamic>;
        expect(postData['id'], isNotNull);
        expect(postData['tables'], ['items']);
        expect(postData['tableCount'], 1);

        final getReq = await client.get('localhost', p, '/api/snapshot');
        final getResp = await getReq.close();
        expect(getResp.statusCode, HttpStatus.ok);
        final getBody = await getResp.transform(utf8.decoder).join();
        final getData = jsonDecode(getBody) as Map<String, dynamic>;
        expect(getData['snapshot'], isNotNull);
        expect(
            (getData['snapshot'] as Map)['counts'], containsPair('items', 2));
      } finally {
        client.close();
      }
    });

    test('GET /api/snapshot/compare returns diff when snapshot exists',
        () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);
      final p = port!;

      final client = HttpClient();
      try {
        await (await client.post('localhost', p, '/api/snapshot')).close();
        final req = await client.get('localhost', p, '/api/snapshot/compare');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body) as Map<String, dynamic>;
        expect(data['tables'], isNotEmpty);
        expect(data['snapshotId'], isNotNull);
      } finally {
        client.close();
      }
    });

    test('GET /api/snapshot/compare returns 400 when no snapshot', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req =
            await client.get('localhost', port!, '/api/snapshot/compare');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.badRequest);
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body) as Map<String, dynamic>;
        expect(data['error'], contains('No snapshot'));
      } finally {
        client.close();
      }
    });

    test('DELETE /api/snapshot clears snapshot', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);
      final p = port!;

      final client = HttpClient();
      try {
        await (await client.post('localhost', p, '/api/snapshot')).close();
        final delReq = await client.delete('localhost', p, '/api/snapshot');
        final delResp = await delReq.close();
        expect(delResp.statusCode, HttpStatus.ok);
        final getReq = await client.get('localhost', p, '/api/snapshot');
        final getResp = await getReq.close();
        final getBody = await getResp.transform(utf8.decoder).join();
        final getData = jsonDecode(getBody) as Map<String, dynamic>;
        expect(getData['snapshot'], isNull);
      } finally {
        client.close();
      }
    });
  });

  group('Database diff (queryCompare)', () {
    late Future<List<Map<String, dynamic>>> Function(String sql) mockQueryA;
    late Future<List<Map<String, dynamic>>> Function(String sql) mockQueryB;

    setUp(() {
      mockQueryA = (String sql) async {
        if (sql.contains('ORDER BY type, name')) {
          return [
            {
              'type': 'table',
              'name': 'items',
              'sql': 'CREATE TABLE items(id INT);'
            },
          ];
        }
        if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
          return [
            {'name': 'items'}
          ];
        }
        if (sql.contains('COUNT(*)') && sql.contains('items')) {
          return [
            {'c': 3}
          ];
        }
        return <Map<String, dynamic>>[];
      };
      mockQueryB = (String sql) async {
        if (sql.contains('ORDER BY type, name')) {
          return [
            {
              'type': 'table',
              'name': 'items',
              'sql': 'CREATE TABLE items(id INT);'
            },
          ];
        }
        if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
          return [
            {'name': 'items'}
          ];
        }
        if (sql.contains('COUNT(*)') && sql.contains('items')) {
          return [
            {'c': 5}
          ];
        }
        return <Map<String, dynamic>>[];
      };
    });

    tearDown(() async {
      await DriftDebugServer.stop();
    });

    test('GET /api/compare/report returns 501 when queryCompare not set',
        () async {
      await DriftDebugServer.start(
        query: mockQueryA,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/compare/report');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.notImplemented);
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body) as Map<String, dynamic>;
        expect(data['error'], contains('queryCompare'));
      } finally {
        client.close();
      }
    });

    test('GET /api/compare/report returns diff when queryCompare set',
        () async {
      await DriftDebugServer.start(
        query: mockQueryA,
        enabled: true,
        port: 0,
        queryCompare: mockQueryB,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/compare/report');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body) as Map<String, dynamic>;
        expect(data['schemaSame'], isTrue);
        expect(data['tableCounts'], isNotEmpty);
        final itemsRow = (data['tableCounts'] as List).firstWhere(
          (e) => (e as Map)['table'] == 'items',
          orElse: () => <String, dynamic>{},
        ) as Map<String, dynamic>;
        expect(itemsRow['countA'], 3);
        expect(itemsRow['countB'], 5);
        expect(itemsRow['diff'], -2);
      } finally {
        client.close();
      }
    });

    test('GET /api/compare/report?format=download returns attachment',
        () async {
      await DriftDebugServer.start(
        query: mockQueryA,
        enabled: true,
        port: 0,
        queryCompare: mockQueryB,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.getUrl(
          Uri.parse(
              'http://localhost:$port/api/compare/report?format=download'),
        );
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        expect(resp.headers.value('content-disposition'),
            contains('diff-report.json'));
      } finally {
        client.close();
      }
    });
  });

  group('GET /api/schema/metadata', () {
    tearDown(() async {
      await DriftDebugServer.stop();
    });

    test('returns multiple tables with correct row counts', () async {
      await DriftDebugServer.start(
        query: (String sql) async {
          if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
            return [
              {'name': 'orders'},
              {'name': 'users'},
            ];
          }
          if (sql.contains('PRAGMA table_info("users")')) {
            return [
              {'cid': 0, 'name': 'id', 'type': 'INTEGER', 'notnull': 1, 'dflt_value': null, 'pk': 1},
              {'cid': 1, 'name': 'email', 'type': 'TEXT', 'notnull': 0, 'dflt_value': null, 'pk': 0},
              {'cid': 2, 'name': 'created_at', 'type': 'TEXT', 'notnull': 0, 'dflt_value': null, 'pk': 0},
            ];
          }
          if (sql.contains('PRAGMA table_info("orders")')) {
            return [
              {'cid': 0, 'name': 'id', 'type': 'INTEGER', 'notnull': 1, 'dflt_value': null, 'pk': 1},
              {'cid': 1, 'name': 'user_id', 'type': 'INTEGER', 'notnull': 1, 'dflt_value': null, 'pk': 0},
              {'cid': 2, 'name': 'total', 'type': 'REAL', 'notnull': 0, 'dflt_value': null, 'pk': 0},
            ];
          }
          if (sql.contains('COUNT(*)') && sql.contains('"users"')) {
            return [{'c': 42}];
          }
          if (sql.contains('COUNT(*)') && sql.contains('"orders"')) {
            return [{'c': 7}];
          }
          return <Map<String, dynamic>>[];
        },
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req =
            await client.get('localhost', port!, '/api/schema/metadata');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);

        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        final tables = decoded['tables'] as List<dynamic>;
        expect(tables, hasLength(2));

        final orders = tables[0] as Map<String, dynamic>;
        expect(orders['name'], 'orders');
        expect(orders['rowCount'], 7);
        expect((orders['columns'] as List).length, 3);

        final users = tables[1] as Map<String, dynamic>;
        expect(users['name'], 'users');
        expect(users['rowCount'], 42);
        expect((users['columns'] as List).length, 3);

        // Verify column details
        final userCols = users['columns'] as List<dynamic>;
        final idCol = userCols[0] as Map<String, dynamic>;
        expect(idCol['name'], 'id');
        expect(idCol['type'], 'INTEGER');
        expect(idCol['pk'], true);

        final emailCol = userCols[1] as Map<String, dynamic>;
        expect(emailCol['name'], 'email');
        expect(emailCol['type'], 'TEXT');
        expect(emailCol['pk'], false);
      } finally {
        client.close();
      }
    });

    test('returns empty tables array when no tables exist', () async {
      await DriftDebugServer.start(
        query: (String sql) async {
          return <Map<String, dynamic>>[];
        },
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req =
            await client.get('localhost', port!, '/api/schema/metadata');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);

        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        final tables = decoded['tables'] as List<dynamic>;
        expect(tables, isEmpty);
      } finally {
        client.close();
      }
    });

    test('returns single-column table with correct rowCount', () async {
      await DriftDebugServer.start(
        query: (String sql) async {
          if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
            return [
              {'name': 'items'}
            ];
          }
          if (sql.contains('PRAGMA table_info')) {
            return [
              {'cid': 0, 'name': 'id', 'type': 'INTEGER', 'notnull': 1, 'dflt_value': null, 'pk': 1},
            ];
          }
          if (sql.contains('COUNT(*)')) {
            return [{'c': 5}];
          }
          return <Map<String, dynamic>>[];
        },
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req =
            await client.get('localhost', port!, '/api/schema/metadata');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);

        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        final tables = decoded['tables'] as List<dynamic>;
        expect(tables, hasLength(1));
        expect((tables[0] as Map)['rowCount'], 5);
      } finally {
        client.close();
      }
    });

    test('handles query error gracefully', () async {
      await DriftDebugServer.start(
        query: (String sql) async {
          throw Exception('Database locked');
        },
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req =
            await client.get('localhost', port!, '/api/schema/metadata');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.internalServerError);
      } finally {
        client.close();
      }
    });
  });

  group('GET /api/table/{name}/fk-meta', () {
    tearDown(() async {
      await DriftDebugServer.stop();
    });

    test('returns FK metadata for table with foreign keys', () async {
      await DriftDebugServer.start(
        query: (String sql) async {
          if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
            return [
              {'name': 'orders'},
              {'name': 'users'},
            ];
          }
          if (sql.contains('PRAGMA foreign_key_list("orders")')) {
            return [
              {
                'id': 0,
                'seq': 0,
                'table': 'users',
                'from': 'user_id',
                'to': 'id',
                'on_update': 'NO ACTION',
                'on_delete': 'NO ACTION',
                'match': 'NONE',
              },
            ];
          }
          return <Map<String, dynamic>>[];
        },
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req =
            await client.get('localhost', port!, '/api/table/orders/fk-meta');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);

        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as List<dynamic>;
        expect(decoded, hasLength(1));

        final fk = decoded[0] as Map<String, dynamic>;
        expect(fk['fromColumn'], 'user_id');
        expect(fk['toTable'], 'users');
        expect(fk['toColumn'], 'id');
      } finally {
        client.close();
      }
    });

    test('returns empty array for table without foreign keys', () async {
      await DriftDebugServer.start(
        query: (String sql) async {
          if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
            return [
              {'name': 'items'},
            ];
          }
          if (sql.contains('PRAGMA foreign_key_list')) {
            return <Map<String, dynamic>>[];
          }
          return <Map<String, dynamic>>[];
        },
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req =
            await client.get('localhost', port!, '/api/table/items/fk-meta');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);

        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as List<dynamic>;
        expect(decoded, isEmpty);
      } finally {
        client.close();
      }
    });

    test('returns 400 for unknown table', () async {
      await DriftDebugServer.start(
        query: (String sql) async {
          if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
            return [
              {'name': 'items'},
            ];
          }
          return <Map<String, dynamic>>[];
        },
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get(
            'localhost', port!, '/api/table/nonexistent/fk-meta');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.badRequest);

        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['error'], contains('Unknown table'));
        expect(decoded['error'], contains('nonexistent'));
      } finally {
        client.close();
      }
    });
  });
}
