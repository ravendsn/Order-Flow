const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const env = require('./config/env');
const { openInitializedDatabase } = require('./db/connection');
const EventBus = require('./shared/events/event-bus');
const notFound = require('./shared/middleware/not-found');
const errorHandler = require('./shared/middleware/error-handler');
const apiRouter = require('./routes');

function createApp({ db, eventBus = new EventBus(), logger = console } = {}) {
  const database = db || openInitializedDatabase({ dbPath: env.dbPath, schemaPath: env.schemaPath });
  database.exec(`
    CREATE TABLE IF NOT EXISTS feedback_cases (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id),
      order_id INTEGER REFERENCES orders(id),
      product_id INTEGER REFERENCES products(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      assigned_to INTEGER REFERENCES users(id),
      case_type TEXT NOT NULL DEFAULT 'CUSTOMER_COMPLAINT'
        CHECK (case_type IN ('CUSTOMER_COMPLAINT','DAMAGED_GOODS','WRONG_ITEM','STOCK_DISCREPANCY','OTHER')),
      priority TEXT NOT NULL DEFAULT 'MEDIUM'
        CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
      status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
      description TEXT NOT NULL,
      resolution TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_cases(status, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_order ON feedback_cases(order_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_product ON feedback_cases(product_id);
  `);
  const app = express();

  app.disable('x-powered-by');
  app.locals.db = database;
  app.locals.eventBus = eventBus;
  app.locals.logger = logger;

  // Permit only loopback origins for a separate local frontend dev server
  // (for example, 127.0.0.1:5500 -> 127.0.0.1:3000). Production remains same-origin.
  app.use((req, res, next) => {
    const origin = req.get('Origin');
    let isLoopback = false;
    if (origin && env.nodeEnv !== 'production') {
      try {
        const parsed = new URL(origin);
        isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
          && ['http:', 'https:'].includes(parsed.protocol);
      } catch {
        isLoopback = false;
      }
    }
    if (isLoopback) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      res.set('Vary', 'Origin');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    return next();
  });

  app.use((req, _res, next) => {
    req.id = crypto.randomUUID();
    req.db = database;
    req.eventBus = eventBus;
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.use(express.static(path.join(env.rootDir, 'public')));

  app.get('/api/health', (_req, res) => {
    database.prepare('SELECT 1 AS ok').get();
    res.json({ data: { status: 'ok', service: 'order-pulse' } });
  });

  app.get('/api', (_req, res) => {
    res.json({ data: { service: 'order-pulse', status: 'ready' } });
  });

  app.use('/api', apiRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
