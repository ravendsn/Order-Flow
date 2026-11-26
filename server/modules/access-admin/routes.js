const express = require('express');
const env = require('../../config/env');
const { ROLES } = require('../../config/constants');
const { authenticate, createSessionToken } = require('../../shared/middleware/authenticate');
const requireRole = require('../../shared/middleware/require-role');
const { requireJsonBody, parsePagination, parseBooleanQuery, validationError } = require('../../shared/middleware/validate');
const { sendData, getPositiveId, requireText, requireInteger } = require('../../shared/http');
const { verifyPassword, hashPassword } = require('../../shared/utils/password');
const { recordAudit } = require('../../shared/audit/service');
const AppError = require('../../shared/errors/app-error');
const ERROR_CODES = require('../../shared/errors/error-codes');

const publicRouter = express.Router();
const protectedRouter = express.Router();
const auth = authenticate({ secret: env.sessionSecret });

function userProjection(row) {
  return { id: row.id, username: row.username, full_name: row.full_name, role: row.role, is_active: Boolean(row.is_active) };
}

publicRouter.post('/auth/login', requireJsonBody, (req, res, next) => {
  try {
    const username = requireText(req.body?.username, 'username', { max: 100 });
    const password = requireText(req.body?.password, 'password', { max: 200 });
    const row = req.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new AppError(401, ERROR_CODES.CREDENTIALS_INVALID, 'Invalid username or password');
    }
    if (!row.is_active) throw new AppError(403, ERROR_CODES.ACCOUNT_DISABLED, 'Account is disabled');

    const token = createSessionToken(row, env.sessionSecret);
    const secure = env.nodeEnv === 'production' ? '; Secure' : '';
    res.set('Set-Cookie', `op_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`);
    recordAudit(req.db, { actorUserId: row.id, action: 'USER_LOGIN', entityType: 'USER', entityId: row.id });
    return sendData(res, userProjection(row));
  } catch (error) {
    return next(error);
  }
});

protectedRouter.use(auth);

protectedRouter.post('/auth/logout', (_req, res) => {
  res.set('Set-Cookie', 'op_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return res.status(204).send();
});

protectedRouter.get('/auth/me', (req, res) => sendData(res, userProjection(req.user)));

protectedRouter.get('/users', requireRole('ADMIN'), (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const role = req.query.role;
    if (role !== undefined && !ROLES.includes(role)) throw validationError([{ field: 'role', message: 'invalid role' }]);
    const isActive = parseBooleanQuery(req.query.is_active, 'is_active');
    const where = [];
    const params = [];
    if (role) { where.push('role = ?'); params.push(role); }
    if (isActive !== undefined) { where.push('is_active = ?'); params.push(isActive ? 1 : 0); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = req.db.prepare(`SELECT COUNT(*) AS total FROM users ${clause}`).get(...params).total;
    const rows = req.db.prepare(`SELECT id, username, full_name, role, is_active, created_at
      FROM users ${clause} ORDER BY id LIMIT ? OFFSET ?`).all(...params, limit, offset).map(userProjection);
    return sendData(res, rows, 200, { page, limit, total });
  } catch (error) { return next(error); }
});

protectedRouter.post('/users', requireRole('ADMIN'), requireJsonBody, (req, res, next) => {
  try {
    const username = requireText(req.body?.username, 'username', { max: 100 });
    const fullName = requireText(req.body?.full_name, 'full_name', { max: 150 });
    const password = requireText(req.body?.password, 'password', { max: 200 });
    if (password.length < 8) throw validationError([{ field: 'password', message: 'must be at least 8 characters' }]);
    const role = req.body?.role;
    if (!ROLES.includes(role)) throw validationError([{ field: 'role', message: 'invalid role' }]);
    let result;
    try {
      result = req.db.prepare('INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)').run(username, fullName, hashPassword(password), role);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError(409, ERROR_CODES.DUPLICATE, 'Username already exists');
      throw error;
    }
    const user = req.db.prepare('SELECT id, username, full_name, role, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    recordAudit(req.db, { actorUserId: req.user.id, action: 'USER_CREATED', entityType: 'USER', entityId: user.id, after: user });
    return sendData(res, userProjection(user), 201);
  } catch (error) { return next(error); }
});

protectedRouter.patch('/users/:id', requireRole('ADMIN'), requireJsonBody, (req, res, next) => {
  try {
    const id = getPositiveId(req.params.id);
    const before = req.db.prepare('SELECT id, username, full_name, role, is_active FROM users WHERE id = ?').get(id);
    if (!before) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'User not found');
    const fields = [];
    const params = [];
    if (req.body.full_name !== undefined) { fields.push('full_name = ?'); params.push(requireText(req.body.full_name, 'full_name', { max: 150 })); }
    if (req.body.password !== undefined) {
      const password = requireText(req.body.password, 'password', { max: 200 });
      if (password.length < 8) throw validationError([{ field: 'password', message: 'must be at least 8 characters' }]);
      fields.push('password_hash = ?'); params.push(hashPassword(password));
    }
    if (req.body.role !== undefined) {
      if (!ROLES.includes(req.body.role)) throw validationError([{ field: 'role', message: 'invalid role' }]);
      fields.push('role = ?'); params.push(req.body.role);
    }
    if (req.body.is_active !== undefined) {
      if (typeof req.body.is_active !== 'boolean') throw validationError([{ field: 'is_active', message: 'must be boolean' }]);
      fields.push('is_active = ?'); params.push(req.body.is_active ? 1 : 0);
    }
    if (!fields.length) throw validationError([{ field: 'body', message: 'must include an editable field' }]);
    params.push(id);
    req.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const after = req.db.prepare('SELECT id, username, full_name, role, is_active FROM users WHERE id = ?').get(id);
    recordAudit(req.db, { actorUserId: req.user.id, action: 'USER_UPDATED', entityType: 'USER', entityId: id, before, after });
    return sendData(res, userProjection(after));
  } catch (error) { return next(error); }
});

protectedRouter.get('/audit-log', requireRole('ADMIN', 'MANAGER'), (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const where = [];
    const params = [];
    const textFilters = [['entity_type', 'entity_type'], ['action', 'action']];
    for (const [column, queryKey] of textFilters) {
      if (req.query[queryKey] !== undefined) { where.push(`${column} = ?`); params.push(requireText(req.query[queryKey], queryKey, { max: 100 })); }
    }
    if (req.query.entity_id !== undefined) { where.push('entity_id = ?'); params.push(requireInteger(Number(req.query.entity_id), 'entity_id', { min: 1 })); }
    if (req.query.actor_id !== undefined) { where.push('actor_user_id = ?'); params.push(requireInteger(Number(req.query.actor_id), 'actor_id', { min: 1 })); }
    if (req.query.from !== undefined) { where.push('created_at >= ?'); params.push(`${req.query.from}T00:00:00.000Z`); }
    if (req.query.to !== undefined) { where.push('created_at < ?'); params.push(`${req.query.to}T23:59:59.999Z`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = req.db.prepare(`SELECT COUNT(*) AS total FROM audit_log ${clause}`).get(...params).total;
    const rows = req.db.prepare(`SELECT id, actor_user_id, action, entity_type, entity_id,
      before_json AS before, after_json AS after, note, created_at
      FROM audit_log ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
      .map((row) => ({ ...row, before: row.before ? JSON.parse(row.before) : null, after: row.after ? JSON.parse(row.after) : null }));
    return sendData(res, rows, 200, { page, limit, total });
  } catch (error) { return next(error); }
});

protectedRouter.get('/settings', requireRole('MANAGER', 'ADMIN'), (req, res) => {
  const rows = req.db.prepare('SELECT key, value, description, updated_by, updated_at FROM settings ORDER BY key').all();
  return sendData(res, rows);
});

protectedRouter.patch('/settings/:key', requireRole('ADMIN'), requireJsonBody, (req, res, next) => {
  try {
    const key = requireText(req.params.key, 'key', { max: 100 });
    const value = String(req.body?.value ?? '').trim();
    if (!value) throw validationError([{ field: 'value', message: 'must not be empty' }]);
    const current = req.db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
    if (!current) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Setting not found');
    if (!/^\d+(\.\d+)?$/.test(value)) throw validationError([{ field: 'value', message: 'must be numeric' }]);
    req.db.prepare("UPDATE settings SET value = ?, updated_by = ?, updated_at = datetime('now') WHERE key = ?").run(value, req.user.id, key);
    const updated = req.db.prepare('SELECT key, value, description, updated_by, updated_at FROM settings WHERE key = ?').get(key);
    recordAudit(req.db, { actorUserId: req.user.id, action: 'SETTING_UPDATED', entityType: 'SETTING', entityId: null, before: current, after: updated });
    return sendData(res, updated);
  } catch (error) { return next(error); }
});

module.exports = { publicRouter, protectedRouter };
