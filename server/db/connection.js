const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function openDatabase(filePath) {
  ensureParentDirectory(filePath);
  const db = new Database(filePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

function initializeSchema(db, schemaPath) {
  const hasTables = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get();
  if (hasTables) return db;

  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);
  return db;
}

function openInitializedDatabase({ dbPath, schemaPath }) {
  return initializeSchema(openDatabase(dbPath), schemaPath);
}

function transaction(db, callback) {
  return db.transaction(callback)();
}

module.exports = {
  openDatabase,
  initializeSchema,
  openInitializedDatabase,
  transaction,
};
