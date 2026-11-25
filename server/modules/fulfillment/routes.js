const express = require('express');
const env = require('../../config/env');
const { authenticate } = require('../../shared/middleware/authenticate');
const requireRole = require('../../shared/middleware/require-role');
const { requireIdempotencyKey } = require('../../shared/middleware/idempotency');
const { requireJsonBody, parsePagination, parseDateQuery, validationError } = require('../../shared/middleware/validate');
const { sendData, getPositiveId, requireText, requireInteger } = require('../../shared/http');
const { transaction } = require('../../db/connection');
const { recordAudit } = require('../../shared/audit/service');
const { claimIdempotency, replayIfAvailable, storeIdempotencyResponse } = require('../../shared/idempotency-store');
const stock = require('../product-inventory/stock/service');
const { getOrder, getOrderRecord } = require('../order-management/service');
const AppError = require('../../shared/errors/app-error');
const ERROR_CODES = require('../../shared/errors/error-codes');

const router = express.Router();
router.use(authenticate({ secret: env.sessionSecret }));

function pickList(db, id) {
  const row = db.prepare(`SELECT pl.*, o.order_no, o.status AS order_status, c.name AS customer_name
    FROM pick_lists pl JOIN orders o ON o.id = pl.order_id JOIN customers c ON c.id = o.customer_id
    WHERE pl.id = ?`).get(id);
  if (!row) return null;
  const items = db.prepare(`SELECT oi.id AS order_item_id, oi.product_id, p.sku, p.name, p.unit, oi.qty, oi.unit_price_cents
    FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id`).all(row.order_id);
  return { id: row.id, order_id: row.order_id, order_no: row.order_no, customer_name: row.customer_name, order_status: row.order_status, status: row.status, generated_by: row.generated_by, generated_at: row.generated_at, packed_by: row.packed_by, packed_at: row.packed_at, items };
}

router.post('/orders/:id/pick-list', requireRole('WAREHOUSE', 'ADMIN'), (req, res, next) => {
  try {
    const orderId = getPositiveId(req.params.id);
    const result = transaction(req.db, () => {
      const order = getOrderRecord(req.db, orderId);
      if (!order) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Order not found');
      if (order.status !== 'APPROVED') throw new AppError(409, ERROR_CODES.INVALID_TRANSITION, 'Only approved orders can receive a pick list');
      const timestamp = new Date().toISOString();
      const inserted = req.db.prepare(`INSERT INTO pick_lists (order_id, status, generated_by, generated_at)
        VALUES (?, 'GENERATED', ?, ?)`).run(orderId, req.user.id, timestamp);
      req.db.prepare("UPDATE orders SET status = 'PICKING', updated_at = ? WHERE id = ?").run(timestamp, orderId);
      recordAudit(req.db, { actorUserId: req.user.id, action: 'PICK_LIST_GENERATED', entityType: 'ORDER', entityId: orderId, after: { status: 'PICKING', pick_list_id: inserted.lastInsertRowid }, createdAt: timestamp });
      return pickList(req.db, Number(inserted.lastInsertRowid));
    });
    return sendData(res, result, 201);
  } catch (error) { return next(error); }
});

router.get('/pick-lists', requireRole('WAREHOUSE', 'OFFICE', 'MANAGER', 'ADMIN'), (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = req.query.status;
    if (status !== undefined && !['GENERATED', 'PACKED', 'DISPATCHED'].includes(status)) throw validationError([{ field: 'status', message: 'invalid pick-list status' }]);
    const params = status ? [status] : [];
    const clause = status ? "WHERE pl.status = ?" : '';
    const total = req.db.prepare(`SELECT COUNT(*) AS total FROM pick_lists pl ${clause}`).get(...params).total;
    const rows = req.db.prepare(`SELECT pl.id, pl.order_id, o.order_no, c.name AS customer_name,
      pl.status, pl.generated_by, pl.generated_at, pl.packed_by, pl.packed_at
      FROM pick_lists pl JOIN orders o ON o.id = pl.order_id JOIN customers c ON c.id = o.customer_id
      ${clause} ORDER BY pl.generated_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return sendData(res, rows, 200, { page, limit, total });
  } catch (error) { return next(error); }
});

router.get('/pick-lists/:id', requireRole('WAREHOUSE', 'OFFICE', 'MANAGER', 'ADMIN'), (req, res, next) => {
  try {
    const result = pickList(req.db, getPositiveId(req.params.id));
    if (!result) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Pick list not found');
    return sendData(res, result);
  } catch (error) { return next(error); }
});

router.post('/pick-lists/:id/pack', requireRole('WAREHOUSE', 'ADMIN'), (req, res, next) => {
  try {
    const pickListId = getPositiveId(req.params.id);
    const result = transaction(req.db, () => {
      const list = req.db.prepare('SELECT * FROM pick_lists WHERE id = ?').get(pickListId);
      if (!list) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Pick list not found');
      if (list.status !== 'GENERATED') throw new AppError(409, ERROR_CODES.INVALID_TRANSITION, 'Pick list is not awaiting packing');
      const timestamp = new Date().toISOString();
      req.db.prepare("UPDATE pick_lists SET status = 'PACKED', packed_by = ?, packed_at = ? WHERE id = ?").run(req.user.id, timestamp, pickListId);
      recordAudit(req.db, { actorUserId: req.user.id, action: 'PICK_LIST_PACKED', entityType: 'PICK_LIST', entityId: pickListId, after: { status: 'PACKED' }, createdAt: timestamp });
      return pickList(req.db, pickListId);
    });
    return sendData(res, result);
  } catch (error) { return next(error); }
});

router.post('/orders/:id/dispatch', requireRole('WAREHOUSE', 'ADMIN'), (req, res, next) => {
  try {
    const orderId = getPositiveId(req.params.id);
    const remarks = req.body?.remarks === undefined ? null : requireText(req.body.remarks, 'remarks', { max: 500 });
    const result = transaction(req.db, () => {
      const order = getOrderRecord(req.db, orderId);
      if (!order) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Order not found');
      if (order.status !== 'PICKING') throw new AppError(409, ERROR_CODES.INVALID_TRANSITION, 'Only picking orders can be dispatched');
      const list = req.db.prepare("SELECT * FROM pick_lists WHERE order_id = ? AND status = 'PACKED'").get(orderId);
      if (!list) throw new AppError(409, ERROR_CODES.INVALID_TRANSITION, 'Order must have a packed pick list before dispatch');
      const timestamp = new Date().toISOString();
      stock.consumeOrderReservations(req.db, { orderId, actorUserId: req.user.id });
      const dispatch = req.db.prepare('INSERT INTO dispatches (order_id, dispatched_by, dispatched_at, remarks) VALUES (?, ?, ?, ?)').run(orderId, req.user.id, timestamp, remarks);
      req.db.prepare("UPDATE pick_lists SET status = 'DISPATCHED' WHERE id = ?").run(list.id);
      req.db.prepare("UPDATE orders SET status = 'FULFILLED', dispatched_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, orderId);
      recordAudit(req.db, { actorUserId: req.user.id, action: 'ORDER_DISPATCHED', entityType: 'ORDER', entityId: orderId, after: { status: 'FULFILLED', dispatch_id: dispatch.lastInsertRowid }, createdAt: timestamp });
      return getOrder(req.db, orderId);
    });
    return sendData(res, result);
  } catch (error) { return next(error); }
});

const RETURN_REASONS = ['DAMAGED', 'EXPIRED', 'WRONG_ITEM', 'CUSTOMER_REFUSED', 'OVERDELIVERED', 'OTHER'];

router.post('/orders/:id/returns', requireRole('OFFICE', 'WAREHOUSE', 'ADMIN'), requireJsonBody, requireIdempotencyKey, (req, res, next) => {
  try {
    const orderId = getPositiveId(req.params.id);
    const endpoint = `/api/orders/${orderId}/returns`;
    const claimed = transaction(req.db, () => claimIdempotency(req.db, { userId: req.user.id, key: req.idempotency.key, endpoint, requestHash: req.idempotency.requestHash }));
    if (replayIfAvailable(claimed, res)) return undefined;
    if (!Array.isArray(req.body?.items) || !req.body.items.length) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: 'items', message: 'must contain at least one line' }]);
    const note = req.body.note === undefined ? null : requireText(req.body.note, 'note', { max: 500 });
    const result = transaction(req.db, () => {
      const order = getOrderRecord(req.db, orderId);
      if (!order) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Order not found');
      if (!['FULFILLED', 'PARTIALLY_RETURNED'].includes(order.status)) throw new AppError(409, ERROR_CODES.INVALID_TRANSITION, 'Only fulfilled orders can receive returns');
      const seen = new Set();
      const lines = [];
      for (let index = 0; index < req.body.items.length; index += 1) {
        const item = req.body.items[index];
        if (!Number.isInteger(item?.order_item_id) || item.order_item_id < 1) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: `items[${index}].order_item_id`, message: 'must be a positive integer' }]);
        if (seen.has(item.order_item_id)) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: `items[${index}].order_item_id`, message: 'cannot be repeated' }]);
        seen.add(item.order_item_id);
        const qty = requireInteger(item.qty, `items[${index}].qty`, { min: 1 });
        if (!RETURN_REASONS.includes(item.reason_code)) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: `items[${index}].reason_code`, message: 'invalid return reason' }]);
        if (typeof item.is_restockable !== 'boolean') throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: `items[${index}].is_restockable`, message: 'must be boolean' }]);
        const orderItem = req.db.prepare(`SELECT oi.id, oi.product_id, oi.qty AS dispatched_qty
          FROM order_items oi WHERE oi.id = ? AND oi.order_id = ?`).get(item.order_item_id, orderId);
        if (!orderItem) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Order item not found');
        const returned = req.db.prepare(`SELECT COALESCE(SUM(ri.qty), 0) AS qty FROM return_items ri
          JOIN returns r ON r.id = ri.return_id WHERE r.order_id = ? AND ri.order_item_id = ?`).get(orderId, item.order_item_id).qty;
        if (returned + qty > orderItem.dispatched_qty) throw new AppError(422, ERROR_CODES.RETURN_QTY_EXCEEDED, 'Return quantity exceeds dispatched quantity');
        lines.push({ ...item, ...orderItem, qty });
      }
      const timestamp = new Date().toISOString();
      const returnResult = req.db.prepare('INSERT INTO returns (order_id, recorded_by, recorded_at, note) VALUES (?, ?, ?, ?)').run(orderId, req.user.id, timestamp, note);
      const returnId = Number(returnResult.lastInsertRowid);
      const insertItem = req.db.prepare('INSERT INTO return_items (return_id, order_item_id, product_id, qty, reason_code, is_restockable) VALUES (?, ?, ?, ?, ?, ?)');
      for (const line of lines) {
        insertItem.run(returnId, line.order_item_id, line.product_id, line.qty, line.reason_code, line.is_restockable ? 1 : 0);
        if (line.is_restockable) stock.restockReturnLine(req.db, { productId: line.product_id, qty: line.qty, returnId, actorUserId: req.user.id });
      }
      const totals = req.db.prepare(`SELECT COALESCE(SUM(oi.qty), 0) AS ordered_qty,
          COALESCE((SELECT SUM(ri.qty) FROM return_items ri JOIN returns r ON r.id = ri.return_id WHERE r.order_id = ?), 0) AS returned_qty
        FROM order_items oi WHERE oi.order_id = ?`).get(orderId, orderId);
      const status = totals.returned_qty >= totals.ordered_qty ? 'RETURNED' : 'PARTIALLY_RETURNED';
      req.db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, timestamp, orderId);
      recordAudit(req.db, { actorUserId: req.user.id, action: 'RETURN_RECORDED', entityType: 'RETURN', entityId: returnId, after: { order_id: orderId, status }, createdAt: timestamp });
      const body = { data: { id: returnId, order_id: orderId, order_status: status, restocked_units: lines.filter((line) => line.is_restockable).reduce((sum, line) => sum + line.qty, 0), not_restocked_units: lines.filter((line) => !line.is_restockable).reduce((sum, line) => sum + line.qty, 0), recorded_at: timestamp } };
      storeIdempotencyResponse(req.db, { userId: req.user.id, key: req.idempotency.key, endpoint, status: 201, body });
      return { status: 201, body };
    });
    return res.status(result.status).json(result.body);
  } catch (error) { return next(error); }
});

router.get('/returns', requireRole('OFFICE', 'WAREHOUSE', 'MANAGER', 'ADMIN'), (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const where = [];
    const params = [];
    if (req.query.order_id !== undefined) { where.push('r.order_id = ?'); params.push(getPositiveId(req.query.order_id, 'order_id')); }
    const from = parseDateQuery(req.query.from, 'from');
    const to = parseDateQuery(req.query.to, 'to');
    if (from) { where.push('r.recorded_at >= ?'); params.push(`${from}T00:00:00.000Z`); }
    if (to) { where.push('r.recorded_at < ?'); params.push(`${to}T23:59:59.999Z`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = req.db.prepare(`SELECT COUNT(*) AS total FROM returns r ${clause}`).get(...params).total;
    const rows = req.db.prepare(`SELECT r.id, r.order_id, o.order_no, r.recorded_by, r.recorded_at, r.note
      FROM returns r JOIN orders o ON o.id = r.order_id ${clause}
      ORDER BY r.recorded_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return sendData(res, rows, 200, { page, limit, total });
  } catch (error) { return next(error); }
});

router.get('/returns/:id', requireRole('OFFICE', 'WAREHOUSE', 'MANAGER', 'ADMIN'), (req, res, next) => {
  try {
    const id = getPositiveId(req.params.id);
    const row = req.db.prepare('SELECT r.*, o.order_no FROM returns r JOIN orders o ON o.id = r.order_id WHERE r.id = ?').get(id);
    if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Return not found');
    const items = req.db.prepare('SELECT * FROM return_items WHERE return_id = ? ORDER BY id').all(id).map((item) => ({ ...item, is_restockable: Boolean(item.is_restockable) }));
    return sendData(res, { ...row, items });
  } catch (error) { return next(error); }
});

module.exports = router;
