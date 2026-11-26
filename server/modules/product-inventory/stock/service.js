const AppError = require('../../../shared/errors/app-error');
const ERROR_CODES = require('../../../shared/errors/error-codes');

function now() {
  return new Date().toISOString();
}

function getAvailability(db, productId) {
  return db.prepare('SELECT * FROM v_product_availability WHERE product_id = ?').get(productId);
}

function getStockRow(db, productId) {
  return db.prepare(`SELECT s.product_id, s.on_hand, s.reserved,
      (s.on_hand - s.reserved) AS available
    FROM stock_levels s WHERE s.product_id = ?`).get(productId);
}

function ensureStockRow(db, productId) {
  db.prepare('INSERT OR IGNORE INTO stock_levels (product_id, on_hand, reserved) VALUES (?, 0, 0)').run(productId);
}

function insertMovement(db, {
  productId,
  movementType,
  onHandDelta = 0,
  reservedDelta = 0,
  refType = null,
  refId = null,
  reason = null,
  actorUserId = null,
  createdAt = now(),
}) {
  db.prepare(`INSERT INTO stock_movements
    (product_id, movement_type, on_hand_delta, reserved_delta, ref_type, ref_id, reason, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    productId,
    movementType,
    onHandDelta,
    reservedDelta,
    refType,
    refId,
    reason,
    actorUserId,
    createdAt,
  );
}

function receiveStock(db, { productId, qty, reason, actorUserId, refType = 'MANUAL', refId = null }) {
  ensureStockRow(db, productId);
  const timestamp = now();
  const result = db.prepare(`UPDATE stock_levels
    SET on_hand = on_hand + ?, updated_at = ? WHERE product_id = ?`).run(qty, timestamp, productId);
  if (result.changes !== 1) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Product stock row not found');
  insertMovement(db, {
    productId,
    movementType: 'RECEIVE',
    onHandDelta: qty,
    refType,
    refId,
    reason,
    actorUserId,
    createdAt: timestamp,
  });
  return getStockRow(db, productId);
}

function adjustStock(db, { productId, delta, reason, actorUserId }) {
  ensureStockRow(db, productId);
  const timestamp = now();
  const result = db.prepare(`UPDATE stock_levels SET on_hand = on_hand + ?, updated_at = ?
    WHERE product_id = ? AND on_hand + ? >= reserved`).run(delta, timestamp, productId, delta);
  if (result.changes !== 1) {
    throw new AppError(409, ERROR_CODES.STOCK_BELOW_RESERVED, 'Adjustment would put on_hand below reserved stock');
  }
  insertMovement(db, {
    productId,
    movementType: 'ADJUST',
    onHandDelta: delta,
    refType: 'MANUAL',
    reason,
    actorUserId,
    createdAt: timestamp,
  });
  return getStockRow(db, productId);
}

function reserveProduct(db, { productId, qty, actorUserId, refType = 'ORDER', refId = null, reason = 'ORDER_RESERVATION' }) {
  const timestamp = now();
  const result = db.prepare(`UPDATE stock_levels
    SET reserved = reserved + ?, updated_at = ?
    WHERE product_id = ? AND on_hand - reserved >= ?`).run(qty, timestamp, productId, qty);
  if (result.changes !== 1) {
    const stock = getStockRow(db, productId);
    return {
      ok: false,
      productId,
      requested: qty,
      available: stock?.available ?? 0,
      shortfall: Math.max(0, qty - (stock?.available ?? 0)),
    };
  }
  insertMovement(db, {
    productId,
    movementType: 'RESERVE',
    reservedDelta: qty,
    refType,
    refId,
    reason,
    actorUserId,
    createdAt: timestamp,
  });
  return { ok: true, productId, qty };
}

function releaseProductQuantity(db, { productId, qty, actorUserId, refType = 'ORDER', refId = null, reason = 'RESERVATION_RELEASED' }) {
  const timestamp = now();
  const result = db.prepare(`UPDATE stock_levels
    SET reserved = reserved - ?, updated_at = ?
    WHERE product_id = ? AND reserved >= ?`).run(qty, timestamp, productId, qty);
  if (result.changes !== 1) {
    throw new AppError(409, ERROR_CODES.INVALID_TRANSITION, 'Cannot release more reservation than currently exists');
  }
  insertMovement(db, {
    productId,
    movementType: 'RELEASE',
    reservedDelta: -qty,
    refType,
    refId,
    reason,
    actorUserId,
    createdAt: timestamp,
  });
  return getStockRow(db, productId);
}

function releaseOrderReservations(db, { orderId, actorUserId, reason = 'RESERVATION_RELEASED' }) {
  const active = db.prepare(`SELECT r.id, r.product_id, r.qty
    FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id
    WHERE oi.order_id = ? AND r.status = 'ACTIVE'`).all(orderId);
  const close = db.prepare("UPDATE reservations SET status = 'RELEASED', closed_at = ? WHERE id = ? AND status = 'ACTIVE'");
  for (const reservation of active) {
    releaseProductQuantity(db, {
      productId: reservation.product_id,
      qty: reservation.qty,
      actorUserId,
      refId: orderId,
      reason,
    });
    close.run(now(), reservation.id);
  }
  return active.length;
}

function consumeOrderReservations(db, { orderId, actorUserId }) {
  const active = db.prepare(`SELECT r.id, r.product_id, r.qty
    FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id
    WHERE oi.order_id = ? AND r.status = 'ACTIVE'`).all(orderId);
  if (!active.length) throw new AppError(409, ERROR_CODES.INVALID_TRANSITION, 'Order has no active reservation');

  const timestamp = now();
  const consumeStock = db.prepare(`UPDATE stock_levels SET
      on_hand = on_hand - ?, reserved = reserved - ?, updated_at = ?
    WHERE product_id = ? AND on_hand >= ? AND reserved >= ?`);
  const close = db.prepare("UPDATE reservations SET status = 'CONSUMED', closed_at = ? WHERE id = ? AND status = 'ACTIVE'");
  for (const reservation of active) {
    const result = consumeStock.run(reservation.qty, reservation.qty, timestamp, reservation.product_id, reservation.qty, reservation.qty);
    if (result.changes !== 1) throw new AppError(409, ERROR_CODES.INVALID_TRANSITION, 'Reservation cannot be consumed from current stock');
    insertMovement(db, {
      productId: reservation.product_id,
      movementType: 'DISPATCH',
      onHandDelta: -reservation.qty,
      reservedDelta: -reservation.qty,
      refType: 'ORDER',
      refId: orderId,
      reason: 'ORDER_DISPATCHED',
      actorUserId,
      createdAt: timestamp,
    });
    close.run(timestamp, reservation.id);
  }
  return active;
}

function restockReturnLine(db, { productId, qty, returnId, actorUserId }) {
  ensureStockRow(db, productId);
  const timestamp = now();
  db.prepare('UPDATE stock_levels SET on_hand = on_hand + ?, updated_at = ? WHERE product_id = ?').run(qty, timestamp, productId);
  insertMovement(db, {
    productId,
    movementType: 'RETURN_RESTOCK',
    onHandDelta: qty,
    refType: 'RETURN',
    refId: returnId,
    reason: 'RESTOCKABLE_RETURN',
    actorUserId,
    createdAt: timestamp,
  });
}

module.exports = {
  getAvailability,
  getStockRow,
  ensureStockRow,
  receiveStock,
  adjustStock,
  reserveProduct,
  releaseProductQuantity,
  releaseOrderReservations,
  consumeOrderReservations,
  restockReturnLine,
};
