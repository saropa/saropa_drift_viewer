import 'dart:convert';
import 'dart:io';

import 'package:saropa_drift_viewer/saropa_drift_viewer.dart';
import 'package:test/test.dart';

class _FakeRow {
  _FakeRow(this.data);
  final Map<String, Object?> data;
}

class _FakeSelectable {
  _FakeSelectable(this._rows);
  final List<_FakeRow> _rows;

  Future<List<_FakeRow>> get() async => _rows;
}

class _FakeDriftDb {
  dynamic customSelect(String sql) {
    // /api/tables uses sqlite_master for table listing.
    if (sql.contains('sqlite_master') && sql.contains("type='table'")) {
      return _FakeSelectable([
        _FakeRow({'name': 'items'})
      ]);
    }
    return _FakeSelectable(const <_FakeRow>[]);
  }
}

void main() {
  tearDown(() async {
    await DriftDebugServer.stop();
  });

  test('startDriftViewer wires customSelect into /api/tables', () async {
    final db = _FakeDriftDb();

    await db.startDriftViewer(
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
      final decoded = jsonDecode(body);
      expect(decoded, isA<List<dynamic>>());
      expect(decoded, contains('items'));
    } finally {
      client.close();
    }
  });

  test('startDriftViewer when customSelect().get() returns non-List returns 500 for /api/tables', () async {
    final db = _FakeDriftDbNonList();
    await db.startDriftViewer(enabled: true, port: 0);
    final port = DriftDebugServer.port;
    expect(port, isNotNull);

    final client = HttpClient();
    try {
      final req = await client.get('localhost', port!, '/api/tables');
      final resp = await req.close();
      expect(resp.statusCode, HttpStatus.internalServerError);
      final body = await resp.transform(utf8.decoder).join();
      final decoded = jsonDecode(body) as Map<String, dynamic>;
      expect(decoded['error'], isNotNull);
    } finally {
      client.close();
    }
  });

  test('startDriftViewer when row.data is not Map returns 500 for /api/tables', () async {
    final db = _FakeDriftDbBadRowData();
    await db.startDriftViewer(enabled: true, port: 0);
    final port = DriftDebugServer.port;
    expect(port, isNotNull);

    final client = HttpClient();
    try {
      final req = await client.get('localhost', port!, '/api/tables');
      final resp = await req.close();
      expect(resp.statusCode, HttpStatus.internalServerError);
      final body = await resp.transform(utf8.decoder).join();
      final decoded = jsonDecode(body) as Map<String, dynamic>;
      expect(decoded['error'], isNotNull);
    } finally {
      client.close();
    }
  });
}

class _FakeDriftDbNonList {
  dynamic customSelect(String sql) {
    if (sql.contains('sqlite_master') && sql.contains("type='table'")) {
      return _FakeSelectableNonList();
    }
    return _FakeSelectable(const <_FakeRow>[]);
  }
}

class _FakeSelectableNonList {
  Future<dynamic> get() async => 42;
}

class _FakeDriftDbBadRowData {
  dynamic customSelect(String sql) {
    if (sql.contains('sqlite_master') && sql.contains("type='table'")) {
      return _FakeSelectableBadRows();
    }
    return _FakeSelectable(const <_FakeRow>[]);
  }
}

class _FakeSelectableBadRows {
  Future<List<_FakeRowBadData>> get() async => [_FakeRowBadData(123)];
}

class _FakeRowBadData {
  _FakeRowBadData(this.data);
  final dynamic data;
}
