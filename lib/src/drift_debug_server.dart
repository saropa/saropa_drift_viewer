// Platform selection: VM (dart:io) gets the real
// HTTP server in drift_debug_server_io.dart;
// web (no dart:io) gets the stub so the same import
// works and [DriftDebugServer.start] throws
// [UnsupportedError] instead of failing at compile
// time. The barrel re-export keeps a single entry
// point for the package (avoid_barrel_files is
// accepted for this API/platform pattern).
export 'drift_debug_server_stub.dart'
    if (dart.library.io) 'drift_debug_server_io.dart';
