const AppError = require('./errors/app-error');
const ERROR_CODES = require('./errors/error-codes');

function sendData(res, data, statusCode = 200, meta) {
  const body = { data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
}

function getPositiveId(value, field = 'id') {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [
      { field, message: 'must be a positive integer' },
    ]);
  }
  return Number(value);
}

function requireText(value, field, { max = 500, optional = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [
      { field, message: `must be a non-empty string of at most ${max} characters` },
    ]);
  }
  return value.trim();
}

function requireInteger(value, field, { min = 0, optional = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [
      { field, message: `must be an integer at least ${min}` },
    ]);
  }
  return value;
}

function parseBooleanQuery(value, field) {
  if (value === undefined) return undefined;
  if (!['0', '1', 'true', 'false'].includes(String(value))) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [
      { field, message: 'must be true, false, 1, or 0' },
    ]);
  }
  return value === '1' || value === 'true';
}

function parseDateQuery(value, field) {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', [
      { field, message: 'must be YYYY-MM-DD' },
    ]);
  }
  return value;
}

module.exports = { sendData, getPositiveId, requireText, requireInteger, parseBooleanQuery, parseDateQuery };
