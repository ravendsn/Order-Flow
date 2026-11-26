const express = require('express');
const { publicRouter, protectedRouter } = require('./modules/access-admin/routes');
const productRouter = require('./modules/product-inventory/routes');
const orderRouter = require('./modules/order-management/routes');
const approvalRouter = require('./modules/approval-exceptions/routes');
const fulfillmentRouter = require('./modules/fulfillment/routes');
const intakeRouter = require('./modules/intake-bridge/routes');

const router = express.Router();
router.use(publicRouter);
router.use(protectedRouter);
router.use(productRouter);
router.use(orderRouter);
router.use(approvalRouter);
router.use(fulfillmentRouter);
router.use(intakeRouter);

module.exports = router;
