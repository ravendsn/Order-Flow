const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApp } = require('../server/app');

let activeApp;
let activeServer;

async function main() {
  const app = createApp();
  activeApp = app;
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  activeServer = server;
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { method = 'GET', body, cookie, headers: extraHeaders = {} } = {}) {
    const headers = { ...extraHeaders };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return {
      status: response.status,
      replayed: response.headers.get('idempotency-replayed'),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      body: text ? JSON.parse(text) : null,
    };
  }

  async function login(username, password) {
    const response = await request('/api/auth/login', { method: 'POST', body: { username, password } });
    assert.equal(response.status, 200);
    assert.ok(response.cookie);
    return response.cookie;
  }

  const agentCookie = await login('agent1', 'agent1234');
  const products = await request('/api/products', { cookie: agentCookie });
  assert.equal(products.status, 200);
  const simpleProduct = products.body.data.find((product) => product.available > product.reorder_level + 5);
  const expensiveProduct = products.body.data.find((product) => product.unit_price_cents > 100000 && product.available > 25);
  assert.ok(simpleProduct && expensiveProduct);

  const simpleBody = { customer_id: 1, items: [{ product_id: simpleProduct.id, qty: 1 }] };
  const simpleKey = crypto.randomUUID();
  const submitted = await request('/api/orders', { method: 'POST', body: simpleBody, cookie: agentCookie, headers: { 'Idempotency-Key': simpleKey } });
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.data.status, 'APPROVED');
  const replay = await request('/api/orders', { method: 'POST', body: simpleBody, cookie: agentCookie, headers: { 'Idempotency-Key': simpleKey } });
  assert.equal(replay.status, 201);
  assert.equal(replay.replayed, 'true');

  const approvalQty = Math.ceil(2_000_000 / expensiveProduct.unit_price_cents) + 1;
  const approvalBody = { customer_id: 1, items: [{ product_id: expensiveProduct.id, qty: approvalQty }] };
  const approvalSubmit = await request('/api/orders', { method: 'POST', body: approvalBody, cookie: agentCookie, headers: { 'Idempotency-Key': crypto.randomUUID() } });
  assert.equal(approvalSubmit.status, 201);
  assert.equal(approvalSubmit.body.data.status, 'PENDING_APPROVAL');
  const approvalId = approvalSubmit.body.data.approval.approval_id;

  const officeCookie = await login('office1', 'office1234');
  const approvals = await request('/api/approvals', { cookie: officeCookie });
  assert.equal(approvals.status, 200);
  assert.ok(approvals.body.data.some((approval) => approval.id === approvalId));
  const approved = await request(`/api/approvals/${approvalId}/approve`, { method: 'POST', body: {}, cookie: officeCookie });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.status, 'APPROVED');

  const warehouseCookie = await login('warehouse1', 'warehouse1234');
  const pick = await request(`/api/orders/${approved.body.data.id}/pick-list`, { method: 'POST', cookie: warehouseCookie });
  assert.equal(pick.status, 201);
  const packed = await request(`/api/pick-lists/${pick.body.data.id}/pack`, { method: 'POST', cookie: warehouseCookie });
  assert.equal(packed.status, 200);
  const dispatched = await request(`/api/orders/${approved.body.data.id}/dispatch`, { method: 'POST', cookie: warehouseCookie });
  assert.equal(dispatched.status, 200);
  assert.equal(dispatched.body.data.status, 'FULFILLED');

  const returnItem = dispatched.body.data.items[0];
  const returnBody = { note: 'Smoke-test return', items: [{ order_item_id: returnItem.id, qty: 1, reason_code: 'CUSTOMER_REFUSED', is_restockable: true }] };
  const returnKey = crypto.randomUUID();
  const recordedReturn = await request(`/api/orders/${approved.body.data.id}/returns`, { method: 'POST', body: returnBody, cookie: warehouseCookie, headers: { 'Idempotency-Key': returnKey } });
  assert.equal(recordedReturn.status, 201);
  const returnReplay = await request(`/api/orders/${approved.body.data.id}/returns`, { method: 'POST', body: returnBody, cookie: warehouseCookie, headers: { 'Idempotency-Key': returnKey } });
  assert.equal(returnReplay.status, 201);
  assert.equal(returnReplay.replayed, 'true');

  const cancelBody = { customer_id: 1, items: [{ product_id: simpleProduct.id, qty: 1 }] };
  const cancelSubmit = await request('/api/orders', { method: 'POST', body: cancelBody, cookie: agentCookie, headers: { 'Idempotency-Key': crypto.randomUUID() } });
  assert.equal(cancelSubmit.status, 201);
  const cancelled = await request(`/api/orders/${cancelSubmit.body.data.id}/cancel`, { method: 'POST', body: { reason: 'Smoke-test cancellation' }, cookie: officeCookie });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.status, 'CANCELLED');

  const insufficientBody = { customer_id: 1, items: [{ product_id: simpleProduct.id, qty: simpleProduct.available + 10000 }] };
  const insufficientKey = crypto.randomUUID();
  const insufficient = await request('/api/orders', { method: 'POST', body: insufficientBody, cookie: agentCookie, headers: { 'Idempotency-Key': insufficientKey } });
  assert.equal(insufficient.status, 409);
  const insufficientReplay = await request('/api/orders', { method: 'POST', body: insufficientBody, cookie: agentCookie, headers: { 'Idempotency-Key': insufficientKey } });
  assert.equal(insufficientReplay.status, 409);
  assert.equal(insufficientReplay.replayed, 'true');

  const intake = await request('/api/intake/parse', { method: 'POST', body: { raw_text: '1 case cola' }, cookie: agentCookie });
  assert.equal(intake.status, 501);

  console.log(JSON.stringify({
    passed: true,
    checks: ['auth', 'product-read', 'idempotent-submit', 'approval', 'pick-pack-dispatch', 'return-restock', 'cancel-release', 'insufficient-stock-replay', 'm6-stub'],
  }, null, 2));
  await new Promise((resolve) => server.close(resolve));
  app.locals.db.close();
  activeServer = null;
  activeApp = null;
}

main().catch(async (error) => {
  console.error(error);
  if (activeServer) await new Promise((resolve) => activeServer.close(resolve));
  activeApp?.locals.db.close();
  process.exitCode = 1;
});
