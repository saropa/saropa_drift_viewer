import * as vscode from 'vscode';
import type { SnapshotStore, ISnapshot } from '../timeline/snapshot-store';
import { ChangelogGenerator } from './changelog-generator';
import { ChangelogRenderer } from './changelog-renderer';
import type { ISnapshotRef } from './changelog-types';

interface ISnapshotPickItem extends vscode.QuickPickItem {
  snapshot: ISnapshot;
}

function snapshotLabel(snap: ISnapshot): string {
  return new Date(snap.timestamp).toLocaleString();
}

function toRef(snap: ISnapshot): ISnapshotRef {
  return {
    name: snap.id,
    timestamp: new Date(snap.timestamp).toLocaleString(),
  };
}

/** Register the snapshotChangelog command. */
export function registerChangelogCommands(
  context: vscode.ExtensionContext,
  snapshotStore: SnapshotStore,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.snapshotChangelog',
      async () => {
        try {
          await generateChangelog(snapshotStore);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Snapshot changelog failed: ${msg}`,
          );
        }
      },
    ),
  );
}

async function generateChangelog(
  snapshotStore: SnapshotStore,
): Promise<void> {
  const snapshots = snapshotStore.snapshots;
  if (snapshots.length < 2) {
    vscode.window.showWarningMessage(
      'Need at least 2 snapshots to generate a changelog.',
    );
    return;
  }

  const items: ISnapshotPickItem[] = snapshots.map((s) => ({
    label: snapshotLabel(s),
    description: `${s.tables.size} table(s)`,
    snapshot: s,
  }));

  const pickA = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select "from" snapshot (older)',
  });
  if (!pickA) return;

  const remaining = items.filter(
    (i) => i.snapshot.id !== pickA.snapshot.id,
  );
  const pickB = await vscode.window.showQuickPick(remaining, {
    placeHolder: 'Select "to" snapshot (newer)',
  });
  if (!pickB) return;

  const markdown = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating snapshot changelog\u2026',
    },
    async () => {
      const generator = new ChangelogGenerator();
      const changelog = generator.generate(
        toRef(pickA.snapshot),
        toRef(pickB.snapshot),
        pickA.snapshot.tables,
        pickB.snapshot.tables,
      );
      return new ChangelogRenderer().render(changelog);
    },
  );

  const doc = await vscode.workspace.openTextDocument({
    content: markdown,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc);
}
