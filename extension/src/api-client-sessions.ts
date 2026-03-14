/** HTTP-only session and import API methods (extracted from api-client). */

import type { IImportResult, ISessionData, ISessionShareResult } from './api-types';

export async function importDataRequest(
  baseUrl: string, headers: Record<string, string>,
  format: string, table: string, data: string,
): Promise<IImportResult> {
  const resp = await fetch(`${baseUrl}/api/import`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ format, table, data }),
  });
  if (!resp.ok) {
    throw new Error(`Import failed: ${resp.status}`);
  }
  return resp.json() as Promise<IImportResult>;
}

export async function sessionShareRequest(
  baseUrl: string, headers: Record<string, string>,
  state: Record<string, unknown>,
): Promise<ISessionShareResult> {
  const resp = await fetch(`${baseUrl}/api/session/share`, {
    method: 'POST',
    headers,
    body: JSON.stringify(state),
  });
  if (!resp.ok) {
    throw new Error(`Session share failed: ${resp.status}`);
  }
  return resp.json() as Promise<ISessionShareResult>;
}

export async function sessionGetRequest(
  baseUrl: string, headers: Record<string, string>,
  id: string,
): Promise<ISessionData> {
  const resp = await fetch(
    `${baseUrl}/api/session/${encodeURIComponent(id)}`,
    { headers },
  );
  if (!resp.ok) {
    throw new Error(`Session get failed: ${resp.status}`);
  }
  return resp.json() as Promise<ISessionData>;
}

export async function sessionAnnotateRequest(
  baseUrl: string, headers: Record<string, string>,
  id: string, text: string, author: string,
): Promise<void> {
  const resp = await fetch(
    `${baseUrl}/api/session/${encodeURIComponent(id)}/annotate`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, author }),
    },
  );
  if (!resp.ok) {
    throw new Error(`Session annotate failed: ${resp.status}`);
  }
}
