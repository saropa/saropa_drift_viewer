/**
 * Type declarations for the VS Code Timeline API.
 *
 * These types are not yet in @types/vscode (proposed API) but are
 * available at runtime in VS Code 1.44+. The vscode-mock.ts provides
 * matching implementations for testing.
 */

declare module 'vscode' {
  export interface TimelineItem {
    label: string;
    timestamp: number;
    id?: string;
    description?: string;
    detail?: string;
    iconPath?: ThemeIcon | Uri | { light: Uri; dark: Uri };
    command?: Command;
    contextValue?: string;
  }

  export interface TimelineChangeEvent {
    uri?: Uri;
    reset?: boolean;
  }

  export interface TimelineOptions {
    cursor?: string;
    limit?: number | { timestamp: number; id?: string };
  }

  export interface Timeline {
    items: TimelineItem[];
  }

  export interface TimelineProvider {
    id: string;
    label: string;
    onDidChange?: Event<TimelineChangeEvent | undefined>;
    provideTimeline(
      uri: Uri,
      options: TimelineOptions,
      token: CancellationToken,
    ): ProviderResult<Timeline>;
    dispose?(): void;
  }

  // Constructor — already in vscode-mock but not in @types/vscode
  export const TimelineItem: {
    new (label: string, timestamp: number): TimelineItem;
  };

  // workspace.registerTimelineProvider is not in @types/vscode
  export namespace workspace {
    export function registerTimelineProvider(
      scheme: string,
      provider: TimelineProvider,
    ): Disposable;
  }
}
