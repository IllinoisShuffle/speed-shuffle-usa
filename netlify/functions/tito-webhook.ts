/**
 * Proxies Tito's registration webhook to the Apps Script Tito-ingest Web App.
 *
 * Apps Script Web Apps answer every request with a 302 to a second, GET-only
 * content URL before the real response is delivered — this is a platform
 * behavior, not something the Apps Script code controls. Tito's webhook
 * sender doesn't complete that hop (confirmed: it either doesn't follow the
 * redirect, or follows it without downgrading to GET), so it sees a bare 302
 * as a delivery failure and retries the same event for hours, risking Tito
 * disabling the webhook — even though the registration already landed, since
 * Apps Script runs doPost to completion before issuing the redirect.
 *
 * This function forwards Tito's POST (body and query string, including the
 * shared `token`) to the configured Apps Script URL, lets `fetch` complete
 * the redirect the way a browser or curl would (downgrading to GET per the
 * fetch spec for a 301/302 response to a POST), and returns the real
 * upstream status/body straight to Tito.
 */

const DEFAULT_TARGET_URL = process.env.APPS_SCRIPT_INGEST_URL;

type NetlifyEvent = {
  httpMethod: string;
  body: string | null;
  isBase64Encoded?: boolean;
  queryStringParameters?: Record<string, string | undefined> | null;
};

export function createHandler(targetUrl: string | undefined = DEFAULT_TARGET_URL, doFetch: typeof fetch = fetch) {
  return async (event: NetlifyEvent) => {
    const headers = { 'Content-Type': 'application/json' };

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: { ...headers, Allow: 'POST' }, body: JSON.stringify({ error: 'Method not allowed.' }) };
    }

    if (!targetUrl) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Webhook target is not configured.' }) };
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(event.queryStringParameters || {})) {
      if (value !== undefined) query.set(key, value);
    }
    const forwardUrl = `${targetUrl}${query.toString() ? '?' + query.toString() : ''}`;

    const rawBody = event.body || '';
    const body = event.isBase64Encoded ? Buffer.from(rawBody, 'base64').toString('utf8') : rawBody;

    try {
      const upstream = await doFetch(forwardUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      return { statusCode: upstream.status, headers, body: await upstream.text() };
    } catch {
      // Never surface the raw error: it may embed forwardUrl, which carries the shared ingest token.
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Unable to reach the registration ingest webhook.' }) };
    }
  };
}

export const handler = createHandler();
