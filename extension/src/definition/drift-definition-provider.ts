import * as vscode from 'vscode';
import { DriftApiClient, TableMetadata } from '../api-client';
import { escapeRegex, snakeToCamel, snakeToPascal } from '../dart-names';
import {
  classifyIdentifier,
  extractEnclosingString,
  getWordAt,
  isInsideSqlString,
} from './sql-string-detector';

/**
 * VS Code DefinitionProvider that resolves SQL table/column names
 * inside Dart string literals to their Drift table class definitions.
 *
 * Works for both Go to Definition (F12) and Peek Definition (Alt+F12).
 */
export class DriftDefinitionProvider implements vscode.DefinitionProvider {
  private _schemaCache: TableMetadata[] | null = null;
  private _schemaCacheTime = 0;
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(private readonly _client: DriftApiClient) {}

  /** Clear cached schema metadata (e.g. on generation change). */
  clearCache(): void {
    this._schemaCache = null;
    this._schemaCacheTime = 0;
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): Promise<vscode.Location | null> {
    if (document.languageId !== 'dart') return null;

    const lineText = document.lineAt(position.line).text;
    if (!isInsideSqlString(lineText, position.character)) return null;

    const wordInfo = getWordAt(lineText, position.character);
    if (!wordInfo) return null;

    const tables = await this._getSchema();
    if (!tables || tables.length === 0) return null;

    const knownTableNames = tables.map((t) => t.name);
    const knownColumns = new Map(
      tables.map((t) => [t.name, t.columns.map((c) => c.name)] as const),
    );

    const sqlContext =
      extractEnclosingString(lineText, position.character) ?? lineText;

    const classification = classifyIdentifier(
      wordInfo.word,
      sqlContext,
      knownTableNames,
      knownColumns,
    );
    if (!classification) return null;

    if (classification.type === 'table') {
      return this._findTableDefinition(wordInfo.word);
    }

    if (classification.type === 'column' && classification.tableName) {
      return this._findColumnDefinition(
        wordInfo.word,
        classification.tableName,
      );
    }

    return null;
  }

  private async _getSchema(): Promise<TableMetadata[] | null> {
    const now = Date.now();
    if (
      this._schemaCache &&
      now - this._schemaCacheTime < DriftDefinitionProvider.CACHE_TTL_MS
    ) {
      return this._schemaCache;
    }
    try {
      this._schemaCache = await this._client.schemaMetadata();
      this._schemaCacheTime = now;
      return this._schemaCache;
    } catch {
      return this._schemaCache; // return stale cache on error
    }
  }

  private async _findTableDefinition(
    sqlTableName: string,
  ): Promise<vscode.Location | null> {
    const className = escapeRegex(snakeToPascal(sqlTableName));
    const pattern = new RegExp(
      `class\\s+${className}\\s+extends\\s+\\w*Table\\b`,
    );

    const dartFiles = await vscode.workspace.findFiles(
      '**/*.dart',
      '**/build/**',
    );

    for (const fileUri of dartFiles) {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const text = doc.getText();
      const match = pattern.exec(text);
      if (match) {
        const pos = doc.positionAt(match.index);
        return new vscode.Location(fileUri, pos);
      }
    }
    return null;
  }

  private async _findColumnDefinition(
    columnName: string,
    sqlTableName: string,
  ): Promise<vscode.Location | null> {
    const className = escapeRegex(snakeToPascal(sqlTableName));
    const classPattern = new RegExp(
      `class\\s+${className}\\s+extends\\s+\\w*Table\\b`,
    );

    const dartFiles = await vscode.workspace.findFiles(
      '**/*.dart',
      '**/build/**',
    );

    for (const fileUri of dartFiles) {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const text = doc.getText();

      if (!classPattern.test(text)) continue;

      // Search for column getter — try both original and camelCase names
      const camelName = snakeToCamel(columnName);
      const escapedOriginal = escapeRegex(columnName);
      const escapedCamel = escapeRegex(camelName);
      const names =
        camelName !== columnName
          ? `${escapedOriginal}|${escapedCamel}`
          : escapedOriginal;
      const colPattern = new RegExp(`get\\s+(${names})\\s*=>`);
      const colMatch = colPattern.exec(text);
      if (colMatch) {
        const pos = doc.positionAt(colMatch.index);
        return new vscode.Location(fileUri, pos);
      }
    }
    return null;
  }
}
