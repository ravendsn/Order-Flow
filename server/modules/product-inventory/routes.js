const express = require('express');
const { authenticate } = require('../../shared/middleware/authenticate');
const requireRole = require('../../shared/middleware/require-role');
const { requireJsonBody, parsePagination, parseBooleanQuery, validationError } = require('../../shared/middleware/validate');
const { sendData, getPositiveId, requireText, requireInteger } = require('../../shared/http');
const { transaction } = require('../../db/connection');
const { recordAudit } = require('../../shared/audit/service');
const { ensureStockRow, receiveStock, adjustStock } = require('./stock/service');
const AppError = require('../../shared/errors/app-error');
const ERROR_CODES = require('../../shared/errors/error-codes');

const router = express.Router();
const auth = authenticate({ secret: require('../../config/env').sessionSecret });
router.use(auth);

function productQuery() {
  return `SELECT p.id, p.sku, p.name, p.category, p.unit, p.unit_price_cents,
      p.reorder_level, p.is_active, p.created_at, p.updated_at,
      COALESCE(s.on_hand, 0) AS on_hand, COALESCE(s.reserved, 0) AS reserved,
      COALESCE(s.on_hand, 0) - COALESCE(s.reserved, 0) AS available,
      CASE WHEN COALESCE(s.on_hand, 0) - COALESCE(s.reserved, 0) < p.reorder_level THEN 1 ELSE 0 END AS is_below_reorder
    FROM products p LEFT JOIN stock_levels s ON s.product_id = p.id`;
}

function serializeProduct(row) {
  if (!row) return null;
  return { ...row, is_active: Boolean(row.is_active), is_below_reorder: Boolean(row.is_below_reorder) };
}

function findProduct(db, id) {
  return db.prepare(`${productQuery()} WHERE p.id = ?`).get(id);
}

router.get('/products', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const isActive = parseBooleanQuery(req.query.is_active, 'is_active');
    const where = [];
    const params = [];
    if (req.query.q) { where.push('(p.sku LIKE ? OR p.name LIKE ?)'); params.push(`%${String(req.query.q).trim()}%`, `%${String(req.query.q).trim()}%`); }
    if (req.query.category) { where.push('p.category = ?'); params.push(String(req.query.category)); }
    if (isActive !== undefined) { where.push('p.is_active = ?'); params.push(isActive ? 1 : 0); }
    if (req.query.below_reorder === 'true' || req.query.below_reorder === '1') where.push('COALESCE(s.on_hand, 0) - COALESCE(s.reserved, 0) < p.reorder_level');
    else if (req.query.below_reorder !== undefined && !['false', '0'].includes(String(req.query.below_reorder))) throw validationError([{ field: 'below_reorder', message: 'must be true or false' }]);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = req.db.prepare(`SELECT COUNT(*) AS total FROM products p LEFT JOIN stock_levels s ON s.product_id = p.id ${clause}`).get(...params).total;
    const rows = req.db.prepare(`${productQuery()} ${clause} ORDER BY p.name LIMIT ? OFFSET ?`).all(...params, limit, offset).map(serializeProduct);
    return sendData(res, rows, 200, { page, limit, total });
  } catch (error) { return next(error); }
});

router.get('/products/:id', (req, res, next) => {
  try {
    const product = findProduct(req.db, getPositiveId(req.params.id));
    if (!product) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Product not found');
    return sendData(res, serializeProduct(product));
  } catch (error) { return next(error); }
});

router.post('/products', requireRole('ADMIN'), requireJsonBody, (req, res, next) => {
  try {
    const sku = requireText(req.body?.sku, 'sku', { max: 50 });
    const name = requireText(req.body?.name, 'name', { max: 200 });
    const unit = requireText(req.body?.unit, 'unit', { max: 20 }).toUpperCase();
    const category = req.body?.category === undefined ? null : requireText(req.body.category, 'category', { max: 100 });
    const unitPrice = requireInteger(req.body?.unit_price_cents, 'unit_price_cents', { min: 0 });
    const reorderLevel = req.body?.reorder_level === undefined ? 0 : requireInteger(req.body.reorder_level, 'reorder_level', { min: 0 });
    const initialOnHand = req.body?.initial_on_hand === undefined ? 0 : requireInteger(req.body.initial_on_hand, 'initial_on_hand', { min: 0 });
    const product = transaction(req.db, () => {
      let result;
      try {
        result = req.db.prepare(`INSERT INTO products
          (sku, name, category, unit, unit_price_cents, reorder_level) VALUES (?, ?, ?, ?, ?, ?)`).run(sku, name, category, unit, unitPrice, reorderLevel);
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError(409, ERROR_CODES.DUPLICATE, 'SKU already exists');
        throw error;
      }
      const id = Number(result.lastInsertRowid);
      ensureStockRow(req.db, id);
      if (initialOnHand > 0) receiveStock(req.db, { productId: id, qty: initialOnHand, reason: 'INITIAL_STOCK', actorUserId: req.user.id });
      const created = findProduct(req.db, id);
      recordAudit(req.db, { actorUserId: req.user.id, action: 'PRODUCT_CREATED', entityType: 'PRODUCT', entityId: id, after: created });
      return created;
    });
    return sendData(res, serializeProduct(product), 201);
  } catch (error) { return next(error); }
});

router.patch('/products/:id', requireRole('ADMIN'), requireJsonBody, (req, res, next) => {
  try {
    const id = getPositiveId(req.params.id);
    const before = findProduct(req.db, id);
    if (!before) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Product not found');
    const fields = [];
    const params = [];
    const map = [
      ['name', 'name', (value) => requireText(value, 'name', { max: 200 })],
      ['category', 'category', (value) => value === null ? null : requireText(value, 'category', { max: 100 })],
      ['unit_price_cents', 'unit_price_cents', (value) => requireInteger(value, 'unit_price_cents', { min: 0 })],
      ['reorder_level', 'reorder_level', (value) => requireInteger(value, 'reorder_level', { min: 0 })],
    ];
    for (const [bodyKey, column, parser] of map) {
      if (req.body[bodyKey] !== undefined) { fields.push(`${column} = ?`); params.push(parser(req.body[bodyKey])); }
    }
    if (req.body.is_active !== undefined) {
      if (typeof req.body.is_active !== 'boolean') throw validationError([{ field: 'is_active', message: 'must be boolean' }]);
      fields.push('is_active = ?'); params.push(req.body.is_active ? 1 : 0);
    }
    if (!fields.length) throw validationError([{ field: 'body', message: 'must include an editable field' }]);
    fields.push("updated_at = datetime('now')");
    params.push(id);
    req.db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const after = findProduct(req.db, id);
    recordAudit(req.db, { actorUserId: req.user.id, action: 'PRODUCT_UPDATED', entityType: 'PRODUCT', entityId: id, before, after });
    return sendData(res, serializeProduct(after));
  } catch (error) { return next(error); }
});

router.get('/products/:id/movements', requireRole('OFFICE', 'WAREHOUSE', 'MANAGER', 'ADMIN'), (req, res, next) => {
  try {
    const productId = getPositiveId(req.params.id);
    if (!findProduct(req.db, productId)) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Product not found');
    const { page, limit, offset } = parsePagination(req.query);
    const total = req.db.prepare('SELECT COUNT(*) AS total FROM stock_movements WHERE product_id = ?').get(productId).total;
    const rows = req.db.prepare(`SELECT id, product_id, movement_type, on_hand_delta, reserved_delta,
      ref_type, ref_id, reason, created_by, created_at FROM stock_movements
      WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(productId, limit, offset);
    return sendData(res, rows, 200, { page, limit, total });
  } catch (error) { return next(error); }
});

router.post('/stock/receive', requireRole('WAREHOUSE', 'ADMIN'), requireJsonBody, (req, res, next) => {
  try {
    const productId = getPositiveId(req.body?.product_id, 'product_id');
    const qty = requireInteger(req.body?.qty, 'qty', { min: 1 });
    const reason = requireText(req.body?.reason, 'reason', { max: 300 });
    const result = transaction(req.db, () => {
      if (!findProduct(req.db, productId)) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Product not found');
      const stock = receiveStock(req.db, { productId, qty, reason, actorUserId: req.user.id });
      recordAudit(req.db, { actorUserId: req.user.id, action: 'STOCK_RECEIVED', entityType: 'PRODUCT', entityId: productId, after: stock, note: reason });
      return stock;
    });
    return sendData(res, result);
  } catch (error) { return next(error); }
});

router.post('/stock/adjust', requireRole('WAREHOUSE', 'ADMIN'), requireJsonBody, (req, res, next) => {
  try {
    const productId = getPositiveId(req.body?.product_id, 'product_id');
    const delta = requireInteger(req.body?.delta, 'delta', { min: Number.MIN_SAFE_INTEGER + 1 });
    if (delta === 0) throw validationError([{ field: 'delta', message: 'must not be zero' }]);
    const reason = requireText(req.body?.reason, 'reason', { max: 300 });
    const result = transaction(req.db, () => {
      if (!findProduct(req.db, productId)) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Product not found');
      const stock = adjustStock(req.db, { productId, delta, reason, actorUserId: req.user.id });
      recordAudit(req.db, { actorUserId: req.user.id, action: 'STOCK_ADJUSTED', entityType: 'PRODUCT', entityId: productId, after: stock, note: reason });
      return stock;
    });
    return sendData(res, result);
  } catch (error) { return next(error); }
});

module.exports = router;
