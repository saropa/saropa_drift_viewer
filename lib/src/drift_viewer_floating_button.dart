// Flutter overlay: floating button that opens
// the Drift viewer in browser or WebView.
//
// Apps that use this widget must configure
// url_launcher for their platform:
// - Android: add <queries> with intent filters
//   in AndroidManifest.xml (see url_launcher docs).
// - iOS: add LSApplicationQueriesSchemes in
//   Info.plist for the schemes you launch
//   (e.g. http).

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:meta/meta.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import 'drift_debug_server.dart';

// ---------------------------------------------------------------------------
// Constants (named to satisfy avoid_hardcoded_duration / avoid_time_limits)
// ---------------------------------------------------------------------------

/// SnackBar display duration for overlay messages. Long enough to read; debug-only UI.
const Duration _kSnackBarDuration = Duration(seconds: 10);

/// App bar title for the in-app WebView screen.
const String _kDriftViewerScreenTitle = 'Drift Viewer';

/// Skeleton placeholder dimensions (debug-only; fixed for consistency).
const double _kSkeletonBarWidth = 200;
const double _kSkeletonBarHeight = 16;
const double _kSkeletonBarGap = 12;
const double _kSkeletonCornerRadius = 4;
const double _kSkeletonBlockWidth = 280;
const double _kSkeletonBlockHeight = 80;

/// Max length for URL string in error messages (no_magic_number).
const int _kUriStringDisplayMaxLength = 80;

/// Max lines for error message text (no_magic_number).
const int _kErrorMessageMaxLines = 3;

// ---------------------------------------------------------------------------
// Localized strings (Intl.message for avoid_hardcoded_locale_strings)
// ---------------------------------------------------------------------------

String get _sOpenDriftViewer => Intl.message(
      'Open Drift Viewer',
      name: 'sOpenDriftViewer',
      desc: 'Tooltip for the Drift Viewer overlay floating button',
    );

String get _sOpenInBrowser => Intl.message(
      'Open in browser',
      name: 'sOpenInBrowser',
      desc: 'Menu item to open the viewer in the external browser',
    );

String get _sOpenInWebView => Intl.message(
      'Open in WebView',
      name: 'sOpenInWebView',
      desc: 'Menu item to open the viewer in an in-app WebView',
    );

String get _sBrowser => Intl.message(
      'Browser',
      name: 'sBrowser',
      desc: 'Semantic label for the open-in-browser icon',
    );

String get _sWebView => Intl.message(
      'WebView',
      name: 'sWebView',
      desc: 'Semantic label for the open-in-WebView icon',
    );

String get _sBack => Intl.message(
      'Back',
      name: 'sBack',
      desc: 'Back button tooltip and semantic label on WebView screen',
    );

String get _sDriftViewer => Intl.message(
      'Drift Viewer',
      name: 'sDriftViewer',
      desc: 'Semantic label for the Drift Viewer floating button icon',
    );

String _sCouldNotOpen(Uri uri) => Intl.message(
      'Could not open $uri',
      name: 'sCouldNotOpen',
      desc: 'SnackBar when url_launcher cannot open the viewer URL',
      args: [uri.toString()],
    );

String get _sFailedToOpenViewer => Intl.message(
      'Failed to open viewer. Try opening the URL manually.',
      name: 'sFailedToOpenViewer',
      desc: 'SnackBar when launchUrl throws an exception',
    );

String _sInvalidOrUnsupportedUrl(String urlSample) => Intl.message(
      'Invalid or unsupported URL: $urlSample',
      name: 'sInvalidOrUnsupportedUrl',
      desc: 'WebView route error when URI is invalid or not http(s)',
      args: [urlSample],
    );

// ---------------------------------------------------------------------------
// URI and visibility
// ---------------------------------------------------------------------------

/// Builds the viewer URI for the current server port (localhost only).
Uri? _viewerUri() {
  final port = DriftDebugServer.port;

  if (port == null) return null;
  return Uri(scheme: 'http', host: '127.0.0.1', port: port);
}

/// Returns true when the overlay button should be shown (debug mode and server running).
bool get isDriftViewerOverlayVisible =>
    kDebugMode && DriftDebugServer.port != null;

// ---------------------------------------------------------------------------
// DriftViewerFloatingButton
// ---------------------------------------------------------------------------

/// Floating button that opens the Drift viewer in the browser or in an in-app WebView.
///
/// Only builds a visible widget when [kDebugMode] is true and [DriftDebugServer.port]
/// is non-null (server running). Otherwise builds [SizedBox.shrink].
///
/// Place in a [Stack] or use [DriftViewerOverlay] to wrap your app with a default position.
///
/// See also: [DriftViewerOverlay].
final class DriftViewerFloatingButton extends StatelessWidget {
  /// Creates a floating button that opens the Drift viewer.
  const DriftViewerFloatingButton({super.key});

  /// Route name for the in-app WebView screen. Register in [MaterialApp.onGenerateRoute]
  /// or [MaterialApp.routes] so [openInWebView] can use named routes for deep linking.
  /// Example: `onGenerateRoute: (s) => s.name?.startsWith(DriftViewerFloatingButton.webViewRouteName) == true
  ///   ? DriftViewerFloatingButton.buildWebViewRoute(s) : null`.
  static const String webViewRouteName = '/drift-viewer-webview';

  /// Builds the route for the in-app WebView. Use when registering [webViewRouteName].
  ///
  /// Pass [RouteSettings] from [MaterialApp.onGenerateRoute] for deep links (uri from
  /// [RouteSettings.name] query or [RouteSettings.arguments]). Or pass [settingsOrUriString]
  /// as a [String] for programmatic use. Only http and https schemes are allowed.
  ///
  /// Returns a [MaterialPageRoute] for the WebView screen or the error screen if the URI is invalid.
  @useResult
  static Route<void> buildWebViewRoute(dynamic settingsOrUriString) {
    final String uriString = _uriStringFromRouteSettings(settingsOrUriString);
    final uri = Uri.tryParse(uriString);
    final routeName = '$webViewRouteName?uri=${Uri.encodeComponent(uriString)}';

    if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https')) {
      return _buildWebViewErrorRoute(routeName, uriString);
    }
    return _buildWebViewScreenRoute(routeName, uri);
  }

  /// Uri string from RouteSettings (path/query param or arguments) or direct string (require_deep_link_testing).
  static String _uriStringFromRouteSettings(dynamic settingsOrUriString) {
    if (settingsOrUriString is RouteSettings) {
      final name = settingsOrUriString.name;

      if (name != null && name.contains('?uri=')) {
        final idx = name.indexOf('?');

        if (idx >= 0) {
          final query = name.substring(idx + 1);
          final params = Uri.splitQueryString(query);
          final uri = params['uri'];

          if (uri != null && uri.isNotEmpty) return uri;
        }
      }
      final args = settingsOrUriString.arguments;

      if (args is String && args.isNotEmpty) return args;
    }
    if (settingsOrUriString is String && settingsOrUriString.isNotEmpty) {
      return settingsOrUriString;
    }
    return '';
  }

  /// Named route builder for error screen (prefer_named_routes_for_deep_links).
  @useResult
  static Route<void> _buildWebViewErrorRoute(
      String routeName, String uriString) {
    final urlSample = uriString.length > _kUriStringDisplayMaxLength
        ? '${uriString.substring(0, _kUriStringDisplayMaxLength)}...'
        : uriString;

    return MaterialPageRoute<void>(
      settings: RouteSettings(name: routeName, arguments: urlSample),
      builder: (BuildContext _) => _WebViewErrorScreen(urlSample: urlSample),
    );
  }

  /// Named route builder for WebView screen (prefer_named_routes_for_deep_links).
  @useResult
  static Route<void> _buildWebViewScreenRoute(String routeName, Uri uri) {
    return MaterialPageRoute<void>(
      settings: RouteSettings(name: routeName, arguments: uri.toString()),
      builder: (BuildContext _) => _WebViewScreenFromSettings(uri: uri),
    );
  }

  @override
  @useResult
  Widget build(BuildContext context) {
    if (!isDriftViewerOverlayVisible) return const SizedBox.shrink();
    final uri = _viewerUri();

    if (uri == null) return const SizedBox.shrink();
    final colorScheme = Theme.of(context).colorScheme;
    final transparentSurface = colorScheme.surface.withValues(alpha: 0);
    return Material(
      color: transparentSurface,
      child: PopupMenuButton<String>(
        tooltip: _sOpenDriftViewer,
        icon: Icon(Icons.storage, semanticLabel: _sDriftViewer),
        onSelected: (String value) {
          if (value == 'browser') {
            unawaited(
              _openInBrowser(context, uri).catchError(_logOpenInBrowserError),
            );
          }
          if (value == 'webview') {
            _openInWebView(context, uri);
          }
        },
        itemBuilder: (BuildContext _) => <PopupMenuEntry<String>>[
          PopupMenuItem<String>(
            value: 'browser',
            child: ListTile(
              leading: Icon(Icons.open_in_browser, semanticLabel: _sBrowser),
              title: Text(
                _sOpenInBrowser,
                overflow: TextOverflow.ellipsis,
                maxLines: 1,
              ),
            ),
          ),
          PopupMenuItem<String>(
            value: 'webview',
            child: ListTile(
              leading: Icon(Icons.web, semanticLabel: _sWebView),
              title: Text(
                _sOpenInWebView,
                overflow: TextOverflow.ellipsis,
                maxLines: 1,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Error screen for invalid WebView URL (named widget for deep-link route; SafeArea when no AppBar).
class _WebViewErrorScreen extends StatelessWidget {
  const _WebViewErrorScreen({required this.urlSample});

  final String urlSample;

  @override
  String toString({DiagnosticLevel minLevel = DiagnosticLevel.info}) =>
      '_WebViewErrorScreen(urlSample: $urlSample)';

  @override
  @useResult
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Text(
            _sInvalidOrUnsupportedUrl(urlSample),
            maxLines: _kErrorMessageMaxLines,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ),
    );
  }
}

/// WebView screen; [uri] is passed from route builder (parsing done there to avoid_expensive_build).
class _WebViewScreenFromSettings extends StatelessWidget {
  const _WebViewScreenFromSettings({required this.uri});

  final Uri uri;

  @override
  String toString({DiagnosticLevel minLevel = DiagnosticLevel.info}) =>
      '_WebViewScreenFromSettings(uri: $uri)';

  @override
  @useResult
  Widget build(BuildContext context) => _DriftViewerWebViewScreen(uri: uri);
}

// ---------------------------------------------------------------------------
// Error logging for fire-and-forget futures (prefer_extracting_function_callbacks)
// ---------------------------------------------------------------------------

void _logOpenInBrowserError(Object e, StackTrace st) {
  if (kDebugMode) {
    debugPrint('DriftViewer _openInBrowser failed: $e');
    debugPrint('$st');
  }
}

// ---------------------------------------------------------------------------
// SnackBar helpers (extracted from _openInBrowser per avoid_local_functions)
// ---------------------------------------------------------------------------

void _showCouldNotOpenSnackBar(ScaffoldMessengerState messenger, Uri uri) {
  messenger.clearSnackBars();
  final snackBar = SnackBar(
    duration: _kSnackBarDuration,
    content: Text(
      _sCouldNotOpen(uri),
      overflow: TextOverflow.ellipsis,
      maxLines: 2,
    ),
  );
  final _ = messenger.showSnackBar(snackBar);
}

void _showFailedToOpenSnackBar(ScaffoldMessengerState messenger) {
  messenger.clearSnackBars();
  final _ = messenger.showSnackBar(
    SnackBar(
      duration: _kSnackBarDuration,
      content: Text(
        _sFailedToOpenViewer,
        overflow: TextOverflow.ellipsis,
        maxLines: 2,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Open in browser (specific exception types per avoid_catching_generic_exception)
// ---------------------------------------------------------------------------

Future<void> _openInBrowser(BuildContext context, Uri uri) async {
  final messenger = ScaffoldMessenger.maybeOf(context);

  if (messenger == null) return;
  try {
    // Call launchUrl directly; avoid canLaunchUrl so
    // apps need not add <queries> (Android) /
    // LSApplicationQueriesSchemes (iOS) for this
    // debug-only flow.
    final launched = await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    );

    if (!context.mounted) return;
    if (!launched) {
      _showCouldNotOpenSnackBar(messenger, uri);
    }
  } on PlatformException catch (e, st) {
    if (kDebugMode) {
      debugPrint('DriftViewer launchUrl PlatformException: $e');
      debugPrint('$st');
    }
    if (!context.mounted) return;
    _showFailedToOpenSnackBar(messenger);
  } on ArgumentError catch (e, st) {
    if (kDebugMode) {
      debugPrint('DriftViewer launchUrl ArgumentError: $e');
      debugPrint('$st');
    }
    if (!context.mounted) return;
    _showFailedToOpenSnackBar(messenger);
  } on FormatException catch (e, st) {
    if (kDebugMode) {
      debugPrint('DriftViewer launchUrl FormatException: $e');
      debugPrint('$st');
    }
    if (!context.mounted) return;
    _showFailedToOpenSnackBar(messenger);
  }
}

void _openInWebView(BuildContext context, Uri uri) {
  final routeName =
      '${DriftViewerFloatingButton.webViewRouteName}?uri=${Uri.encodeComponent(uri.toString())}';
  final future = Navigator.of(context).pushNamed<void>(routeName);

  unawaited(future.catchError((Object e, StackTrace st) {
    if (kDebugMode) {
      debugPrint('DriftViewer pushNamed failed: $e');
      debugPrint('$st');
    }
  }));
}

// ---------------------------------------------------------------------------
// WebView navigation delegate (extracted per prefer_extracting_function_callbacks)
// ---------------------------------------------------------------------------

NavigationDecision _onNavigationRequest(
  NavigationRequest request,
  String allowedHost,
  int allowedPort,
) {
  final requestUri = Uri.tryParse(request.url);

  if (requestUri != null &&
      requestUri.host == allowedHost &&
      requestUri.port == allowedPort) {
    return NavigationDecision.navigate;
  }

  return NavigationDecision.prevent;
}

NavigationDelegate _createWebViewNavigationDelegate(Uri allowedUri) {
  final allowedHost = allowedUri.host;
  final allowedPort = allowedUri.port;

  return NavigationDelegate(
    onNavigationRequest: (NavigationRequest request) =>
        _onNavigationRequest(request, allowedHost, allowedPort),
    onWebResourceError: (WebResourceError error) {
      if (kDebugMode) {
        debugPrint('DriftViewer WebView error: ${error.description}');
      }
    },
    onSslAuthError: (SslAuthError request) {
      unawaited(request.cancel());
    },
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton (prefer_skeleton_over_spinner; theme color per require_theme_color_from_scheme)
// ---------------------------------------------------------------------------

/// Skeleton placeholder shown while the WebView controller is not yet ready.
class _DriftViewerLoadingPlaceholder extends StatelessWidget {
  const _DriftViewerLoadingPlaceholder();

  @override
  @useResult
  Widget build(BuildContext context) {
    return const Center(
      child: _SkeletonBars(),
    );
  }
}

/// Skeleton bars; uses theme color for require_theme_color_from_scheme.
class _SkeletonBars extends StatelessWidget {
  const _SkeletonBars();

  @override
  String toString({DiagnosticLevel minLevel = DiagnosticLevel.info}) =>
      '_SkeletonBars()';

  @override
  @useResult
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.surfaceContainerHighest;

    return _SkeletonBarsContent(color: color);
  }
}

/// Extracted skeleton shape for prefer_split_widget_const; receives theme color from parent.
class _SkeletonBarsContent extends StatelessWidget {
  const _SkeletonBarsContent({required this.color});

  final Color color;

  @override
  String toString({DiagnosticLevel minLevel = DiagnosticLevel.info}) =>
      '_SkeletonBarsContent(color: $color)';

  @override
  @useResult
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        _SkeletonBar(color: color),
        _SkeletonBlock(color: color),
      ],
    );
  }
}

/// Single skeleton bar (extracted for prefer_split_widget_const).
class _SkeletonBar extends StatelessWidget {
  const _SkeletonBar({required this.color});

  final Color color;

  @override
  String toString({DiagnosticLevel minLevel = DiagnosticLevel.info}) =>
      '_SkeletonBar(color: $color)';

  @override
  @useResult
  Widget build(BuildContext context) {
    return Container(
      width: _kSkeletonBarWidth,
      height: _kSkeletonBarHeight,
      margin: const EdgeInsets.only(bottom: _kSkeletonBarGap),
      clipBehavior: Clip.hardEdge,
      decoration: BoxDecoration(
        color: color,
        borderRadius:
            const BorderRadius.all(Radius.circular(_kSkeletonCornerRadius)),
      ),
    );
  }
}

/// Skeleton block (extracted for prefer_split_widget_const).
class _SkeletonBlock extends StatelessWidget {
  const _SkeletonBlock({required this.color});

  final Color color;

  @override
  String toString({DiagnosticLevel minLevel = DiagnosticLevel.info}) =>
      '_SkeletonBlock(color: $color)';

  @override
  @useResult
  Widget build(BuildContext context) {
    return Container(
      width: _kSkeletonBlockWidth,
      height: _kSkeletonBlockHeight,
      clipBehavior: Clip.hardEdge,
      decoration: BoxDecoration(
        color: color,
        borderRadius:
            const BorderRadius.all(Radius.circular(_kSkeletonCornerRadius)),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sandboxed WebView (prefer_webview_sandbox: controller must have allowFileAccess
// false and navigation delegate restricting domain)
// ---------------------------------------------------------------------------

/// WebView wrapper that documents sandbox requirements (prefer_webview_sandbox).
/// The [controller] must have file access disabled and a navigation delegate
/// that restricts navigation to the intended domain (configured in initState above).
class _SandboxedWebView extends StatelessWidget {
  const _SandboxedWebView({required this.controller});

  final WebViewController controller;

  @override
  String toString({DiagnosticLevel minLevel = DiagnosticLevel.info}) =>
      '_SandboxedWebView(controller: $controller)';

  @override
  @useResult
  Widget build(BuildContext context) => WebViewWidget(controller: controller);
}

// ---------------------------------------------------------------------------
// Full-screen WebView (StatefulWidget required for initState + controller)
// ---------------------------------------------------------------------------

/// Full-screen WebView that loads the Drift viewer. Controller and navigation
/// delegate are set in [initState]; [WebViewWidget] receives the configured
/// controller (navigation delegate and error handling are on the controller).
class _DriftViewerWebViewScreen extends StatefulWidget {
  const _DriftViewerWebViewScreen({required this.uri});

  final Uri uri;

  @override
  @useResult
  State<_DriftViewerWebViewScreen> createState() =>
      _DriftViewerWebViewScreenState();

  @override
  String toString({DiagnosticLevel minLevel = DiagnosticLevel.info}) =>
      '_DriftViewerWebViewScreen(uri: $uri)';
}

class _DriftViewerWebViewScreenState extends State<_DriftViewerWebViewScreen> {
  /// Set in [initState]; non-null by first [build]. Avoids [late] per avoid_late_keyword.
  WebViewController? _controller;

  static void _logLoadError(Object e, StackTrace st) {
    if (kDebugMode) {
      debugPrint('DriftViewer loadRequest failed: $e');
      debugPrint('$st');
    }
  }

  @override
  String toString({DiagnosticLevel minLevel = DiagnosticLevel.info}) =>
      '_DriftViewerWebViewScreenState(uri: ${widget.uri})';

  @override
  void initState() {
    super.initState();
    final uri = widget.uri;
    final controller = WebViewController()
      ..setNavigationDelegate(_createWebViewNavigationDelegate(uri));
    final platform = controller.platform;

    if (platform is AndroidWebViewController) {
      unawaited(
        platform.setAllowFileAccess(false).catchError(
              (Object e, StackTrace st) => _logLoadError(e, st),
            ),
      );
    }
    _controller = controller;
    unawaited(
      controller
          .loadRequest(uri)
          .catchError((Object e, StackTrace st) => _logLoadError(e, st)),
    );
  }

  @override
  void dispose() {
    _controller = null;
    super.dispose();
  }

  @override
  @useResult
  Widget build(BuildContext context) {
    final controller = _controller;

    if (controller == null) {
      return Scaffold(
        appBar: AppBar(
          title: Text(
            _kDriftViewerScreenTitle,
            overflow: TextOverflow.ellipsis,
            maxLines: 1,
          ),
        ),
        body: SafeArea(
          top: false,
          child: Center(
            child: _DriftViewerLoadingPlaceholder(),
          ),
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: Text(
          _kDriftViewerScreenTitle,
          overflow: TextOverflow.ellipsis,
          maxLines: 1,
        ),
        leading: IconButton(
          tooltip: _sBack,
          icon: Icon(Icons.arrow_back, semanticLabel: _sBack),
          onPressed: () => Navigator.maybePop(context),
        ),
      ),
      body: SafeArea(
        top: false,
        child: _SandboxedWebView(controller: controller),
      ),
    );
  }
}
