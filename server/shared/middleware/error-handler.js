const AppError = require('../errors/app-error');
const ERROR_CODES = require('../errors/error-codes');

function errorHandler(error, req, res, _next) {
  const isJsonSyntaxError = error instanceof SyntaxError && error.status === 400 && 'body' in error;
  const normalized = isJsonSyntaxError
    ? new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Malformed JSON body')
    : error;
  const statusCode = normalized.statusCode || 500;
  const code = normalized.code || ERROR_CODES.INTERNAL_ERROR;

  if (statusCode >= 500 && statusCode !== 501) req.app.locals.logger?.error(normalized);

  const payload = { error: { code, message: normalized.expose === false ? 'Internal server error' : normalized.message } };
  if (normalized.details) payload.error.details = normalized.details;
  res.status(statusCode).json(payload);
}

module.exports = errorHandler;
