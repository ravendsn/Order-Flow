const crypto = require('node:crypto');

const KEY_LENGTH = 64;

function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new TypeError('Password must be a string of at least 8 characters');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;

  const actual = crypto.scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
