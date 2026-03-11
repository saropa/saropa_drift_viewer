/// Flutter-specific API: overlay widget for opening
/// the Drift viewer in debug builds.
///
/// Import this file in Flutter apps to use
/// [DriftViewerOverlay] or
/// [DriftViewerFloatingButton]:
///
/// ```dart
/// import 'package:saropa_drift_advisor/flutter.dart';
///
/// runApp(DriftViewerOverlay(
///   child: MaterialApp(home: MyHomePage()),
/// ));
/// ```
///
/// For the server API ([DriftDebugServer],
/// [startDriftViewer]), use either this import or
/// [package:saropa_drift_advisor/saropa_drift_advisor.dart].
library;

export 'saropa_drift_advisor.dart';
export 'src/drift_viewer_floating_button.dart';
export 'src/drift_viewer_overlay.dart';
