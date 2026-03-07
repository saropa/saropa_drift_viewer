/// Flutter-specific API: overlay widget for opening
/// the Drift viewer in debug builds.
///
/// Import this file in Flutter apps to use
/// [DriftViewerOverlay] or
/// [DriftViewerFloatingButton]:
///
/// ```dart
/// import 'package:saropa_drift_viewer/flutter.dart';
///
/// runApp(DriftViewerOverlay(
///   child: MaterialApp(home: MyHomePage()),
/// ));
/// ```
///
/// For the server API ([DriftDebugServer],
/// [startDriftViewer]), use either this import or
/// [package:saropa_drift_viewer/saropa_drift_viewer.dart].
library;

export 'saropa_drift_viewer.dart';
export 'src/drift_viewer_floating_button.dart';
export 'src/drift_viewer_overlay.dart';
