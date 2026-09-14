import { readMasterSheet } from '../lib/sheets.ts';
import { parseStandings, SheetError, type Cell } from '../lib/standings.ts';
import { tournamentConfig } from '../../src/lib/config.ts';

export function createHandler(read: () => Promise<Cell[][]> = readMasterSheet) {
  return async (event: { httpMethod: string }) => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: { ...headers, Allow: 'GET' }, body: JSON.stringify({ error: 'Method not allowed.' }) };
    try {
      return { statusCode: 200, headers, body: JSON.stringify(parseStandings(await read(), tournamentConfig.showScores)) };
    } catch (error) {
      // Never send raw Google errors, credentials, sheet IDs, or row contents.
      return { statusCode: 503, headers, body: JSON.stringify({ error: error instanceof SheetError ? error.message : 'Unable to read the master sheet. Check Google access and try again.' }) };
    }
  };
}

export const handler = createHandler();
