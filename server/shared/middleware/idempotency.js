const crypto = require('node:crypto');
const AppError = require('../errors/app-error');
const ERROR_CODES = require('../errors/error-codes');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestHash(req) {
  return crypto.createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');
}

function requireIdempotencyKey(req, _res, next) {
  const key = req.get('Idempotency-Key');
  if (!key) return next(new AppError(400, ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header is required'));
  if (!UUID_PATTERN.test(key)) {
    return next(new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Idempotency-Key must be a UUID'));
  }

  req.idempotency = { key, requestHash: requestHash(req) };
  return next();
}

module.exports = { requireIdempotencyKey, requestHash };
