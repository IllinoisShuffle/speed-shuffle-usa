import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../netlify/functions/tito-webhook.ts';

const okFetch = (status = 200, body = '{"ok":true}') => async () => ({ status, text: async () => body }) as Response;

test('rejects non-POST requests without forwarding', async () => {
  let called = false;
  const handler = createHandler('https://script.google.com/macros/s/id/exec', async () => { called = true; return okFetch()(); });
  const result = await handler({ httpMethod: 'GET', body: null });
  assert.equal(result.statusCode, 405);
  assert.equal(called, false);
});

test('500s without leaking anything when no target URL is configured', async () => {
  const handler = createHandler(undefined, okFetch());
  const result = await handler({ httpMethod: 'POST', body: '{}' });
  assert.equal(result.statusCode, 500);
});

test('forwards method, body and query string (including token) to the target URL', async () => {
  const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
  const handler = createHandler('https://script.google.com/macros/s/id/exec', async (url, init) => {
    calls.push([url, init]);
    return okFetch()();
  });
  await handler({ httpMethod: 'POST', body: '{"slug":"t-1"}', queryStringParameters: { token: 'secret' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://script.google.com/macros/s/id/exec?token=secret');
  assert.equal(calls[0][1]?.method, 'POST');
  assert.equal(calls[0][1]?.body, '{"slug":"t-1"}');
});

test('decodes a base64-encoded body before forwarding', async () => {
  const calls: (RequestInit | undefined)[] = [];
  const handler = createHandler('https://script.google.com/macros/s/id/exec', async (_url, init) => { calls.push(init); return okFetch()(); });
  await handler({ httpMethod: 'POST', body: Buffer.from('{"slug":"t-1"}').toString('base64'), isBase64Encoded: true });
  assert.equal(calls[0]?.body, '{"slug":"t-1"}');
});

test('relays the real upstream status and body back to the caller', async () => {
  const handler = createHandler('https://script.google.com/macros/s/id/exec', okFetch(200, '{"ok":true,"result":{}}'));
  const result = await handler({ httpMethod: 'POST', body: '{}' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body, '{"ok":true,"result":{}}');
});

test('a network failure reaching the target returns 502 without leaking the (token-bearing) target URL', async () => {
  const handler = createHandler('https://script.google.com/macros/s/id/exec?token=super-secret', async () => { throw new Error('fetch failed: https://script.google.com/macros/s/id/exec?token=super-secret'); });
  const result = await handler({ httpMethod: 'POST', body: '{}' });
  assert.equal(result.statusCode, 502);
  assert.ok(!result.body.includes('super-secret'));
});
