# Order Pulse: Database Schema (SQLite)
**Stack:** Node.js + Better-SQLite3 + Express
**Money:** Integer centavos (1 peso = 100 centavos) to avoid floating-point errors
**Date format:** ISO 8601 strings (e.g., `"2026-01-15T14:30:00Z"`)
---
## Overview: 18 Tables + 2 Views
Module | Tables | Notes
-------|--------|------
M1 Access & Admin | `users`, `settings`, `audit_log` | `settings` holds adjustable thresholds (high-value, hold-aging, ABC cut-offs)
M2 Product & Inventory | `products`, `stock_levels`, `stock_movements` | `stock_levels` one row per product; `stock_movements` append-only ledger
M3 Order Management | `customers`, `orders`, `order_items`, `reservations`, `unmet_demand`, `idempotency_keys` | 
M4 Approval & Exceptions | `approvals` | One row only for orders needing a human decision
M5 Fulfillment | `pick_lists`, `dispatches`, `returns`, `return_items` | `is_restockable` and `reason_code` on each return line
M6 Intake Bridge (stretch) | `intake_drafts` | Nothing else depends on it, so deletable
M7 Analytics & Alerts | `v_product_availability`, `v_sales_lines` | Views only; alerts computed on read, as agreed
---
## Table Definitions
### `settings` (M1)
| Column | Type | Constraints | Default/Comment |
|--------|------|-------------|----------------|
| `key` | TEXT | PRIMARY KEY | Setting identifier |
| `value` | TEXT | NOT NULL | JSON-encoded value or plain string |
| `updated_at` | DATETIME | NOT NULL | `CURRENT_TIMESTAMP` |
**Rows:**
- `high_value_threshold` → `"2000000"` (₱20,000 in centavos, adjustable via admin UI)
- `hold_aging_hours` → `"72"` (orders pending approval > 72 hrs flagged)
- `abc_cutoffs` → `"[20, 80]"` (A = top 20% revenue, B = next 80%... wait, actually A=top 80%, B=next 15%, C=last 5% — adjust as needed)
### `users` (M1)
| Column | Type | Constraints | Comment |
|--------|------|-------------|---------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | |
| `name` | TEXT | NOT NULL | |
| `email` | TEXT | NOT NULL, UNIQUE | |
| `password_hash` | TEXT | NOT NULL | |
| `role` | TEXT | NOT NULL, CHECK(role IN ('AGENT','OFFICE','WAREHOUSE','MANAGER','ADMIN')) | |
| `created_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
### `audit_log` (M1, shared service)
| Column | Type | Constraints | Comment |
|--------|------|-------------|---------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | |
| `actor_id` | INTEGER | NOT NULL, REFERENCES users(id) | |
| `action` | TEXT | NOT NULL | e.g. "ORDER_SUBMIT", "STOCK_RESERVE", "APPROVE", "DISPATCH" |
| `entity_type` | TEXT | NOT NULL | e.g. "ORDER", "PRODUCT", "STOCK" |
| `entity_id` | INTEGER | NOT NULL | The record ID affected |
| `before_json` | TEXT | | JSON of state before change (optional) |
| `after_json` | TEXT | | JSON of state after change (optional) |
| `created_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
### `products` (M2)
| Column | Type | Constraints | Comment |
|--------|------|-------------|---------|
| `sku` | TEXT | PRIMARY KEY | e.g. "BEV-001", "BEV-002" |
| `name` | TEXT | NOT NULL | |
| `unit` | TEXT | NOT NULL, DEFAULT "case" | e.g. "case", "bottle", "pack" |
| `cost_centavos` | INTEGER | NOT NULL | Cost to distributor |
| `price_centavos` | INTEGER | NOT NULL | Selling price |
| `reorder_level` | INTEGER | NOT NULL, DEFAULT 10 | Minimum on_hand to trigger reorder consideration |
| `is_active` | INTEGER | NOT NULL, DEFAULT 1 | 0/1 flag |
| `created_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
### `stock_levels` (M2, sole writer = M2, but callers invoke via functions)
| Column | Type | Constraints | Comment |
|--------|------|-------------|---------|
| `sku` | TEXT | PRIMARY KEY, REFERENCES products(sku) | |
| `on_hand` | INTEGER | NOT NULL, DEFAULT 0 | Current physical stock |
| `reserved` | INTEGER | NOT NULL, DEFAULT 0 | Stock temporarily held in active reservations |
| `CHECK (reserved <= on_hand)` | | Ensures no oversell at DB level | Strong point in Q&A |
| `last_adjusted_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |