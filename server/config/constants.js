const ROLES = Object.freeze(['AGENT', 'OFFICE', 'WAREHOUSE', 'MANAGER', 'ADMIN']);

const ORDER_STATUSES = Object.freeze([
  'SUBMITTED',
  'PENDING_APPROVAL',
  'ON_HOLD',
  'APPROVED',
  'PICKING',
  'FULFILLED',
  'PARTIALLY_RETURNED',
  'RETURNED',
  'CANCELLED',
  'REJECTED',
]);

const STOCK_MOVEMENT_TYPES = Object.freeze([
  'RECEIVE',
  'ADJUST',
  'RESERVE',
  'RELEASE',
  'DISPATCH',
  'RETURN_RESTOCK',
]);

const DEFAULT_SETTINGS = Object.freeze({
  high_value_threshold_cents: 2_000_000,
  hold_aging_hours: 4,
  abc_a_cutoff_pct: 80,
  abc_b_cutoff_pct: 95,
  sales_velocity_days: 30,
  days_of_stock_threshold: 3,
  reorder_cover_days: 14,
});

module.exports = { ROLES, ORDER_STATUSES, STOCK_MOVEMENT_TYPES, DEFAULT_SETTINGS };
