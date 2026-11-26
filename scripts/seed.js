const fs = require('node:fs');
const path = require('node:path');
const env = require('../server/config/env');
const { openInitializedDatabase, transaction } = require('../server/db/connection');
const { hashPassword } = require('../server/shared/utils/password');

const products = [
  ['CLA-15L', 'Cola 1.5L (case of 12)', 'Soft Drinks', 'CASE', 45000, 90],
  ['COL-330', 'Cola 330ml (case of 24)', 'Soft Drinks', 'CASE', 38000, 120],
  ['SPW-500', 'Sparkling Water 500ml (pack of 24)', 'Water', 'PACK', 24000, 80],
  ['MWT-500', 'Mineral Water 500ml (pack of 24)', 'Water', 'PACK', 21000, 100],
  ['JCE-1L', 'Orange Juice 1L (case of 12)', 'Juice', 'CASE', 52000, 60],
  ['TST-350', 'Iced Tea 350ml (case of 24)', 'Juice', 'CASE', 41000, 75],
  ['ENE-250', 'Energy Drink 250ml (case of 24)', 'Energy', 'CASE', 68000, 45],
  ['SDA-330', 'Soda Assorted 330ml (case of 24)', 'Soft Drinks', 'CASE', 36000, 110],
  ['LEM-1L', 'Lemon Soda 1L (case of 12)', 'Soft Drinks', 'CASE', 43000, 70],
  ['COF-240', 'Ready Coffee 240ml (case of 24)', 'Coffee', 'CASE', 72000, 40],
  ['BEER-330', 'Lager Beer 330ml (case of 24)', 'Beer', 'CASE', 125000, 35],
  ['ISO-500', 'Isotonic Drink 500ml (pack of 12)', 'Sports Drink', 'PACK', 33000, 65],
];

const customers = [
  ['Aling Nena Sari-Sari Store', 'Sari-sari store', '09170000001', 'Batangas City'],
  ['Lakeside Minimart', 'Minimart', '09170000002', 'Lipa City'],
  ['The Daily Grind Cafe', 'Cafe', '09170000003', 'Malvar'],
  ['Cornerstone Restaurant', 'Restaurant', '09170000004', 'Tanauan'],
  ['Fresh Stop Grocery', 'Grocery', '09170000005', 'Sto. Tomas'],
  ['Bayside Hotel', 'Hotel', '09170000006', 'Nasugbu'],
  ['Campus Canteen', 'Canteen', '09170000007', 'Batangas City'],
  ['Highway 5 Convenience', 'Convenience store', '09170000008', 'Ibaan'],
  ['Sunrise Bakery', 'Bakery', '09170000009', 'Rosario'],
  ['Green Valley Resort', 'Resort', '09170000010', 'Mabini'],
  ['Public Market Stall 18', 'Market stall', '09170000011', 'Balayan'],
  ['Northpoint Pharmacy Cafe', 'Cafe', '09170000012', 'Taal'],
];

const users = [
  ['agent1', 'Juan Dela Cruz', 'AGENT', 'agent1234'],
  ['agent2', 'Maria Santos', 'AGENT', 'agent1234'],
  ['office1', 'Liza Mercado', 'OFFICE', 'office1234'],
  ['warehouse1', 'Ramon Garcia', 'WAREHOUSE', 'warehouse1234'],
  ['manager1', 'Ana Reyes', 'MANAGER', 'manager1234'],
  ['admin1', 'Ralph Raven', 'ADMIN', 'admin1234'],
];

function makeRandom(seed = 314159) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function int(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function isoDaysAgo(daysAgo, hour = 9, minute = 0) {
  const date = new Date(Date.now() - (daysAgo * 86_400_000));
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

function resetDatabase() {
  fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
  for (const filePath of [env.dbPath, `${env.dbPath}-wal`, `${env.dbPath}-shm`]) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  }
}

function seed() {
  resetDatabase();
  const db = openInitializedDatabase({ dbPath: env.dbPath, schemaPath: env.schemaPath });
  const random = makeRandom();

  transaction(db, () => {
    const insertUser = db.prepare('INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)');
    const userIds = new Map();
    for (const [username, fullName, role, password] of users) {
      const result = insertUser.run(username, fullName, hashPassword(password), role);
      userIds.set(username, Number(result.lastInsertRowid));
    }

    const insertCustomer = db.prepare('INSERT INTO customers (name, customer_type, contact_no, address) VALUES (?, ?, ?, ?)');
    const customerIds = customers.map((customer) => Number(insertCustomer.run(...customer).lastInsertRowid));

    const insertProduct = db.prepare('INSERT INTO products (sku, name, category, unit, unit_price_cents, reorder_level) VALUES (?, ?, ?, ?, ?, ?)');
    const insertStock = db.prepare('INSERT INTO stock_levels (product_id, on_hand, reserved) VALUES (?, ?, 0)');
    const insertMovement = db.prepare('INSERT INTO stock_movements (product_id, movement_type, on_hand_delta, reserved_delta, ref_type, ref_id, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const productRows = [];

    for (const product of products) {
      const [sku, name, category, unit, price, reorderLevel] = product;
      const productId = Number(insertProduct.run(sku, name, category, unit, price, reorderLevel).lastInsertRowid);
      const initialStock = 1_000;
      insertStock.run(productId, initialStock);
      insertMovement.run(productId, 'RECEIVE', initialStock, 0, 'MANUAL', null, 'SEED_INITIAL_STOCK', userIds.get('warehouse1'), isoDaysAgo(90, 7));
      productRows.push({ id: productId, sku, name, price });
    }

    const insertOrder = db.prepare(`INSERT INTO orders
      (order_no, customer_id, agent_id, channel, status, total_cents, approval_mode, submitted_at, approved_at, dispatched_at)
      VALUES (?, ?, ?, 'WEB', ?, ?, 'AUTO', ?, ?, ?)`);
    const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, qty, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?)');
    const insertReservation = db.prepare("INSERT INTO reservations (order_item_id, product_id, qty, status, created_at, closed_at) VALUES (?, ?, ?, 'CONSUMED', ?, ?)");
    const insertPickList = db.prepare("INSERT INTO pick_lists (order_id, status, generated_by, generated_at, packed_by, packed_at) VALUES (?, 'DISPATCHED', ?, ?, ?, ?)");
    const insertDispatch = db.prepare('INSERT INTO dispatches (order_id, dispatched_by, dispatched_at, remarks) VALUES (?, ?, ?, ?)');
    const reserveHistoricalStock = db.prepare('UPDATE stock_levels SET reserved = reserved + ?, updated_at = ? WHERE product_id = ?');
    const updateStockForDispatch = db.prepare('UPDATE stock_levels SET on_hand = on_hand - ?, reserved = reserved - ?, updated_at = ? WHERE product_id = ?');
    const insertAudit = db.prepare('INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)');

    let orderSequence = 1;
    for (let daysAgo = 89; daysAgo >= 1; daysAgo -= 1) {
      const dailyOrders = int(random, 4, 8);
      for (let orderIndex = 0; orderIndex < dailyOrders; orderIndex += 1) {
        const submittedAt = isoDaysAgo(daysAgo, int(random, 7, 16), int(random, 0, 59));
        const selected = new Set();
        const lineCount = int(random, 1, 3);
        const lines = [];
        while (lines.length < lineCount) {
          const product = productRows[int(random, 0, productRows.length - 1)];
          if (selected.has(product.id)) continue;
          selected.add(product.id);
          const qty = int(random, 1, 8);
          lines.push({ product, qty });
        }

        const totalCents = lines.reduce((sum, line) => sum + (line.qty * line.product.price), 0);
        const orderNo = `OP-${submittedAt.slice(0, 10).replaceAll('-', '')}-${String(orderSequence).padStart(4, '0')}`;
        orderSequence += 1;
        const dispatchAt = isoDaysAgo(daysAgo, 15, int(random, 0, 59));
        const orderId = Number(insertOrder.run(orderNo, customerIds[int(random, 0, customerIds.length - 1)], userIds.get(random() > 0.5 ? 'agent1' : 'agent2'), 'FULFILLED', totalCents, submittedAt, submittedAt, dispatchAt).lastInsertRowid);

        for (const line of lines) {
          const itemId = Number(insertItem.run(orderId, line.product.id, line.qty, line.product.price, line.qty * line.product.price).lastInsertRowid);
          insertReservation.run(itemId, line.product.id, line.qty, submittedAt, dispatchAt);
          reserveHistoricalStock.run(line.qty, submittedAt, line.product.id);
          insertMovement.run(line.product.id, 'RESERVE', 0, line.qty, 'ORDER', orderId, 'SEED_HISTORICAL_ORDER', userIds.get('agent1'), submittedAt);
          updateStockForDispatch.run(line.qty, line.qty, dispatchAt, line.product.id);
          insertMovement.run(line.product.id, 'DISPATCH', -line.qty, -line.qty, 'ORDER', orderId, 'SEED_HISTORICAL_DISPATCH', userIds.get('warehouse1'), dispatchAt);
        }

        insertPickList.run(orderId, userIds.get('warehouse1'), submittedAt, userIds.get('warehouse1'), dispatchAt);
        insertDispatch.run(orderId, userIds.get('warehouse1'), dispatchAt, 'Seeded historical dispatch');
        insertAudit.run(userIds.get('agent1'), 'ORDER_SUBMITTED', 'ORDER', orderId, 'Seeded historical order', submittedAt);
        insertAudit.run(userIds.get('warehouse1'), 'ORDER_DISPATCHED', 'ORDER', orderId, 'Seeded historical dispatch', dispatchAt);
      }
    }

    const insertReturn = db.prepare('INSERT INTO returns (order_id, recorded_by, recorded_at, note) VALUES (?, ?, ?, ?)');
    const insertReturnItem = db.prepare('INSERT INTO return_items (return_id, order_item_id, product_id, qty, reason_code, is_restockable) VALUES (?, ?, ?, ?, ?, ?)');
    const updateOrderStatus = db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?');
    const dispatchedItems = db.prepare("SELECT oi.id, oi.order_id, oi.product_id, oi.qty FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status = 'FULFILLED' ORDER BY oi.id").all();

    for (const item of dispatchedItems) {
      if (random() > 0.12) continue;
      const returnAt = isoDaysAgo(int(random, 0, 20), 10, int(random, 0, 59));
      const qty = int(random, 1, item.qty);
      const isRestockable = random() > 0.3 ? 1 : 0;
      const reason = isRestockable ? 'CUSTOMER_REFUSED' : 'DAMAGED';
      const returnId = Number(insertReturn.run(item.order_id, userIds.get('office1'), returnAt, 'Seeded historical return').lastInsertRowid);
      insertReturnItem.run(returnId, item.id, item.product_id, qty, reason, isRestockable);
      if (isRestockable) {
        db.prepare('UPDATE stock_levels SET on_hand = on_hand + ?, updated_at = ? WHERE product_id = ?').run(qty, returnAt, item.product_id);
        insertMovement.run(item.product_id, 'RETURN_RESTOCK', qty, 0, 'RETURN', returnId, 'SEED_RESTOCKABLE_RETURN', userIds.get('warehouse1'), returnAt);
      }
      const returnTotals = db.prepare(`SELECT
          COALESCE(SUM(oi.qty), 0) AS ordered_qty,
          COALESCE((SELECT SUM(ri.qty) FROM return_items ri JOIN returns r ON r.id = ri.return_id WHERE r.order_id = ?), 0) AS returned_qty
        FROM order_items oi WHERE oi.order_id = ?`).get(item.order_id, item.order_id);
      updateOrderStatus.run(returnTotals.returned_qty >= returnTotals.ordered_qty ? 'RETURNED' : 'PARTIALLY_RETURNED', returnAt, item.order_id);
      insertAudit.run(userIds.get('office1'), 'RETURN_RECORDED', 'RETURN', returnId, 'Seeded historical return', returnAt);
    }

    const insertUnmet = db.prepare('INSERT INTO unmet_demand (product_id, customer_id, agent_id, requested_qty, available_qty, shortfall_qty, unit_price_cents, lost_value_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (let index = 0; index < 36; index += 1) {
      const product = productRows[int(random, 0, productRows.length - 1)];
      const requested = int(random, 8, 30);
      const available = int(random, 0, Math.max(0, requested - 1));
      const shortfall = requested - available;
      insertUnmet.run(product.id, customerIds[int(random, 0, customerIds.length - 1)], userIds.get(random() > 0.5 ? 'agent1' : 'agent2'), requested, available, shortfall, product.price, shortfall * product.price, isoDaysAgo(int(random, 0, 89), 11, int(random, 0, 59)));
    }

    const insertOpenOrder = db.prepare(`INSERT INTO orders
      (order_no, customer_id, agent_id, channel, status, total_cents, approval_mode, approval_reasons, submitted_at)
      VALUES (?, ?, ?, 'WEB', ?, ?, ?, ?, ?)`);
    const insertOpenItem = db.prepare('INSERT INTO order_items (order_id, product_id, qty, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?)');
    const insertOpenReservation = db.prepare("INSERT INTO reservations (order_item_id, product_id, qty, status, created_at) VALUES (?, ?, ?, 'ACTIVE', ?)");
    const reserveStock = db.prepare('UPDATE stock_levels SET reserved = reserved + ?, updated_at = ? WHERE product_id = ?');
    const insertApproval = db.prepare('INSERT INTO approvals (order_id, reasons, status, requested_at, hold_since) VALUES (?, ?, ?, ?, ?)');

    for (let index = 0; index < 5; index += 1) {
      const product = productRows[index];
      const qty = 4 + index;
      const status = index < 3 ? 'PENDING_APPROVAL' : 'ON_HOLD';
      const submittedAt = isoDaysAgo(index + 1, 8, 15);
      const reasons = index % 2 === 0 ? 'HIGH_VALUE,BELOW_REORDER' : 'BELOW_REORDER';
      const orderId = Number(insertOpenOrder.run(`OP-DEMO-${String(index + 1).padStart(4, '0')}`, customerIds[index], userIds.get('agent1'), status, qty * product.price, 'MANUAL', reasons, submittedAt).lastInsertRowid);
      const itemId = Number(insertOpenItem.run(orderId, product.id, qty, product.price, qty * product.price).lastInsertRowid);
      insertOpenReservation.run(itemId, product.id, qty, submittedAt);
      reserveStock.run(qty, submittedAt, product.id);
      insertMovement.run(product.id, 'RESERVE', 0, qty, 'ORDER', orderId, 'SEED_ACTIVE_RESERVATION', userIds.get('agent1'), submittedAt);
      insertApproval.run(orderId, reasons, status === 'ON_HOLD' ? 'ON_HOLD' : 'PENDING', submittedAt, status === 'ON_HOLD' ? submittedAt : null);
      insertAudit.run(userIds.get('agent1'), 'APPROVAL_REQUESTED', 'ORDER', orderId, 'Seeded active approval', submittedAt);
    }
  });

  const counts = {};
  for (const table of ['users', 'customers', 'products', 'orders', 'order_items', 'reservations', 'unmet_demand', 'approvals', 'pick_lists', 'dispatches', 'returns', 'return_items', 'audit_log']) {
    counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  }
  const activeStock = db.prepare('SELECT COUNT(*) AS count FROM stock_levels WHERE reserved > 0').get().count;
  console.log(JSON.stringify({ database: env.dbPath, counts, productsWithActiveReservations: activeStock }, null, 2));
  console.log('Demo passwords: agent1234, office1234, warehouse1234, manager1234, admin1234');
  db.close();
}

seed();
