const express = require('express');
const env = require('../../config/env');
const { DEFAULT_SETTINGS } = require('../../config/constants');
const { authenticate } = require('../../shared/middleware/authenticate');
const requireRole = require('../../shared/middleware/require-role');
const { parseBooleanQuery, parseDateQuery, parsePositiveInteger, validationError } = require('../../shared/middleware/validate');
const { sendData } = require('../../shared/http');
const AppError = require('../../shared/errors/app-error');
const ERROR_CODES = require('../../shared/errors/error-codes');
const EventBus = require('../../shared/events/event-bus');
const EVENT_NAMES = require('../../shared/events/event-names');
const analytics = require('./service');

const router = express.Router();
const auth = authenticate({ secret: env.sessionSecret });
router.use(auth);

function periodFor(req) {
  const from = parseDateQuery(req.query.from, 'from');
  const to = parseDateQuery(req.query.to, 'to');
  try {
    return analytics.resolvePeriod(req.db, { from, to });
  } catch (error) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [{ field: 'from', message: error.message }]);
  }
}

function limitFor(req) {
  const limit = req.query.limit === undefined ? 5 : parsePositiveInteger(req.query.limit, 'limit');
  if (limit > 100) throw validationError([{ field: 'limit', message: 'must be at most 100' }]);
  return limit;
}

function publishSse(res, eventName, payload) {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function canReceive(user, eventName, payload) {
  if (eventName === EVENT_NAMES.STOCK_CHANGED) return true;
  if (eventName === EVENT_NAMES.APPROVAL_AGING) return ['OFFICE', 'MANAGER', 'ADMIN'].includes(user.role);
  if (eventName === EVENT_NAMES.ORDER_STATUS_CHANGED) {
    if (['OFFICE', 'WAREHOUSE', 'MANAGER', 'ADMIN'].includes(user.role)) return true;
    return user.role === 'AGENT' && Number(payload.agent_id) === user.id;
  }
  return false;
}

function stream(req, res) {
  const eventBus = req.eventBus;
  if (!(eventBus instanceof EventBus) && (!eventBus || typeof eventBus.subscribe !== 'function')) {
    throw new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'Event bus is unavailable');
  }
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write(': connected\n\n');
  const subscriptions = Object.values(EVENT_NAMES).map((eventName) => eventBus.subscribe(eventName, (payload = {}) => {
    if (canReceive(req.user, eventName, payload)) publishSse(res, eventName, payload);
  }));
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  const close = () => {
    clearInterval(ping);
    subscriptions.forEach((unsubscribe) => unsubscribe());
  };
  req.on('close', close);
}

router.get('/analytics/overview', requireRole('MANAGER', 'OFFICE', 'ADMIN'), (req, res, next) => {
  try { return sendData(res, analytics.getOverview(req.db, periodFor(req))); } catch (error) { return next(error); }
});

router.get('/analytics/movers', requireRole('MANAGER', 'OFFICE', 'ADMIN'), (req, res, next) => {
  try { return sendData(res, analytics.getMovers(req.db, periodFor(req), limitFor(req))); } catch (error) { return next(error); }
});

router.get('/analytics/sales-trend', requireRole('MANAGER', 'OFFICE', 'ADMIN'), (req, res, next) => {
  try {
    const granularity = req.query.granularity || 'day';
    if (!['day', 'week'].includes(granularity)) throw validationError([{ field: 'granularity', message: 'must be day or week' }]);
    return sendData(res, analytics.getSalesTrend(req.db, periodFor(req), granularity));
  } catch (error) { return next(error); }
});

router.get('/analytics/abc', requireRole('MANAGER', 'OFFICE', 'ADMIN'), (req, res, next) => {
  try {
    const result = analytics.getAbc(req.db, periodFor(req));
    return sendData(res, result.data, 200, { ...result.meta, period: result.period });
  } catch (error) { return next(error); }
});

router.get('/analytics/days-of-stock', requireRole('MANAGER', 'OFFICE', 'ADMIN'), (req, res, next) => {
  try { return sendData(res, analytics.getDaysOfStock(req.db, periodFor(req), parseBooleanQuery(req.query.risk_only, 'risk_only') || false)); } catch (error) { return next(error); }
});

router.get('/analytics/unmet-demand', requireRole('MANAGER', 'OFFICE', 'ADMIN'), (req, res, next) => {
  try {
    const groupBy = req.query.group_by || 'product';
    if (!['product', 'customer', 'day'].includes(groupBy)) throw validationError([{ field: 'group_by', message: 'must be product, customer, or day' }]);
    return sendData(res, analytics.getUnmetDemand(req.db, periodFor(req), groupBy));
  } catch (error) { return next(error); }
});

router.get('/analytics/returns-by-reason', requireRole('MANAGER', 'OFFICE', 'ADMIN'), (req, res, next) => {
  try { return sendData(res, { period: periodFor(req), rows: analytics.getReturnsByReason(req.db, periodFor(req)) }); } catch (error) { return next(error); }
});

router.get('/alerts', (req, res, next) => {
  try {
    const type = req.query.type;
    if (type !== undefined && !['LOW_STOCK', 'AGING_APPROVAL'].includes(type)) throw validationError([{ field: 'type', message: 'must be LOW_STOCK or AGING_APPROVAL' }]);
    return sendData(res, analytics.getAlerts(req.db, type));
  } catch (error) { return next(error); }
});

router.get('/actions', requireRole('MANAGER', 'OFFICE', 'ADMIN'), (req, res, next) => {
  try { return sendData(res, analytics.getActions(req.db, periodFor(req))); } catch (error) { return next(error); }
});

router.get(['/alerts/stream', '/stream'], (req, res, next) => {
  try { return stream(req, res); } catch (error) { return next(error); }
});

module.exports = router;
