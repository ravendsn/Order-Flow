const EVENT_NAMES = require('./event-names');

function publishStockChanged(eventBus, db, productId) {
  if (!eventBus?.publish) return;
  const row = db.prepare(`SELECT product_id, on_hand, reserved,
      on_hand - reserved AS available
    FROM stock_levels WHERE product_id = ?`).get(productId);
  if (row) eventBus.publish(EVENT_NAMES.STOCK_CHANGED, row);
}

function publishOrderStatusChanged(eventBus, db, orderId) {
  if (!eventBus?.publish) return;
  const row = db.prepare('SELECT id AS order_id, order_no, agent_id, status FROM orders WHERE id = ?').get(orderId);
  if (row) eventBus.publish(EVENT_NAMES.ORDER_STATUS_CHANGED, row);
}

function publishApprovalAging(eventBus, payload) {
  if (eventBus?.publish) eventBus.publish(EVENT_NAMES.APPROVAL_AGING, payload);
}

module.exports = { publishStockChanged, publishOrderStatusChanged, publishApprovalAging };
