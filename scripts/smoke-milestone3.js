const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const EVENT_NAMES = require('../server/shared/events/event-names');

let app;
let server;

async function main() {
  app = createApp();
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const indexResponse = await fetch(`${baseUrl}/`);
  assert.equal(indexResponse.status, 200);
  assert.match(indexResponse.headers.get('content-type') || '', /^text\/html/);
  const indexHtml = await indexResponse.text();
  assert.match(indexHtml, /href="\.\/css\/app\.css"/);
  assert.match(indexHtml, /src="\.\/js\/app\.js"/);

  for (const [path, contentType] of [
    ['/css/app.css', 'text/css'],
    ['/js/app.js', 'text/javascript'],
    ['/assets/lodo.png', 'image/png'],
  ]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') || '', new RegExp(`^${contentType}`), path);
  }

  async function request(path, { method = 'GET', body, cookie } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return {
      status: response.status,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      body: text ? JSON.parse(text) : null,
    };
  }

  const login = await request('/api/auth/login', { method: 'POST', body: { username: 'manager1', password: 'manager1234' } });
  assert.equal(login.status, 200);
  assert.ok(login.cookie);

  const checks = [
    ['/api/analytics/overview', (body) => Boolean(body.revenue_cents && body.period)],
    ['/api/analytics/movers', (body) => Array.isArray(body.fast) && Array.isArray(body.slow)],
    ['/api/analytics/sales-trend?granularity=day', (body) => Array.isArray(body.rows)],
    ['/api/analytics/sales-trend?granularity=week', (body) => body.granularity === 'week'],
    ['/api/analytics/abc', (body) => Array.isArray(body)],
    ['/api/analytics/days-of-stock', (body) => Array.isArray(body)],
    ['/api/analytics/unmet-demand?group_by=product', (body) => Array.isArray(body.rows)],
    ['/api/analytics/returns-by-reason', (body) => Array.isArray(body.rows)],
    ['/api/alerts', (body) => Array.isArray(body)],
    ['/api/actions', (body) => Array.isArray(body)],
  ];
  for (const [path, validate] of checks) {
    const response = await request(path, { cookie: login.cookie });
    assert.equal(response.status, 200, path);
    assert.equal(validate(response.body.data), true, path);
  }

  const streamResponse = await fetch(`${baseUrl}/api/alerts/stream`, { headers: { cookie: login.cookie } });
  assert.equal(streamResponse.status, 200);
  assert.equal(streamResponse.headers.get('content-type')?.startsWith('text/event-stream'), true);
  const reader = streamResponse.body.getReader();
  const connected = await reader.read();
  assert.match(new TextDecoder().decode(connected.value), /connected/);
  app.locals.eventBus.publish(EVENT_NAMES.STOCK_CHANGED, { product_id: 1, on_hand: 10, reserved: 2, available: 8 });
  const event = await reader.read();
  assert.match(new TextDecoder().decode(event.value), /event: stock\.changed/);
  await reader.cancel();

  console.log(JSON.stringify({
    passed: true,
    checks: ['kpis', 'movers', 'sales-trend', 'abc-pareto', 'days-of-stock', 'unmet-demand', 'returns-by-reason', 'alerts', 'todays-actions', 'sse-event-bus'],
  }, null, 2));
  await new Promise((resolve) => server.close(resolve));
  app.locals.db.close();
  server = null;
  app = null;
}

main().catch(async (error) => {
  console.error(error);
  if (server) await new Promise((resolve) => server.close(resolve));
  app?.locals.db.close();
  process.exitCode = 1;
});
