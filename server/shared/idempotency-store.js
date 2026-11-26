const AppError = require('./errors/app-error');
const ERROR_CODES = require('./errors/error-codes');

function getStoredIdempotency(db, userId, key, endpoint) {
  return db.prepare(`SELECT user_id, idem_key, endpoint, request_hash,
      response_status, response_body FROM idempotency_keys
    WHERE user_id = ? AND idem_key = ? AND endpoint = ?`).get(userId, key, endpoint);
}

function claimIdempotency(db, { userId, key, endpoint, requestHash }) {
  const inserted = db.prepare(`INSERT OR IGNORE INTO idempotency_keys
    (user_id, idem_key, endpoint, request_hash) VALUES (?, ?, ?, ?)`).run(
    userId,
    key,
    endpoint,
    requestHash,
  );

  const row = getStoredIdempotency(db, userId, key, endpoint);
  if (!row) throw new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'Unable to claim idempotency key');
  if (row.request_hash !== requestHash) {
    throw new AppError(422, ERROR_CODES.IDEMPOTENCY_KEY_REUSED, 'Idempotency key was used with a different request body');
  }
  if (inserted.changes === 0 && row.response_status === null) {
    throw new AppError(409, ERROR_CODES.IDEMPOTENCY_IN_PROGRESS, 'A request with this idempotency key is already in progress');
  }
  return row;
}

function storeIdempotencyResponse(db, { userId, key, endpoint, status, body }) {
  db.prepare(`UPDATE idempotency_keys SET response_status = ?, response_body = ?
    WHERE user_id = ? AND idem_key = ? AND endpoint = ?`).run(
    status,
    JSON.stringify(body),
    userId,
    key,
    endpoint,
  );
}

function replayIfAvailable(row, res) {
  if (!row || row.response_status === null || row.response_body === null) return false;
  res.set('Idempotency-Replayed', 'true');
  res.status(row.response_status).json(JSON.parse(row.response_body));
  return true;
}

module.exports = { claimIdempotency, getStoredIdempotency, storeIdempotencyResponse, replayIfAvailable };
