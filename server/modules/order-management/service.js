const AppError = require('../../shared/errors/app-error');
const ERROR_CODES = require('../../shared/errors/error-codes');
const { transaction } = require('../../db/connection');
const { recordAudit } = require('../../shared/audit/service');
const { storeIdempotencyResponse } = require('../../shared/idempotency-store');
const stock = require('../product-inventory/stock/service');

class InsufficientStockError extends Error {
  constructor(details) {
    super('Insufficient stock');
    this.name = 'InsufficientStockError';
    this.details = details;
  }
}

function now() {
  return new Date().toISOString();
}

function getOrder(db, orderId) {
  const row = db.prepare(`SELECT o.*, c.name AS customer_name, c.customer_type,
      u.full_name AS agent_name, u.username AS agent_username
    FROM orders o JOIN customers c ON c.id = o.customer_id
    JOIN users u ON u.id = o.agent_id WHERE o.id = ?`).get(orderId);
  if (!row) return null;

  const items = db.prepare(`SELECT oi.id, oi.product_id, p.sku, p.name, p.unit,
      oi.qty, oi.unit_price_cents, oi.line_total_cents,
      r.id AS reservation_id, r.status AS reservation_status, r.qty AS reserved_qty
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    LEFT JOIN reservations r ON r.order_item_id = oi.id
    WHERE oi.order_id = ? ORDER BY oi.id`).all(orderId);
  const approvalRow = db.prepare('SELECT * FROM approvals WHERE order_id = ?').get(orderId);
  const pickList = db.prepare('SELECT * FROM pick_lists WHERE order_id = ?').get(orderId);
  const dispatch = db.prepare('SELECT * FROM dispatches WHERE order_id = ?').get(orderId);
  const returns = db.prepare('SELECT * FROM returns WHERE order_id = ? ORDER BY recorded_at DESC, id DESC').all(orderId);
  const returnItems = returns.length
    ? db.prepare(`SELECT ri.*, r.order_id FROM return_items ri JOIN returns r ON r.id = ri.return_id
      WHERE r.order_id = ? ORDER BY ri.id`).all(orderId)
    : [];

  return {
    id: row.id,
    order_no: row.order_no,
    customer: { id: row.customer_id, name: row.customer_name, customer_type: row.customer_type },
    agent: { id: row.agent_id, username: row.agent_username, full_name: row.agent_name },
    channel: row.channel,
    status: row.status,
    total_cents: row.total_cents,
    approval: {
      mode: row.approval_mode,
      reasons: row.approval_reasons ? row.approval_reasons.split(',') : [],
      approval_id: approvalRow?.id ?? null,
      status: approvalRow?.status ?? null,
      requested_at: approvalRow?.requested_at ?? null,
      hold_since: approvalRow?.hold_since ?? null,
      decided_by: approvalRow?.decided_by ?? null,
      decided_at: approvalRow?.decided_at ?? null,
      decision_note: approvalRow?.decision_note ?? null,
    },
    items: items.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      qty: item.qty,
      unit_price_cents: item.unit_price_cents,
      line_total_cents: item.line_total_cents,
      reservation_status: item.reservation_status,
    })),
    pick_list: pickList ? {
      id: pickList.id,
      status: pickList.status,
      generated_by: pickList.generated_by,
      generated_at: pickList.generated_at,
      packed_by: pickList.packed_by,
      packed_at: pickList.packed_at,
    } : null,
    dispatch: dispatch ? {
      id: dispatch.id,
      dispatched_by: dispatch.dispatched_by,
      dispatched_at: dispatch.dispatched_at,
      remarks: dispatch.remarks,
    } : null,
    returns: returns.map((item) => ({
      id: item.id,
      order_id: item.order_id,
      recorded_by: item.recorded_by,
      recorded_at: item.recorded_at,
      note: item.note,
      items: returnItems.filter((returnItem) => returnItem.return_id === item.id).map((returnItem) => ({
        id: returnItem.id,
        order_item_id: returnItem.order_item_id,
        product_id: returnItem.product_id,
        qty: returnItem.qty,
        reason_code: returnItem.reason_code,
        is_restockable: Boolean(returnItem.is_restockable),
      })),
    })),
    notes: row.notes,
    submitted_at: row.submitted_at,
    approved_at: row.approved_at,
    dispatched_at: row.dispatched_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getOrderRecord(db, orderId) {
  return db.prepare(`SELECT o.*, c.name AS customer_name, u.full_name AS agent_name
    FROM orders o JOIN customers c ON c.id = o.customer_id JOIN users u ON u.id = o.agent_id
    WHERE o.id = ?`).get(orderId);
}

function validateOrderInput(db, body) {
  if (!body || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: 'items', message: 'must contain 1 to 50 lines' }]);
  }
  const customer = db.prepare('SELECT id, name, customer_type FROM customers WHERE id = ? AND is_active = 1').get(body.customer_id);
  if (!customer) throw new AppError(422, ERROR_CODES.CUSTOMER_INACTIVE, 'Customer is not active or does not exist');
  const channel = body.channel === undefined ? 'WEB' : body.channel;
  if (!['WEB', 'PASTE'].includes(channel)) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: 'channel', message: 'must be WEB or PASTE' }]);
  const seen = new Set();
  const lines = [];
  for (let index = 0; index < body.items.length; index += 1) {
    const input = body.items[index];
    if (!Number.isInteger(input?.product_id) || input.product_id < 1) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: `items[${index}].product_id`, message: 'must be a positive integer' }]);
    if (seen.has(input.product_id)) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: `items[${index}].product_id`, message: 'product cannot be repeated' }]);
    seen.add(input.product_id);
    if (!Number.isInteger(input.qty) || input.qty < 1) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: `items[${index}].qty`, message: 'must be a positive integer' }]);
    const product = db.prepare(`SELECT p.id, p.sku, p.name, p.unit_price_cents, p.reorder_level,
        COALESCE(s.on_hand, 0) AS on_hand, COALESCE(s.reserved, 0) AS reserved,
        COALESCE(s.on_hand, 0) - COALESCE(s.reserved, 0) AS available
      FROM products p LEFT JOIN stock_levels s ON s.product_id = p.id
      WHERE p.id = ? AND p.is_active = 1`).get(input.product_id);
    if (!product) throw new AppError(422, ERROR_CODES.PRODUCT_INACTIVE, 'Product is not active or does not exist');
    lines.push({ ...product, qty: input.qty, line_total_cents: input.qty * product.unit_price_cents });
  }
  return { customer, channel, notes: body.notes === undefined ? null : String(body.notes), lines };
}

function unmetDemandBody(lines) {
  return {
    error: {
      code: ERROR_CODES.INSUFFICIENT_STOCK,
      message: `Not enough stock for ${lines.length} item${lines.length === 1 ? '' : 's'}. Adjust quantities and resubmit.`,
      details: {
        lines: lines.map((line) => ({ product_id: line.id, sku: line.sku, name: line.name, requested: line.qty, available: line.available, shortfall: Math.max(0, line.qty - line.available) })),
        unmet_demand_logged: true,
      },
    },
  };
}

function insertUnmetDemand(db, { lines, customerId, agentId, channel, createdAt }) {
  const insert = db.prepare(`INSERT INTO unmet_demand
    (product_id, customer_id, agent_id, channel, requested_qty, available_qty, shortfall_qty, unit_price_cents, lost_value_cents, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const line of lines) {
    const shortfall = Math.max(0, line.qty - line.available);
    if (!shortfall) continue;
    insert.run(line.id, customerId, agentId, channel, line.qty, line.available, shortfall, line.unit_price_cents, shortfall * line.unit_price_cents, createdAt);
  }
}

function processSubmit(db, { userId, body, idempotency }) {
  const input = validateOrderInput(db, body);
  const endpoint = '/api/orders';
  const claimed = transaction(db, () => require('../../shared/idempotency-store').claimIdempotency(db, {
    userId, key: idempotency.key, endpoint, requestHash: idempotency.requestHash,
  }));
  if (claimed.response_status !== null && claimed.response_body !== null) return { replay: true, row: claimed };

  const preflightShort = input.lines.filter((line) => line.available < line.qty);
  if (preflightShort.length) {
    const result = transaction(db, () => {
      const timestamp = now();
      insertUnmetDemand(db, { lines: preflightShort, customerId: input.customer.id, agentId: userId, channel: input.channel, createdAt: timestamp });
      const responseBody = unmetDemandBody(preflightShort);
      storeIdempotencyResponse(db, { userId, key: idempotency.key, endpoint, status: 409, body: responseBody });
      recordAudit(db, { actorUserId: userId, action: 'UNMET_DEMAND_LOGGED', entityType: 'PRODUCT', entityId: preflightShort[0].id, note: 'Order blocked by insufficient stock' });
      return { status: 409, body: responseBody };
    });
    return { ...result, replay: false };
  }

  try {
    const result = transaction(db, () => {
      const timestamp = now();
      const totalCents = input.lines.reduce((total, line) => total + line.line_total_cents, 0);
      const orderResult = db.prepare(`INSERT INTO orders
        (order_no, customer_id, agent_id, channel, status, total_cents, notes, submitted_at)
        VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?, ?)`).run(
        `OP-${timestamp.slice(0, 10).replaceAll('-', '')}-${String(Date.now()).slice(-6)}`,
        input.customer.id,
        userId,
        input.channel,
        totalCents,
        input.notes,
        timestamp,
      );
      const orderId = Number(orderResult.lastInsertRowid);
      for (const line of input.lines) {
        const reserved = stock.reserveProduct(db, { productId: line.id, qty: line.qty, actorUserId: userId, refId: orderId });
        if (!reserved.ok) throw new InsufficientStockError([{ ...line, available: reserved.available }]);
      }
      const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, qty, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?)');
      const insertReservation = db.prepare("INSERT INTO reservations (order_item_id, product_id, qty, status, created_at) VALUES (?, ?, ?, 'ACTIVE', ?)");
      for (const line of input.lines) {
        const itemId = Number(insertItem.run(orderId, line.id, line.qty, line.unit_price_cents, line.line_total_cents).lastInsertRowid);
        insertReservation.run(itemId, line.id, line.qty, timestamp);
      }
      const threshold = Number(db.prepare("SELECT value FROM settings WHERE key = 'high_value_threshold_cents'").get()?.value || 2_000_000);
      const belowReorder = input.lines.some((line) => {
        const current = stock.getStockRow(db, line.id);
        return current.available < line.reorder_level;
      });
      const reasons = [];
      if (totalCents >= threshold) reasons.push('HIGH_VALUE');
      if (belowReorder) reasons.push('BELOW_REORDER');
      const manual = reasons.length > 0;
      const status = manual ? 'PENDING_APPROVAL' : 'APPROVED';
      db.prepare(`UPDATE orders SET status = ?, approval_mode = ?, approval_reasons = ?, approved_at = ?, updated_at = ? WHERE id = ?`).run(
        status,
        manual ? 'MANUAL' : 'AUTO',
        reasons.length ? reasons.join(',') : null,
        manual ? null : timestamp,
        timestamp,
        orderId,
      );
      if (manual) db.prepare(`INSERT INTO approvals (order_id, reasons, status, requested_at) VALUES (?, ?, 'PENDING', ?)`).run(orderId, reasons.join(','), timestamp);
      recordAudit(db, { actorUserId: userId, action: 'ORDER_SUBMITTED', entityType: 'ORDER', entityId: orderId, after: { status, total_cents: totalCents }, createdAt: timestamp });
      recordAudit(db, { actorUserId: userId, action: manual ? 'APPROVAL_REQUESTED' : 'ORDER_AUTO_APPROVED', entityType: 'ORDER', entityId: orderId, note: reasons.join(',') || null, createdAt: timestamp });
      const responseBody = { data: getOrder(db, orderId) };
      storeIdempotencyResponse(db, { userId, key: idempotency.key, endpoint, status: 201, body: responseBody });
      return { status: 201, body: responseBody };
    });
    return { ...result, replay: false };
  } catch (error) {
    if (!(error instanceof InsufficientStockError)) throw error;
    const result = transaction(db, () => {
      const lines = input.lines.map((line) => ({ ...line, available: stock.getStockRow(db, line.id)?.available ?? 0 })).filter((line) => line.available < line.qty);
      const responseBody = unmetDemandBody(lines.length ? lines : error.details);
      insertUnmetDemand(db, { lines: lines.length ? lines : error.details, customerId: input.customer.id, agentId: userId, channel: input.channel, createdAt: now() });
      storeIdempotencyResponse(db, { userId, key: idempotency.key, endpoint, status: 409, body: responseBody });
      recordAudit(db, { actorUserId: userId, action: 'UNMET_DEMAND_LOGGED', entityType: 'PRODUCT', entityId: (lines[0] || error.details[0]).id, note: 'Order blocked by concurrent stock reservation' });
      return { status: 409, body: responseBody };
    });
    return { ...result, replay: false };
  }
}

function cancelOrder(db, { orderId, actorUserId, reason }) {
  return transaction(db, () => {
    const before = getOrderRecord(db, orderId);
    if (!before) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Order not found');
    if (!['PENDING_APPROVAL', 'ON_HOLD', 'APPROVED'].includes(before.status)) throw new AppError(409, ERROR_CODES.INVALID_TRANSITION, 'Order cannot be cancelled from its current status');
    stock.releaseOrderReservations(db, { orderId, actorUserId, reason: 'ORDER_CANCELLED' });
    const timestamp = now();
    db.prepare("UPDATE orders SET status = 'CANCELLED', updated_at = ? WHERE id = ?").run(timestamp, orderId);
    db.prepare("UPDATE approvals SET status = 'REJECTED', decided_by = ?, decided_at = ?, decision_note = ? WHERE order_id = ? AND status IN ('PENDING','ON_HOLD')").run(actorUserId, timestamp, `CANCELLED: ${reason}`, orderId);
    recordAudit(db, { actorUserId, action: 'ORDER_CANCELLED', entityType: 'ORDER', entityId: orderId, before, after: { status: 'CANCELLED' }, note: reason, createdAt: timestamp });
    return getOrder(db, orderId);
  });
}

module.exports = { getOrder, getOrderRecord, validateOrderInput, processSubmit, cancelOrder, InsufficientStockError };
