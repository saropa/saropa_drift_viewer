import 'dart:io';

import 'package:drift/drift.dart' hide Column;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:saropa_drift_viewer/saropa_drift_viewer.dart';

import 'database/app_database.dart';
import 'ui/viewer_status.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ExampleApp());
}

class ExampleApp extends StatelessWidget {
  const ExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Drift Viewer Example',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
        useMaterial3: true,
      ),
      home: const HomePage(title: 'Drift Viewer Example'),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({required this.title, super.key});
  final String title;

  @override
  State<HomePage> createState() => _HomePageState();
}

/// Timeout for viewer initialization so the UI does not hang if DB or server never completes.
const Duration _kInitTimeout = Duration(seconds: 30);

class _HomePageState extends State<HomePage> {
  late final Future<ViewerInitResult> _initFuture =
      _initialize().timeout(_kInitTimeout, onTimeout: () {
    return ViewerInitResult(
      enabled: kDebugMode,
      running: false,
      url: null,
      errorMessage: 'Initialization timed out after ${_kInitTimeout.inSeconds} seconds.',
    );
  });

  @override
  Widget build(BuildContext context) {
    // Show loading until DB + viewer are ready; on error show ReadyView with error message.
    return FutureBuilder<ViewerInitResult>(
      future: _initFuture,
      builder: (context, snapshot) {
        final Widget bodyChild;
        if (snapshot.connectionState == ConnectionState.done) {
          if (snapshot.hasError) {
            bodyChild = ReadyView(
              init: ViewerInitResult(
                enabled: kDebugMode,
                running: false,
                url: null,
                errorMessage: snapshot.error.toString(),
              ),
            );
          } else if (snapshot.data != null) {
            bodyChild = ReadyView(init: snapshot.data!);
          } else {
            bodyChild = const LoadingView();
          }
        } else {
          bodyChild = const LoadingView();
        }

        return Scaffold(
          appBar: AppBar(
            title: Text(widget.title),
            backgroundColor: Theme.of(context).colorScheme.inversePrimary,
          ),
          body: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 250),
                switchInCurve: Curves.easeOut,
                switchOutCurve: Curves.easeIn,
                transitionBuilder: (child, animation) {
                  final slide = Tween<Offset>(
                    begin: const Offset(0, 0.04),
                    end: Offset.zero,
                  ).animate(CurvedAnimation(
                      parent: animation, curve: Curves.easeOutCubic));
                  return FadeTransition(
                    opacity: animation,
                    child: SlideTransition(position: slide, child: child),
                  );
                },
                child: bodyChild,
              ),
            ),
          ),
        );
      },
    );
  }

  Future<ViewerInitResult> _initialize() async {
    final db = await AppDatabase.create();

    // Seed sample data if the table is empty.
    final countExp = db.items.id.count();
    final existing = await (db.selectOnly(db.items)..addColumns([countExp]))
        .map((row) => row.read(countExp) ?? 0)
        .getSingle();
    if (existing == 0) {
      final now = DateTime.now();
      await db.batch((batch) {
        batch.insert(db.items,
            ItemsCompanion.insert(title: 'First item', createdAt: now));
        batch.insert(db.items,
            ItemsCompanion.insert(title: 'Second item', createdAt: now));
        batch.insert(db.items,
            ItemsCompanion.insert(title: 'Third item', createdAt: now));
      });
    }

    // Start the Drift debug viewer (debug only). Open http://127.0.0.1:8642 in a browser.
    await DriftDebugServer.start(
      query: (String sql) async {
        final rows = await db.customSelect(sql).get();
        return rows.map((r) => Map<String, dynamic>.from(r.data)).toList();
      },
      enabled: kDebugMode,
      getDatabaseBytes: () => File(db.dbPath).readAsBytes(),
      onLog: DriftDebugErrorLogger.logCallback(prefix: 'DriftViewer'),
      onError: DriftDebugErrorLogger.errorCallback(prefix: 'DriftViewer'),
    );

    final runningPort = DriftDebugServer.port;
    final isRunning = kDebugMode && runningPort != null;

    return ViewerInitResult(
      enabled: kDebugMode,
      running: isRunning,
      url: isRunning ? Uri.parse('http://127.0.0.1:$runningPort') : null,
    );
  }
}
