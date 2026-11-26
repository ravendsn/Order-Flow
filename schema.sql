-- =====================================================================
-- ORDER PULSE - DATABASE SCHEMA (Task 2)  |  SQLite
-- Beverage distribution | per-product stock | reserve at submit
--
-- Conventions
--   * Run PRAGMA foreign_keys = ON on every connection.
--   * Money is stored as integer centavos (PHP 150.00 = 15000). No floats.
--   * Timestamps are UTC text, ISO-8601 via datetime('now').
--   * available = on_hand - reserved. It is DERIVED (view), never stored.
--   * Enum-like columns use CHECK constraints so bad values cannot enter.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- =====================================================================
-- M1  ACCESS & ADMIN
-- =====================================================================

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE,
  full_name     TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL
                CHECK (role IN ('AGENT','OFFICE','WAREHOUSE','MANAGER','ADMIN')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Tunable business rules (no code change needed to adjust thresholds).
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO settings (key, value, description) VALUES
  ('high_value_threshold_cents', '2000000',
   'Order total at or above PHP 20,000 needs approval'),
  ('hold_aging_hours', '4',
   'A PENDING or ON_HOLD approval older than this is flagged in Today''s Actions'),
  ('abc_a_cutoff_pct', '80',
   'ABC analysis: products making up the first 80% of revenue are class A'),
  ('abc_b_cutoff_pct', '95',
   'ABC analysis: next band up to 95% is class B, the rest is class C'),
  ('sales_velocity_days', '30',
   'Look-back window for average daily sales (days-of-stock-left, fast movers)');

-- "Audit who / when / what" lane of the flowchart. Written by every module.
CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id),      -- NULL = system action
  action        TEXT    NOT NULL,                  -- e.g. ORDER_SUBMITTED, RESERVATION_RELEASED
  entity_type   TEXT    NOT NULL,                  -- e.g. ORDER, PRODUCT, RETURN
  entity_id     INTEGER,
  before_json   TEXT,
  after_json    TEXT,
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================
-- M2  PRODUCT & INVENTORY
-- =====================================================================

CREATE TABLE products (
  id               INTEGER PRIMARY KEY,
  sku              TEXT    NOT NULL UNIQUE,
  name             TEXT    NOT NULL,
  category         TEXT,                            -- Soft Drinks, Water, Juice, Beer...
  unit             TEXT    NOT NULL,                -- CASE, PACK, BOTTLE: the unit stock is counted AND sold in
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  reorder_level    INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per product (per-product granularity, no bins / warehouses).
-- The CHECKs are the database-level safety net against overselling:
-- any update that would make reserved exceed on_hand is rejected.
CREATE TABLE stock_levels (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  on_hand    INTEGER NOT NULL DEFAULT 0 CHECK (on_hand  >= 0),
  reserved   INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (reserved <= on_hand)
);

-- Append-only ledger. Never UPDATE or DELETE rows here.
-- Summing deltas per product reproduces on_hand and reserved.
CREATE TABLE stock_movements (
  id             INTEGER PRIMARY KEY,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  movement_type  TEXT    NOT NULL
                 CHECK (movement_type IN
                   ('RECEIVE','ADJUST','RESERVE','RELEASE','DISPATCH','RETURN_RESTOCK')),
  on_hand_delta  INTEGER NOT NULL DEFAULT 0,
  reserved_delta INTEGER NOT NULL DEFAULT 0,
  ref_type       TEXT,                              -- ORDER, RETURN, MANUAL
  ref_id         INTEGER,
  reason         TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================
-- M3  ORDER MANAGEMENT
-- =====================================================================

CREATE TABLE customers (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  customer_type TEXT,                               -- Sari-sari store, Restaurant, Minimart...
  contact_no    TEXT,
  address       TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- An order row exists only AFTER stock was successfully reserved.
-- A blocked / insufficient-stock attempt creates NO order, only an
-- unmet_demand row. (Matches "Blocked / Adjust" in the flowchart.)
--
-- Status flow:
--   SUBMITTED -> APPROVED                      (auto-approve)
--   SUBMITTED -> PENDING_APPROVAL -> APPROVED | REJECTED | ON_HOLD
--   ON_HOLD   -> APPROVED | REJECTED
--   APPROVED  -> PICKING -> FULFILLED          (dispatch)
--   FULFILLED -> PARTIALLY_RETURNED | RETURNED (return recorded)
--   Before PICKING an order can also go -> CANCELLED
CREATE TABLE orders (
  id               INTEGER PRIMARY KEY,
  order_no         TEXT    NOT NULL UNIQUE,         -- human-readable, generated in the service
  customer_id      INTEGER NOT NULL REFERENCES customers(id),
  agent_id         INTEGER NOT NULL REFERENCES users(id),
  channel          TEXT    NOT NULL DEFAULT 'WEB' CHECK (channel IN ('WEB','PASTE')),
  status           TEXT    NOT NULL
                   CHECK (status IN
                     ('SUBMITTED','PENDING_APPROVAL','ON_HOLD','APPROVED','PICKING',
                      'FULFILLED','PARTIALLY_RETURNED','RETURNED','CANCELLED','REJECTED')),
  total_cents      INTEGER NOT NULL CHECK (total_cents >= 0),
  approval_mode    TEXT    CHECK (approval_mode IN ('AUTO','MANUAL')),
  approval_reasons TEXT,                            -- e.g. 'HIGH_VALUE', 'BELOW_REORDER', or both
  notes            TEXT,
  submitted_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_at      TEXT,
  dispatched_at    TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_items (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES orders(id),
  product_id       INTEGER NOT NULL REFERENCES products(id),
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),   -- price snapshot at submit
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  UNIQUE (order_id, product_id)
);

-- Reservation lifecycle per order line: ACTIVE -> CONSUMED (dispatch) | RELEASED (reject/cancel).
-- Invariant to test: SUM(qty) of ACTIVE rows per product = stock_levels.reserved.
CREATE TABLE reservations (
  id            INTEGER PRIMARY KEY,
  order_item_id INTEGER NOT NULL UNIQUE REFERENCES order_items(id),
  product_id    INTEGER NOT NULL REFERENCES products(id),
  qty           INTEGER NOT NULL CHECK (qty > 0),
  status        TEXT    NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE','CONSUMED','RELEASED')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  closed_at     TEXT
);

-- Write side of "Log unmet demand". One row per product line that could not be fully served.
CREATE TABLE unmet_demand (
  id                  INTEGER PRIMARY KEY,
  product_id          INTEGER NOT NULL REFERENCES products(id),
  customer_id         INTEGER REFERENCES customers(id),
  agent_id            INTEGER REFERENCES users(id),
  channel             TEXT    NOT NULL DEFAULT 'WEB' CHECK (channel IN ('WEB','PASTE')),
  requested_qty       INTEGER NOT NULL CHECK (requested_qty > 0),
  available_qty       INTEGER NOT NULL CHECK (available_qty >= 0),    -- availability at that moment
  shortfall_qty       INTEGER NOT NULL CHECK (shortfall_qty > 0),     -- requested - available
  unit_price_cents    INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  lost_value_cents    INTEGER NOT NULL CHECK (lost_value_cents >= 0), -- shortfall * price
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Idempotent order submit. A retried request with the same key returns the stored
-- response instead of re-running (no duplicate orders, no double-counted unmet demand).
CREATE TABLE idempotency_keys (
  user_id         INTEGER NOT NULL REFERENCES users(id),
  idem_key        TEXT    NOT NULL,
  endpoint        TEXT    NOT NULL,                 -- e.g. POST /api/orders
  request_hash    TEXT    NOT NULL,                 -- detects same key with a different body
  response_status INTEGER,
  response_body   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, idem_key)
);

-- =====================================================================
-- M4  APPROVAL & EXCEPTIONS
-- =====================================================================

-- One row per order that needs a human decision. Auto-approved orders have no row
-- (they are recorded in audit_log and orders.approval_mode = 'AUTO').
CREATE TABLE approvals (
  id            INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  reasons       TEXT    NOT NULL,                   -- HIGH_VALUE and/or BELOW_REORDER
  status        TEXT    NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','ON_HOLD','APPROVED','REJECTED')),
  requested_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_by    INTEGER REFERENCES users(id),
  decided_at    TEXT,
  hold_since    TEXT,                               -- set when moved to ON_HOLD (aging clock)
  decision_note TEXT
);

-- =====================================================================
-- M5  FULFILLMENT
-- =====================================================================

-- Pick list items are derived from order_items (no bins, no partial picks).
CREATE TABLE pick_lists (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  status       TEXT    NOT NULL DEFAULT 'GENERATED'
               CHECK (status IN ('GENERATED','PACKED','DISPATCHED')),
  generated_by INTEGER REFERENCES users(id),
  generated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  packed_by    INTEGER REFERENCES users(id),
  packed_at    TEXT
);

CREATE TABLE dispatches (
  id            INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  dispatched_by INTEGER NOT NULL REFERENCES users(id),
  dispatched_at TEXT    NOT NULL DEFAULT (datetime('now')),
  remarks       TEXT
);

-- An order can have several return events over time.
CREATE TABLE returns (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  recorded_at TEXT    NOT NULL DEFAULT (datetime('now')),
  note        TEXT
);

-- "Restockable?" decision lives per returned line.
-- is_restockable = 1 -> service calls M2 restock (on_hand +qty); 0 -> logged only.
CREATE TABLE return_items (
  id             INTEGER PRIMARY KEY,
  return_id      INTEGER NOT NULL REFERENCES returns(id),
  order_item_id  INTEGER NOT NULL REFERENCES order_items(id),
  product_id     INTEGER NOT NULL REFERENCES products(id),
  qty            INTEGER NOT NULL CHECK (qty > 0),
  reason_code    TEXT    NOT NULL
                 CHECK (reason_code IN
                   ('DAMAGED','EXPIRED','WRONG_ITEM','CUSTOMER_REFUSED','OVERDELIVERED','OTHER')),
  is_restockable INTEGER NOT NULL CHECK (is_restockable IN (0,1))
);

-- Operational feedback and product/order issue cases.
-- This is not a stock writer; it records the reason a human needs to investigate.
CREATE TABLE feedback_cases (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER REFERENCES customers(id),
  order_id     INTEGER REFERENCES orders(id),
  product_id   INTEGER REFERENCES products(id),
  created_by   INTEGER NOT NULL REFERENCES users(id),
  assigned_to  INTEGER REFERENCES users(id),
  case_type    TEXT NOT NULL DEFAULT 'CUSTOMER_COMPLAINT'
               CHECK (case_type IN ('CUSTOMER_COMPLAINT','DAMAGED_GOODS','WRONG_ITEM','STOCK_DISCREPANCY','OTHER')),
  priority     TEXT NOT NULL DEFAULT 'MEDIUM'
               CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
  status       TEXT NOT NULL DEFAULT 'OPEN'
               CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
  description  TEXT NOT NULL,
  resolution   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT
);

-- =====================================================================
-- M6  INTAKE BRIDGE  (STRETCH - safe to omit; nothing else depends on it)
-- =====================================================================

CREATE TABLE intake_drafts (
  id          INTEGER PRIMARY KEY,
  raw_text    TEXT    NOT NULL,
  parsed_json TEXT,
  confidence  REAL    CHECK (confidence BETWEEN 0 AND 1),
  status      TEXT    NOT NULL DEFAULT 'DRAFT'
              CHECK (status IN ('DRAFT','CONFIRMED','DISCARDED')),
  customer_id INTEGER REFERENCES customers(id),
  order_id    INTEGER REFERENCES orders(id),         -- set after the draft becomes a real order
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================
-- M7  ANALYTICS & ALERTS  (read-only views; alerts are computed on read)
-- =====================================================================

CREATE VIEW v_product_availability AS
SELECT p.id                               AS product_id,
       p.sku, p.name, p.category, p.unit,
       p.unit_price_cents, p.reorder_level,
       COALESCE(s.on_hand, 0)              AS on_hand,
       COALESCE(s.reserved, 0)             AS reserved,
       (COALESCE(s.on_hand, 0) - COALESCE(s.reserved, 0)) AS available,
       CASE WHEN (COALESCE(s.on_hand, 0) - COALESCE(s.reserved, 0)) < p.reorder_level THEN 1 ELSE 0 END
                                          AS is_below_reorder
FROM products p
LEFT JOIN stock_levels s ON s.product_id = p.id
WHERE p.is_active = 1;

-- Gross sales lines: only orders that have actually been dispatched.
-- Returns are netted inside the analytics queries (Task 3).
CREATE VIEW v_sales_lines AS
SELECT o.id            AS order_id,
       date(o.dispatched_at) AS sale_date,
       o.customer_id, o.agent_id, o.channel,
       oi.product_id, oi.qty, oi.line_total_cents
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.dispatched_at IS NOT NULL;

-- =====================================================================
-- INDEXES
-- =====================================================================

CREATE INDEX idx_orders_status         ON orders(status);
CREATE INDEX idx_orders_customer       ON orders(customer_id);
CREATE INDEX idx_orders_agent          ON orders(agent_id);
CREATE INDEX idx_orders_submitted_at   ON orders(submitted_at);
CREATE INDEX idx_order_items_order     ON order_items(order_id);
CREATE INDEX idx_order_items_product   ON order_items(product_id);
CREATE INDEX idx_reservations_status   ON reservations(product_id, status);
CREATE INDEX idx_movements_product     ON stock_movements(product_id, created_at);
CREATE INDEX idx_unmet_product         ON unmet_demand(product_id, created_at);
CREATE INDEX idx_unmet_created         ON unmet_demand(created_at);
CREATE INDEX idx_approvals_status      ON approvals(status, requested_at);
CREATE INDEX idx_returns_order         ON returns(order_id);
CREATE INDEX idx_return_items_return   ON return_items(return_id);
CREATE INDEX idx_audit_entity          ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created         ON audit_log(created_at);
CREATE INDEX idx_feedback_status       ON feedback_cases(status, priority, created_at);
CREATE INDEX idx_feedback_order        ON feedback_cases(order_id);
CREATE INDEX idx_feedback_product      ON feedback_cases(product_id);
