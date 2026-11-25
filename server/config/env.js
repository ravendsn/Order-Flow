const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(path.join(ROOT_DIR, '.env'));

const configuredDbPath = process.env.DB_PATH || path.join('data', 'order-pulse.db');

module.exports = {
  rootDir: ROOT_DIR,
  port: Number.parseInt(process.env.PORT || '3000', 10),
  dbPath: path.resolve(ROOT_DIR, configuredDbPath),
  schemaPath: path.join(ROOT_DIR, 'schema.sql'),
  sessionSecret: process.env.SESSION_SECRET || 'development-only-change-me',
  nodeEnv: process.env.NODE_ENV || 'development',
};
