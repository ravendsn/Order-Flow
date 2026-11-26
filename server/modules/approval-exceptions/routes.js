const express = require('express');
const env = require('../../config/env');
const { authenticate } = require('../../shared/middleware/authenticate');
const requireRole = require('../../shared/middleware/require-role');
const { requireJsonBody, parsePagination, parseBooleanQuery } = require('../../shared/middleware/validate');
const { sendData, getPositiveId, requireText } = require('../../shared/http');
const { transaction } = require('../../db/connection');
const { recordAudit } = require('../../shared/audit/service');
const stock = require('../product-inventory/stock/service');
const { getOrder } = require('../order-management/service');
const AppError = require('../../shared/errors/app-error');
const ERROR_CODES = require('../../shared/errors/error-codes');

const router = express.Router();
router.use(authenticate({ secret: env.sessionSecret }));
router.use('/approvals', requireRole('OFFICE', 'MANAGER', 'ADMIN'));

function hoursSince(timestamp) {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : Math.max(0, (Date.now() - parsed) / 3_600_000);
}

router.get('/approvals', (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const aging = parseBooleanQuery(req.query.aging, 'aging');
    const status = req.query.status;
    if (status !== undefined && !['PENDING', 'ON_HOLD'].includes(status)) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: 'status', message: 'must be PENDING or ON_HOLD' }]);
    const rows = req.db.prepare(`SELECT a.id, a.order_id, o.order_no, c.name AS customer_name,
      o.total_cents, a.reasons, a.status, a.requested_at, a.hold_since
      FROM approvals a JOIN orders o ON o.id = a.order_id JOIN customers c ON c.id = o.customer_id
      WHERE a.status IN ('PENDING','ON_HOLD') ${status ? 'AND a.status = ?' : ''}
      ORDER BY a.requested_at ASC, a.id ASC`).all(...(status ? [status] : []));
    const threshold = Number(req.db.prepare("SELECT value FROM settings WHERE key = 'hold_aging_hours'").get()?.value || 4);
    const enriched = rows.map((row) => {
      const ageHours = hoursSince(row.status === 'ON_HOLD' && row.hold_since ? row.hold_since : row.requested_at);
      return { id: row.id, order_id: row.order_id, order_no: row.order_no, customer_name: row.customer_name, total_cents: row.total_cents, reasons: row.reasons.split(','), status: row.status, requested_at: row.requested_at, age_hours: Number(ageHours.toFixed(2)), is_aging: ageHours > threshold };
    }).filter((row) => aging === undefined || row.is_aging === aging);
    const total = enriched.length;
    return sendData(res, enriched.slice(offset, offset + limit), 200, { page, limit, total });
  } catch (error) { return next(error); }
});

function decide(req, res, next, action) {
  try {
    const approvalId = getPositiveId(req.params.id);
    const note = req.body?.note === undefined ? null : requireText(req.body.note, 'note', { max: 500 });
    if ((action === 'reject' || action === 'hold') && !note) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: 'note', message: 'is required' }]);
    const order = transaction(req.db, () => {
      const approval = req.db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId);
      if (!approval) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Approval not found');
      if (!['PENDING', 'ON_HOLD'].includes(approval.status)) throw new AppError(409, ERROR_CODES.INVALID_TRANSITION, 'Approval is already decided');
      const timestamp = new Date().toISOString();
      if (action === 'approve') {
        req.db.prepare("UPDATE approvals SET status = 'APPROVED', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?").run(req.user.id, timestamp, note, approvalId);
        req.db.prepare("UPDATE orders SET status = 'APPROVED', approved_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, approval.order_id);
        recordAudit(req.db, { actorUserId: req.user.id, action: 'ORDER_APPROVED', entityType: 'ORDER', entityId: approval.order_id, before: { status: approval.status }, after: { status: 'APPROVED' }, note, createdAt: timestamp });
      } else if (action === 'reject') {
        stock.releaseOrderReservations(req.db, { orderId: approval.order_id, actorUserId: req.user.id, reason: 'ORDER_REJECTED' });
        req.db.prepare("UPDATE approvals SET status = 'REJECTED', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?").run(req.user.id, timestamp, note, approvalId);
        req.db.prepare("UPDATE orders SET status = 'REJECTED', updated_at = ? WHERE id = ?").run(timestamp, approval.order_id);
        recordAudit(req.db, { actorUserId: req.user.id, action: 'ORDER_REJECTED', entityType: 'ORDER', entityId: approval.order_id, before: { status: approval.status }, after: { status: 'REJECTED' }, note, createdAt: timestamp });
      } else {
        req.db.prepare("UPDATE approvals SET status = 'ON_HOLD', hold_since = ?, decision_note = ? WHERE id = ?").run(timestamp, note, approvalId);
        req.db.prepare("UPDATE orders SET status = 'ON_HOLD', updated_at = ? WHERE id = ?").run(timestamp, approval.order_id);
        recordAudit(req.db, { actorUserId: req.user.id, action: 'ORDER_HELD', entityType: 'ORDER', entityId: approval.order_id, before: { status: approval.status }, after: { status: 'ON_HOLD' }, note, createdAt: timestamp });
      }
      return getOrder(req.db, approval.order_id);
    });
    return sendData(res, order);
  } catch (error) { return next(error); }
}

router.post('/approvals/:id/approve', requireJsonBody, (req, res, next) => decide(req, res, next, 'approve'));
router.post('/approvals/:id/reject', requireJsonBody, (req, res, next) => decide(req, res, next, 'reject'));
router.post('/approvals/:id/hold', requireJsonBody, (req, res, next) => decide(req, res, next, 'hold'));

module.exports = router;
