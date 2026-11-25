const env = require('./config/env');
const { createApp } = require('./app');

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`Order Pulse listening on http://localhost:${env.port}`);
});

function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  server.close(() => {
    app.locals.db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
