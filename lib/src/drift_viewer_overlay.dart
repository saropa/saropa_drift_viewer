// Flutter overlay: wraps the app with a floating
// button in debug builds.
//
// This file provides [DriftViewerOverlay]. The
// button and WebView screen live in
// [drift_viewer_floating_button.dart]
// (one public widget per file).

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:meta/meta.dart';

import 'drift_viewer_floating_button.dart';

/// Wraps [child] in a [Stack] and overlays a
/// floating button in debug builds that opens the
/// Drift viewer in the browser or WebView.
///
/// When [kDebugMode] is false or
/// [DriftDebugServer.port] is null, only [child]
/// is shown. Otherwise a
/// [DriftViewerFloatingButton] is stacked at
/// [alignment] with optional [margin].
///
/// Example:
/// ```dart
/// runApp(DriftViewerOverlay(
///   child: MaterialApp(home: MyHomePage()),
/// ));
/// ```
final class DriftViewerOverlay extends StatelessWidget {
  /// Creates an overlay that wraps [child] and
  /// shows a viewer button when applicable.
  const DriftViewerOverlay({
    super.key,
    required this.child,
    this.alignment = AlignmentDirectional.bottomEnd,
    EdgeInsetsGeometry? margin,
  }) : margin = margin ?? const EdgeInsetsDirectional.all(16);

  /// The widget below the overlay
  /// (e.g. your [MaterialApp]).
  final Widget child;

  /// Alignment of the floating button. Defaults to
  /// [AlignmentDirectional.bottomEnd].
  final AlignmentGeometry alignment;

  /// Margin around the floating button. Defaults to
  /// 16 logical pixels on all sides.
  final EdgeInsetsGeometry margin;

  @override
  String toString({
    DiagnosticLevel minLevel = DiagnosticLevel.info,
  }) =>
      'DriftViewerOverlay(alignment: $alignment, margin: $margin)';

  @override
  @useResult
  Widget build(BuildContext _) {
    if (!isDriftViewerOverlayVisible) return child;

    return Stack(
      clipBehavior: Clip.none,
      children: <Widget>[
        child,
        Container(
          alignment: alignment,
          padding: margin,
          clipBehavior: Clip.none,
          child: const DriftViewerFloatingButton(),
        ),
      ],
    );
  }
}
