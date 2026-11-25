const AppError = require('../errors/app-error');
const ERROR_CODES = require('../errors/error-codes');

function notFound(req, _res, next) {
  next(new AppError(404, ERROR_CODES.NOT_FOUND, `Route not found: ${req.method} ${req.path}`));
}

module.exports = notFound;
