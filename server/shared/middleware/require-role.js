const AppError = require('../errors/app-error');
const ERROR_CODES = require('../errors/error-codes');

function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Authentication required'));
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError(403, ERROR_CODES.FORBIDDEN, 'This role cannot perform the requested action'));
    }
    return next();
  };
}

module.exports = requireRole;
