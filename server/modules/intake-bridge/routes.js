const express = require('express');
const env = require('../../config/env');
const { authenticate } = require('../../shared/middleware/authenticate');
const requireRole = require('../../shared/middleware/require-role');
const { sendData } = require('../../shared/http');
const AppError = require('../../shared/errors/app-error');
const ERROR_CODES = require('../../shared/errors/error-codes');

const router = express.Router();
router.use(authenticate({ secret: env.sessionSecret }));
router.use('/intake', requireRole('AGENT', 'OFFICE', 'ADMIN'));

function stretchStub(_req, _res, next) {
  next(new AppError(501, ERROR_CODES.FEATURE_NOT_IMPLEMENTED, 'Paste-to-Order is a stretch feature and is not enabled in Milestone 2'));
}

router.post('/intake/parse', stretchStub);
router.get('/intake/drafts', stretchStub);
router.patch('/intake/drafts/:id', stretchStub);
router.post('/intake/drafts/:id/confirm', stretchStub);
router.post('/intake/drafts/:id/discard', stretchStub);

module.exports = router;
