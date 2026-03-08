// Platform selection: VM (dart:io) uses the real
// HTTP server from drift_debug_server_io.dart.
// Web (no dart:io) gets a stub so the same import
// API works; [DriftDebugServer.start] throws
// [UnsupportedError] instead of a compile error.
// Barrel re-export keeps one entry point
// (avoid_barrel_files accepted for this pattern).
export 'drift_debug_server_stub.dart'
    if (dart.library.io) 'drift_debug_server_io.dart';
