const express = require('express');
const crypto = require('node:crypto');
const env = require('./config/env');
const { openInitializedDatabase } = require('./db/connection');
const EventBus = require('./shared/events/event-bus');
const notFound = require('./shared/middleware/not-found');
const errorHandler = require('./shared/middleware/error-handler');
const apiRouter = require('./routes');

function createApp({ db, eventBus = new EventBus(), logger = console } = {}) {
  const database = db || openInitializedDatabase({ dbPath: env.dbPath, schemaPath: env.schemaPath });
  const app = express();

  app.disable('x-powered-by');
  app.locals.db = database;
  app.locals.eventBus = eventBus;
  app.locals.logger = logger;

  app.use((req, _res, next) => {
    req.id = crypto.randomUUID();
    req.db = database;
    req.eventBus = eventBus;
    next();
  });
  app.use(express.json({ limit: '1mb' }));

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
