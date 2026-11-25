const AppError = require('../errors/app-error');
const ERROR_CODES = require('../errors/error-codes');
const { parseBooleanQuery, parseDateQuery } = require('../http');

function validationError(details) {
  return new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', details);
}

function requireJsonBody(req, _res, next) {
  if (!req.is('application/json')) return next(validationError([{ field: 'body', message: 'must be JSON' }]));
  return next();
}

function parsePositiveInteger(value, field) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) {
    throw validationError([{ field, message: 'must be a positive integer' }]);
  }
  return Number(value);
}

function parsePagination(query) {
  const page = query.page === undefined ? 1 : parsePositiveInteger(query.page, 'page');
  const limit = query.limit === undefined ? 20 : parsePositiveInteger(query.limit, 'limit');
  if (limit > 100) throw validationError([{ field: 'limit', message: 'must be at most 100' }]);
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { validationError, requireJsonBody, parsePositiveInteger, parsePagination, parseBooleanQuery, parseDateQuery };
