import { GoogleAuth } from 'google-auth-library';
import { parse } from 'csv-parse/sync';
import { SheetError, type Cell } from './standings.ts';

export function spreadsheetId(value: string) {
  const text = value.trim();
  const id = text.startsWith('https://docs.google.com/spreadsheets/d/')
    ? text.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1]
    : text;
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new SheetError('Set a valid master Google Sheets link or ID in the server configuration.');
  return id;
}

export async function readMasterSheet(): Promise<Cell[][]> {
  if (!process.env.SHEETS_SPREADSHEET_ID?.trim()) throw new SheetError('The master sheet connection has not been configured yet.');
  const id = spreadsheetId(process.env.SHEETS_SPREADSHEET_ID);
  if (process.env.SHEETS_ACCESS === 'public') {
    const gid = process.env.SHEETS_GID?.trim() || '0';
    if (!/^\d+$/.test(gid)) throw new SheetError('Set the numeric tab ID for the shared test sheet.');
    const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new SheetError('The test sheet is not readable through its shared link.');
    return parse(await response.text(), { bom: true, skip_empty_lines: true, relax_column_count: true }) as string[][];
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!(email && key) && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new SheetError('Google read access has not been configured yet.');
  }
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    ...(email && key ? { credentials: { client_email: email, private_key: key.replace(/\\n/g, '\n') } } : {}),
  });
  const client = await auth.getClient();
  const range = process.env.SHEETS_RANGE?.trim() || 'Players!A1:Z';
  const response = await client.request<{ values?: Cell[][] }>({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`,
    params: { valueRenderOption: 'UNFORMATTED_VALUE' }, timeout: 10000,
  });
  return response.data.values ?? [];
}
