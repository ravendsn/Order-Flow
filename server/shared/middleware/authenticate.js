const crypto = require('node:crypto');
const AppError = require('../errors/app-error');
const ERROR_CODES = require('../errors/error-codes');

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createSessionToken(user, secret, ttlSeconds = 8 * 60 * 60) {
  const payload = base64UrlEncode(JSON.stringify({
    sub: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }));
  return `${payload}.${sign(payload, secret)}`;
}

function parseCookies(header) {
  const cookies = {};
  for (const pair of (header || '').split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    cookies[pair.slice(0, separator).trim()] = decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return cookies;
}

function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(payload, secret);
  const valid = signature.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    if (!parsed.sub || !parsed.exp || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function authenticate({ secret }) {
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie).op_session;
    const session = verifySessionToken(token, secret);
    if (!session) return next(new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Authentication required'));

    const user = req.db.prepare(
      'SELECT id, username, full_name, role, is_active FROM users WHERE id = ?',
    ).get(session.sub);

    if (!user) return next(new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Authentication required'));
    if (!user.is_active) return next(new AppError(403, ERROR_CODES.ACCOUNT_DISABLED, 'Account is disabled'));

    req.user = user;
    req.session = session;
    return next();
  };
}

module.exports = {
  authenticate,
  createSessionToken,
  parseCookies,
  verifySessionToken,
};
