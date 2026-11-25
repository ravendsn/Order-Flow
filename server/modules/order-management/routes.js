const express = require('express');
const env = require('../../config/env');
const { ORDER_STATUSES } = require('../../config/constants');
const { authenticate } = require('../../shared/middleware/authenticate');
const requireRole = require('../../shared/middleware/require-role');
const { requireIdempotencyKey } = require('../../shared/middleware/idempotency');
const { requireJsonBody, parsePagination, parseDateQuery, validationError } = require('../../shared/middleware/validate');
const { sendData, getPositiveId, requireText } = require('../../shared/http');
const { recordAudit } = require('../../shared/audit/service');
const { replayIfAvailable } = require('../../shared/idempotency-store');
const { transaction } = require('../../db/connection');
const AppError = require('../../shared/errors/app-error');
const ERROR_CODES = require('../../shared/errors/error-codes');
const { processSubmit, getOrder, getOrderRecord, cancelOrder } = require('./service');

const router = express.Router();
router.use(authenticate({ secret: env.sessionSecret }));

function ensureOrderScope(req, order) {
  if (!order) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Order not found');
  if (req.user.role === 'AGENT' && order.agent_id !== req.user.id) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Order not found');
}

router.get('/customers', requireRole('AGENT', 'OFFICE', 'MANAGER', 'ADMIN'), (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const q = req.query.q ? `%${String(req.query.q).trim()}%` : null;
    const where = ['is_active = 1'];
    const params = [];
    if (q) { where.push('(name LIKE ? OR contact_no LIKE ?)'); params.push(q, q); }
    const clause = `WHERE ${where.join(' AND ')}`;
    const total = req.db.prepare(`SELECT COUNT(*) AS total FROM customers ${clause}`).get(...params).total;
    const rows = req.db.prepare(`SELECT id, name, customer_type, contact_no, address, is_active, created_at
      FROM customers ${clause} ORDER BY name LIMIT ? OFFSET ?`).all(...params, limit, offset).map((row) => ({ ...row, is_active: Boolean(row.is_active) }));
    return sendData(res, rows, 200, { page, limit, total });
  } catch (error) { return next(error); }
});

router.post('/customers', requireRole('AGENT', 'OFFICE', 'ADMIN'), requireJsonBody, (req, res, next) => {
  try {
    const name = requireText(req.body?.name, 'name', { max: 200 });
    const customerType = req.body?.customer_type === undefined ? null : requireText(req.body.customer_type, 'customer_type', { max: 100 });
    const contactNo = req.body?.contact_no === undefined ? null : requireText(req.body.contact_no, 'contact_no', { max: 50 });
    const address = req.body?.address === undefined ? null : requireText(req.body.address, 'address', { max: 300 });
    const result = req.db.prepare('INSERT INTO customers (name, customer_type, contact_no, address) VALUES (?, ?, ?, ?)').run(name, customerType, contactNo, address);
    const customer = req.db.prepare('SELECT id, name, customer_type, contact_no, address, is_active, created_at FROM customers WHERE id = ?').get(result.lastInsertRowid);
    recordAudit(req.db, { actorUserId: req.user.id, action: 'CUSTOMER_CREATED', entityType: 'CUSTOMER', entityId: customer.id, after: customer });
    return sendData(res, { ...customer, is_active: Boolean(customer.is_active) }, 201);
  } catch (error) { return next(error); }
});

router.patch('/customers/:id', requireRole('OFFICE', 'ADMIN'), requireJsonBody, (req, res, next) => {
  try {
    const id = getPositiveId(req.params.id);
    const before = req.db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!before) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Customer not found');
    const fields = [];
    const params = [];
    for (const [key, max] of [['name', 200], ['customer_type', 100], ['contact_no', 50], ['address', 300]]) {
      if (req.body[key] !== undefined) fields.push(`${key} = ?`), params.push(req.body[key] === null ? null : requireText(req.body[key], key, { max }));
    }
    if (req.body.is_active !== undefined) {
      if (typeof req.body.is_active !== 'boolean') throw validationError([{ field: 'is_active', message: 'must be boolean' }]);
      fields.push('is_active = ?'); params.push(req.body.is_active ? 1 : 0);
    }
    if (!fields.length) throw validationError([{ field: 'body', message: 'must include an editable field' }]);
    params.push(id);
    req.db.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const after = req.db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    recordAudit(req.db, { actorUserId: req.user.id, action: 'CUSTOMER_UPDATED', entityType: 'CUSTOMER', entityId: id, before, after });
    return sendData(res, { ...after, is_active: Boolean(after.is_active) });
  } catch (error) { return next(error); }
});

router.post('/orders', requireRole('AGENT', 'OFFICE'), requireJsonBody, requireIdempotencyKey, (req, res, next) => {
  try {
    const result = processSubmit(req.db, { userId: req.user.id, body: req.body, idempotency: req.idempotency });
    if (result.replay) return replayIfAvailable(result.row, res);
    return res.status(result.status).json(result.body);
  } catch (error) { return next(error); }
});

router.get('/orders', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const where = [];
    const params = [];
    if (req.user.role === 'AGENT') { where.push('o.agent_id = ?'); params.push(req.user.id); }
    if (req.query.status !== undefined) {
      if (!ORDER_STATUSES.includes(req.query.status)) throw validationError([{ field: 'status', message: 'invalid order status' }]);
      where.push('o.status = ?'); params.push(req.query.status);
    }
    for (const [key, column] of [['customer_id', 'o.customer_id'], ['agent_id', 'o.agent_id']]) {
      if (req.query[key] !== undefined) { if (req.user.role === 'AGENT' && key === 'agent_id' && Number(req.query[key]) !== req.user.id) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Order not found'); params.push(getPositiveId(req.query[key], key)); where.push(`${column} = ?`); }
    }
    if (req.query.q) { where.push('(o.order_no LIKE ? OR c.name LIKE ?)'); const q = `%${String(req.query.q).trim()}%`; params.push(q, q); }
    const from = parseDateQuery(req.query.from, 'from');
    const to = parseDateQuery(req.query.to, 'to');
    if (from) { where.push('o.submitted_at >= ?'); params.push(`${from}T00:00:00.000Z`); }
    if (to) { where.push('o.submitted_at < ?'); params.push(`${to}T23:59:59.999Z`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = req.db.prepare(`SELECT COUNT(*) AS total FROM orders o JOIN customers c ON c.id = o.customer_id ${clause}`).get(...params).total;
    const rows = req.db.prepare(`SELECT o.id, o.order_no, o.customer_id, c.name AS customer_name,
      o.agent_id, u.full_name AS agent_name, o.channel, o.status, o.total_cents,
      o.approval_mode, o.approval_reasons, o.submitted_at, o.approved_at, o.dispatched_at
      FROM orders o JOIN customers c ON c.id = o.customer_id JOIN users u ON u.id = o.agent_id
      ${clause} ORDER BY o.submitted_at DESC, o.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
      .map((row) => ({ ...row, approval_reasons: row.approval_reasons ? row.approval_reasons.split(',') : [] }));
    return sendData(res, rows, 200, { page, limit, total });
  } catch (error) { return next(error); }
});

router.get('/orders/:id', (req, res, next) => {
  try {
    const orderId = getPositiveId(req.params.id);
    const record = getOrderRecord(req.db, orderId);
    ensureOrderScope(req, record);
    return sendData(res, getOrder(req.db, orderId));
  } catch (error) { return next(error); }
});

router.post('/orders/:id/cancel', requireRole('AGENT', 'OFFICE', 'MANAGER', 'ADMIN'), requireJsonBody, (req, res, next) => {
  try {
    const orderId = getPositiveId(req.params.id);
    const record = getOrderRecord(req.db, orderId);
    ensureOrderScope(req, record);
    const reason = requireText(req.body?.reason, 'reason', { max: 300 });
    return sendData(res, cancelOrder(req.db, { orderId, actorUserId: req.user.id, reason }));
  } catch (error) { return next(error); }
});

module.exports = router;
