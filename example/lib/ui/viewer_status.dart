import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Result of viewer startup: whether debug is enabled, server is running, and optional URL or error.
///
/// When [running] is true, [url] should be non-null in practice (copy button is disabled when [url] is null).
/// [errorMessage] is used when initialization failed or when [enabled] is true but the viewer did not start.
class ViewerInitResult {
  const ViewerInitResult({
    required this.enabled,
    required this.running,
    this.url,
    this.errorMessage,
  });

  final bool enabled;
  final bool running;
  final Uri? url;

  /// When set, initialization failed; show this message to the user.
  final String? errorMessage;
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey('loading'),
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          Icons.storage,
          size: 64,
          color: Theme.of(context).colorScheme.primary,
        ),
        const SizedBox(height: 24),
        Text(
          'Starting database + viewer…',
          style: Theme.of(context).textTheme.headlineSmall,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        const SizedBox(
          width: 220,
          child: LinearProgressIndicator(),
        ),
        const SizedBox(height: 12),
        Text(
          'This should only take a moment.',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}

class ReadyView extends StatelessWidget {
  const ReadyView({required this.init, super.key});
  final ViewerInitResult init;

  @override
  Widget build(BuildContext context) {
    final urlText = init.url?.toString() ?? '';

    return Column(
      key: const ValueKey('ready'),
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          init.running ? Icons.public : Icons.info_outline,
          size: 64,
          color: Theme.of(context).colorScheme.primary,
        ),
        const SizedBox(height: 24),
        Text(
          init.running
              ? 'Drift debug viewer is running'
              : (init.enabled
                  ? 'Viewer failed to start'
                  : 'Viewer disabled (release build)'),
          style: Theme.of(context).textTheme.headlineSmall,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        if (init.errorMessage != null)
          SelectableText(
            init.errorMessage!,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.error,
                ),
            textAlign: TextAlign.center,
          )
        else if (init.url != null)
          SelectableText(
            urlText,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  fontFamily: 'monospace',
                ),
            textAlign: TextAlign.center,
          )
        else
          Text(
            init.enabled
                ? 'Another process may already be using port 8642.'
                : 'Build in debug mode to enable the viewer.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
            textAlign: TextAlign.center,
          ),
        const SizedBox(height: 12),
        Wrap(
          alignment: WrapAlignment.center,
          spacing: 12,
          runSpacing: 12,
          children: [
            FilledButton.tonalIcon(
              onPressed: init.url != null
                  ? () async {
                      await Clipboard.setData(ClipboardData(text: urlText));
                      if (!context.mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Copied viewer URL')),
                      );
                    }
                  : null,
              icon: const Icon(Icons.copy),
              label: const Text('Copy URL'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Text(
          'Browse tables, run read-only SQL, export schema/data, or download the raw .sqlite file.',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}
