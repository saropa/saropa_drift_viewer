/**
 * Parses clipboard text into structured rows.
 * Supports TSV (Excel/Sheets), CSV, and HTML table formats.
 */

import type { ClipboardFormat, IParsedClipboard } from './clipboard-import-types';

export class ClipboardParser {
  /**
   * Parse clipboard text into structured data.
   * Auto-detects format based on content.
   */
  parse(text: string): IParsedClipboard {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Clipboard is empty');
    }

    if (this._looksLikeHtml(trimmed)) {
      return this._parseHtml(trimmed);
    }

    const format = this._detectDelimiter(trimmed);
    if (format === 'tsv') {
      return this._parseTsv(trimmed);
    }
    return this._parseCsv(trimmed);
  }

  /**
   * Check if text appears to be HTML table data.
   */
  private _looksLikeHtml(text: string): boolean {
    const lower = text.toLowerCase();
    return lower.includes('<table') || lower.includes('<tr');
  }

  /**
   * Detect whether text is tab-separated or comma-separated.
   * Uses first line to count delimiters.
   */
  private _detectDelimiter(text: string): 'tsv' | 'csv' {
    const firstLine = text.split(/\r?\n/)[0] ?? '';

    const tabCount = (firstLine.match(/\t/g) ?? []).length;

    let commaCount = 0;
    let inQuote = false;
    for (const ch of firstLine) {
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        commaCount++;
      }
    }

    return tabCount > 0 && tabCount >= commaCount ? 'tsv' : 'csv';
  }

  /**
   * Parse tab-separated values.
   */
  private _parseTsv(text: string): IParsedClipboard {
    const lines = text.split(/\r?\n/)
      .map((line) => line.split('\t').map((cell) => cell.trim()))
      .filter((cells) => cells.some((c) => c.length > 0));

    if (lines.length === 0) {
      throw new Error('No data found in clipboard');
    }

    return {
      format: 'tsv',
      headers: lines[0],
      rows: lines.slice(1),
      rawText: text,
    };
  }

  /**
   * Parse CSV with RFC 4180 compliant quoted field handling.
   */
  private _parseCsv(text: string): IParsedClipboard {
    const lines = this._parseCsvLines(text);

    if (lines.length === 0) {
      throw new Error('No data found in clipboard');
    }

    return {
      format: 'csv',
      headers: lines[0],
      rows: lines.slice(1),
      rawText: text,
    };
  }

  /**
   * RFC 4180 compliant CSV parsing.
   * Handles quoted fields with embedded commas and newlines.
   */
  private _parseCsvLines(text: string): string[][] {
    const rows: string[][] = [];
    let current: string[] = [];
    let field = '';
    let inQuote = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inQuote) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuote = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        current.push(field.trim());
        field = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field.trim());
        field = '';
        if (current.some((c) => c.length > 0)) {
          rows.push(current);
        }
        current = [];
        if (ch === '\r') {
          i++;
        }
      } else if (ch === '\r') {
        current.push(field.trim());
        field = '';
        if (current.some((c) => c.length > 0)) {
          rows.push(current);
        }
        current = [];
      } else {
        field += ch;
      }
    }

    if (field || current.length > 0) {
      current.push(field.trim());
      if (current.some((c) => c.length > 0)) {
        rows.push(current);
      }
    }

    return rows;
  }

  /**
   * Parse HTML table data using regex extraction.
   * Works with data copied from Excel, Google Sheets, web pages.
   */
  private _parseHtml(text: string): IParsedClipboard {
    const rows: string[][] = [];

    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;

    while ((trMatch = trRegex.exec(text)) !== null) {
      const cells: string[] = [];
      const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let tdMatch: RegExpExecArray | null;

      while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
        const cellContent = tdMatch[1]
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&quot;/gi, '"')
          .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
          .trim();
        cells.push(cellContent);
      }

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length === 0) {
      throw new Error('No table data found in HTML clipboard');
    }

    return {
      format: 'html',
      headers: rows[0],
      rows: rows.slice(1),
      rawText: text,
    };
  }
}

/**
 * Auto-map clipboard headers to table columns by name similarity.
 */
export function autoMapColumns(
  clipboardHeaders: string[],
  tableColumns: string[],
): import('./clipboard-import-types').IColumnMapping[] {
  return clipboardHeaders.map((header, i) => {
    const normalized = header.toLowerCase().replace(/[_\s-]/g, '');

    let match = tableColumns.find(
      (col) => col.toLowerCase() === header.toLowerCase(),
    );

    if (!match) {
      match = tableColumns.find(
        (col) => col.toLowerCase().replace(/[_\s-]/g, '') === normalized,
      );
    }

    return {
      clipboardIndex: i,
      clipboardHeader: header,
      tableColumn: match ?? null,
    };
  });
}

/**
 * Build import payload from parsed clipboard data and column mapping.
 */
export function buildImportPayload(
  parsed: IParsedClipboard,
  mapping: import('./clipboard-import-types').IColumnMapping[],
): Record<string, unknown>[] {
  const activeMappings = mapping.filter((m) => m.tableColumn !== null);

  return parsed.rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (const m of activeMappings) {
      const value = row[m.clipboardIndex];
      record[m.tableColumn!] = value === '' || value === undefined ? null : value;
    }
    return record;
  });
}
