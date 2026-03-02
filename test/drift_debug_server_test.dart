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

  test('stop when server not started is no-op and does not throw', () async {
    await DriftDebugServer.stop();
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
          return [{'name': 'items'}];
        }
        if (sql.contains('COUNT(*)') && sql.contains('items')) {
          return [{'c': 2}];
        }
        if (sql.contains('SELECT * FROM "items"')) {
          return [
            {'id': 1, 'name': 'first'},
            {'id': 2, 'name': "second's"},
          ];
        }
        if (sql.contains('PRAGMA table_info("items")')) {
          return [
            {'cid': 0, 'name': 'id', 'type': 'INTEGER', 'notnull': 1, 'dflt_value': null, 'pk': 1},
            {'cid': 1, 'name': 'name', 'type': 'TEXT', 'notnull': 0, 'dflt_value': null, 'pk': 0},
          ];
        }
        if (sql.contains('SELECT') && !sql.contains('INSERT') && !sql.contains('sqlite_master')) {
          return [{'id': 1, 'name': 'first'}];
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
        expect(resp.headers.value('content-disposition'), contains('schema.sql'));
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

    test('GET /api/table/<name> with limit and offset returns JSON array', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client
            .getUrl(Uri.parse('http://localhost:$port/api/table/items?limit=10&offset=0'));
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        expect(resp.headers.value('content-type'), contains('application/json'));
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as List<dynamic>;
        expect(decoded.length, 2);
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
        final req = await client.get('localhost', port!, '/api/table/items/count');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        expect(resp.headers.value('content-type'), contains('application/json'));
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
        final req = await client.get('localhost', port!, '/api/table/items/columns');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as List<dynamic>;
        expect(decoded, ['id', 'name']);
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

    test('POST /api/sql accepts SELECT with keyword inside string literal', () async {
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
        req.write(jsonEncode(<String, String>{'sql': 'INSERT INTO items (name) VALUES (\'x\')'}));
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.badRequest);
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['error'], contains('read-only'));
      } finally {
        client.close();
      }
    });

    test('GET /api/generation returns JSON with generation number for live refresh', () async {
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

    test('GET /api/generation?since=N accepts query param and returns same format', () async {
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
        final req = await client.getUrl(Uri.parse('http://localhost:$port/api/generation?since=-1'));
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
          return [{'name': 'items'}];
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

    test('request with query param token succeeds when authToken is set', () async {
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
        expect(resp.statusCode, HttpStatus.ok);
      } finally {
        client.close();
      }
    });

    test('request with Basic auth succeeds when basicAuthUser/Password set', () async {
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

    test('empty authToken does not require auth (treated as disabled)', () async {
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
          return [{'name': 'items'}];
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
        expect(resp.headers.value('content-type'), contains('application/json'));
        final body = await resp.transform(utf8.decoder).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['error'], contains('getDatabaseBytes'));
      } finally {
        client.close();
      }
    });

    test('returns 200 and database bytes when getDatabaseBytes provided', () async {
      const sqliteHeader = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65]; // "SQLite" magic
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
        getDatabaseBytes: () async => List<int>.from(sqliteHeader)..addAll(List.filled(100, 0)),
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final req = await client.get('localhost', port!, '/api/database');
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        expect(resp.headers.value('content-disposition'), contains('database.sqlite'));
        expect(resp.headers.value('content-type'), contains('octet-stream'));
        final body = await resp.toList();
        final bytes = body.expand((b) => b).toList();
        expect(bytes.length, 106);
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
          return [{'name': 'items'}];
        }
        if (sql.contains('COUNT(*)') && sql.contains('items')) {
          return [{'c': 2}];
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

    test('POST /api/snapshot captures state and GET returns metadata', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final postReq = await client.post('localhost', port!, '/api/snapshot');
        final postResp = await postReq.close();
        expect(postResp.statusCode, HttpStatus.ok);
        final postBody = await postResp.transform(utf8.decoder).join();
        final postData = jsonDecode(postBody) as Map<String, dynamic>;
        expect(postData['id'], isNotNull);
        expect(postData['tables'], ['items']);
        expect(postData['tableCount'], 1);

        final getReq = await client.get('localhost', port!, '/api/snapshot');
        final getResp = await getReq.close();
        expect(getResp.statusCode, HttpStatus.ok);
        final getBody = await getResp.transform(utf8.decoder).join();
        final getData = jsonDecode(getBody) as Map<String, dynamic>;
        expect(getData['snapshot'], isNotNull);
        expect((getData['snapshot'] as Map)['counts'], containsPair('items', 2));
      } finally {
        client.close();
      }
    });

    test('GET /api/snapshot/compare returns diff when snapshot exists', () async {
      await DriftDebugServer.start(
        query: mockQuery,
        enabled: true,
        port: 0,
      );
      final port = DriftDebugServer.port;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        await (await client.post('localhost', port!, '/api/snapshot')).close();
        final req = await client.get('localhost', port!, '/api/snapshot/compare');
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
        final req = await client.get('localhost', port!, '/api/snapshot/compare');
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

      final client = HttpClient();
      try {
        await (await client.post('localhost', port!, '/api/snapshot')).close();
        final delReq = await client.delete('localhost', port!, '/api/snapshot');
        final delResp = await delReq.close();
        expect(delResp.statusCode, HttpStatus.ok);
        final getReq = await client.get('localhost', port!, '/api/snapshot');
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
            {'type': 'table', 'name': 'items', 'sql': 'CREATE TABLE items(id INT);'},
          ];
        }
        if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
          return [{'name': 'items'}];
        }
        if (sql.contains('COUNT(*)') && sql.contains('items')) {
          return [{'c': 3}];
        }
        return <Map<String, dynamic>>[];
      };
      mockQueryB = (String sql) async {
        if (sql.contains('ORDER BY type, name')) {
          return [
            {'type': 'table', 'name': 'items', 'sql': 'CREATE TABLE items(id INT);'},
          ];
        }
        if (sql.contains("type='table'") && sql.contains('ORDER BY name')) {
          return [{'name': 'items'}];
        }
        if (sql.contains('COUNT(*)') && sql.contains('items')) {
          return [{'c': 5}];
        }
        return <Map<String, dynamic>>[];
      };
    });

    tearDown(() async {
      await DriftDebugServer.stop();
    });

    test('GET /api/compare/report returns 501 when queryCompare not set', () async {
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

    test('GET /api/compare/report returns diff when queryCompare set', () async {
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

    test('GET /api/compare/report?format=download returns attachment', () async {
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
          Uri.parse('http://localhost:$port/api/compare/report?format=download'),
        );
        final resp = await req.close();
        expect(resp.statusCode, HttpStatus.ok);
        expect(resp.headers.value('content-disposition'), contains('diff-report.json'));
      } finally {
        client.close();
      }
    });
  });
}
