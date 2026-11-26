const { DEFAULT_SETTINGS } = require('../../config/constants');

function settingNumber(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  const value = Number(row?.value);
  return Number.isFinite(value) ? value : fallback;
}

function dateOnly(value) {
  return value.toISOString().slice(0, 10);
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function daysBetween(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function resolvePeriod(db, { from, to } = {}) {
  const today = dateOnly(new Date());
  const end = to || today;
  const velocityDays = Math.max(1, Math.floor(settingNumber(db, 'sales_velocity_days', DEFAULT_SETTINGS.sales_velocity_days)));
  const start = from || shiftDate(end, -(velocityDays - 1));
  if (start > end) throw new Error('from must be on or before to');
  return { from: start, to: end, days: daysBetween(start, end) };
}

function previousPeriod(period) {
  return {
    from: shiftDate(period.from, -period.days),
    to: shiftDate(period.from, -1),
    days: period.days,
  };
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function percentChange(value, previous) {
  if (!previous) return value ? 100 : 0;
  return round(((value - previous) / previous) * 100, 1);
}

function salesLines(db, period) {
  const rows = db.prepare(`SELECT o.id AS order_id, date(o.dispatched_at) AS sale_date,
      oi.product_id, oi.qty, oi.unit_price_cents, oi.line_total_cents,
      COALESCE(ret.returned_qty, 0) AS returned_qty
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN (
      SELECT order_item_id, SUM(qty) AS returned_qty
      FROM return_items
      GROUP BY order_item_id
    ) ret ON ret.order_item_id = oi.id
    WHERE o.dispatched_at IS NOT NULL
      AND date(o.dispatched_at) BETWEEN date(?) AND date(?)`).all(period.from, period.to);

  return rows.map((row) => {
    const units = Math.max(0, row.qty - row.returned_qty);
    return {
      ...row,
      units,
      revenue_cents: Math.max(0, row.line_total_cents - (row.returned_qty * row.unit_price_cents)),
    };
  });
}

function productPerformance(db, period) {
  const products = db.prepare(`SELECT p.id AS product_id, p.name, p.sku, p.unit,
      p.unit_price_cents, p.reorder_level,
      COALESCE(s.on_hand, 0) AS on_hand,
      COALESCE(s.reserved, 0) AS reserved,
      COALESCE(s.on_hand, 0) - COALESCE(s.reserved, 0) AS available,
      CASE WHEN COALESCE(s.on_hand, 0) - COALESCE(s.reserved, 0) < p.reorder_level THEN 1 ELSE 0 END AS is_below_reorder
    FROM products p
    LEFT JOIN stock_levels s ON s.product_id = p.id
    WHERE p.is_active = 1
    ORDER BY p.name`).all();
  const metrics = new Map(products.map((product) => [product.product_id, {
    ...product,
    units: 0,
    revenue_cents: 0,
  }]));
  for (const line of salesLines(db, period)) {
    const metric = metrics.get(line.product_id);
    if (metric) {
      metric.units += line.units;
      metric.revenue_cents += line.revenue_cents;
    }
  }
  return [...metrics.values()].map((metric) => ({
    ...metric,
    avg_daily_units: round(metric.units / period.days, 2),
    days_of_stock_left: metric.units ? round(metric.available / (metric.units / period.days), 2) : null,
    is_below_reorder: Boolean(metric.is_below_reorder),
  }));
}

function salesSummary(db, period) {
  const lines = salesLines(db, period);
  const orderIds = new Set(lines.map((line) => line.order_id));
  return {
    orders: orderIds.size,
    units: lines.reduce((sum, line) => sum + line.units, 0),
    revenue_cents: lines.reduce((sum, line) => sum + line.revenue_cents, 0),
  };
}

function unmetRows(db, period) {
  return db.prepare(`SELECT ud.id, date(ud.created_at) AS demand_date,
      ud.product_id, p.name AS product_name,
      ud.customer_id, c.name AS customer_name,
      ud.requested_qty, ud.available_qty, ud.shortfall_qty, ud.unit_price_cents,
      ud.lost_value_cents
    FROM unmet_demand ud
    JOIN products p ON p.id = ud.product_id
    LEFT JOIN customers c ON c.id = ud.customer_id
    WHERE date(ud.created_at) BETWEEN date(?) AND date(?)
    ORDER BY ud.created_at DESC, ud.id DESC`).all(period.from, period.to);
}

function unmetSummary(db, period) {
  const rows = unmetRows(db, period);
  return {
    value_cents: rows.reduce((sum, row) => sum + row.lost_value_cents, 0),
    shortfall_units: rows.reduce((sum, row) => sum + row.shortfall_qty, 0),
    events: rows.length,
  };
}

function pendingApprovals(db) {
  const threshold = settingNumber(db, 'hold_aging_hours', DEFAULT_SETTINGS.hold_aging_hours);
  const rows = db.prepare(`SELECT a.id AS approval_id, a.order_id, o.order_no, o.total_cents,
      a.status, a.requested_at, a.hold_since
    FROM approvals a
    JOIN orders o ON o.id = a.order_id
    WHERE a.status IN ('PENDING', 'ON_HOLD')
    ORDER BY a.requested_at ASC, a.id ASC`).all();
  return rows.map((row) => {
    const anchor = row.status === 'ON_HOLD' && row.hold_since ? row.hold_since : row.requested_at;
    const ageHours = Math.max(0, (Date.now() - Date.parse(anchor)) / 3_600_000);
    return {
      ...row,
      age_hours: round(Number.isFinite(ageHours) ? ageHours : 0, 2),
      is_aging: ageHours > threshold,
    };
  });
}

function getOverview(db, period) {
  const previous = previousPeriod(period);
  const currentSales = salesSummary(db, period);
  const previousSales = salesSummary(db, previous);
  const currentUnmet = unmetSummary(db, period);
  const previousUnmet = unmetSummary(db, previous);
  const approvals = pendingApprovals(db);
  const lowStock = db.prepare('SELECT COUNT(*) AS count FROM v_product_availability WHERE is_below_reorder = 1').get().count;
  return {
    period: { from: period.from, to: period.to },
    orders_today: salesSummary(db, { from: dateOnly(new Date()), to: dateOnly(new Date()), days: 1 }).orders,
    orders_period: currentSales.orders,
    revenue_cents: {
      value: currentSales.revenue_cents,
      previous: previousSales.revenue_cents,
      change_pct: percentChange(currentSales.revenue_cents, previousSales.revenue_cents),
    },
    avg_order_value_cents: currentSales.orders ? Math.round(currentSales.revenue_cents / currentSales.orders) : 0,
    pending_approvals: approvals.length,
    aging_approvals: approvals.filter((approval) => approval.is_aging).length,
    low_stock_products: lowStock,
    unmet_demand_value_cents: {
      value: currentUnmet.value_cents,
      previous: previousUnmet.value_cents,
      change_pct: percentChange(currentUnmet.value_cents, previousUnmet.value_cents),
    },
  };
}

function getMovers(db, period, limit) {
  const metrics = productPerformance(db, period);
  const fast = [...metrics]
    .filter((metric) => metric.units > 0)
    .sort((a, b) => b.units - a.units || b.revenue_cents - a.revenue_cents)
    .slice(0, limit);
  const slow = [...metrics]
    .filter((metric) => metric.on_hand > 0)
    .sort((a, b) => a.units - b.units || a.revenue_cents - b.revenue_cents)
    .slice(0, limit);
  const shape = (metric) => ({
    product_id: metric.product_id,
    name: metric.name,
    units: metric.units,
    revenue_cents: metric.revenue_cents,
    avg_daily_units: metric.avg_daily_units,
  });
  return { fast: fast.map(shape), slow: slow.map(shape) };
}

function getSalesTrend(db, period, granularity) {
  const groups = new Map();
  const keyFor = (date) => {
    if (granularity === 'day') return date;
    const value = new Date(`${date}T00:00:00Z`);
    const mondayOffset = value.getUTCDay() === 0 ? 6 : value.getUTCDay() - 1;
    value.setUTCDate(value.getUTCDate() - mondayOffset);
    return dateOnly(value);
  };
  for (const line of salesLines(db, period)) {
    const key = keyFor(line.sale_date);
    const group = groups.get(key) || { date: key, orders: new Set(), units: 0, revenue_cents: 0 };
    group.orders.add(line.order_id);
    group.units += line.units;
    group.revenue_cents += line.revenue_cents;
    groups.set(key, group);
  }
  const first = granularity === 'day' ? period.from : keyFor(period.from);
  const last = granularity === 'day' ? period.to : keyFor(period.to);
  const rows = [];
  for (let cursor = first; cursor <= last; cursor = shiftDate(cursor, granularity === 'day' ? 1 : 7)) {
    const group = groups.get(cursor);
    rows.push({ date: cursor, orders: group?.orders.size || 0, units: group?.units || 0, revenue_cents: group?.revenue_cents || 0 });
  }
  return { period: { from: period.from, to: period.to }, granularity, rows };
}

function getAbc(db, period) {
  const aCutoff = settingNumber(db, 'abc_a_cutoff_pct', DEFAULT_SETTINGS.abc_a_cutoff_pct);
  const bCutoff = settingNumber(db, 'abc_b_cutoff_pct', DEFAULT_SETTINGS.abc_b_cutoff_pct);
  const metrics = productPerformance(db, period).filter((metric) => metric.revenue_cents > 0)
    .sort((a, b) => b.revenue_cents - a.revenue_cents);
  const total = metrics.reduce((sum, metric) => sum + metric.revenue_cents, 0);
  let cumulative = 0;
  const data = metrics.map((metric) => {
    const share = total ? (metric.revenue_cents / total) * 100 : 0;
    cumulative += share;
    return {
      product_id: metric.product_id,
      name: metric.name,
      revenue_cents: metric.revenue_cents,
      share_pct: round(share, 1),
      cumulative_pct: round(cumulative, 1),
      class: cumulative <= aCutoff ? 'A' : cumulative <= bCutoff ? 'B' : 'C',
    };
  });
  return { period: { from: period.from, to: period.to }, data, meta: { a_cutoff_pct: aCutoff, b_cutoff_pct: bCutoff } };
}

function getDaysOfStock(db, period, riskOnly) {
  const threshold = DEFAULT_SETTINGS.days_of_stock_threshold;
  return productPerformance(db, period)
    .filter((metric) => !riskOnly || metric.is_below_reorder || (metric.days_of_stock_left !== null && metric.days_of_stock_left <= threshold))
    .map((metric) => ({
      product_id: metric.product_id,
      name: metric.name,
      available: metric.available,
      avg_daily_units: metric.avg_daily_units,
      days_of_stock_left: metric.days_of_stock_left,
      is_below_reorder: metric.is_below_reorder,
    }));
}

function getUnmetDemand(db, period, groupBy) {
  const raw = unmetRows(db, period);
  const grouped = new Map();
  for (const row of raw) {
    const key = groupBy === 'product' ? String(row.product_id) : groupBy === 'customer' ? String(row.customer_id || 'unknown') : row.demand_date;
    const group = grouped.get(key) || {
      events: 0,
      shortfall_units: 0,
      lost_value_cents: 0,
      ...(groupBy === 'product' ? { product_id: row.product_id, name: row.product_name } : {}),
      ...(groupBy === 'customer' ? { customer_id: row.customer_id, name: row.customer_name || 'Unknown customer' } : {}),
      ...(groupBy === 'day' ? { date: row.demand_date } : {}),
    };
    group.events += 1;
    group.shortfall_units += row.shortfall_qty;
    group.lost_value_cents += row.lost_value_cents;
    grouped.set(key, group);
  }
  const rows = [...grouped.values()].sort((a, b) => b.lost_value_cents - a.lost_value_cents);
  return {
    period: { from: period.from, to: period.to },
    group_by: groupBy,
    total_lost_value_cents: raw.reduce((sum, row) => sum + row.lost_value_cents, 0),
    total_shortfall_units: raw.reduce((sum, row) => sum + row.shortfall_qty, 0),
    rows,
  };
}

function getAlerts(db, type) {
  const alerts = [];
  const stockRows = db.prepare(`SELECT product_id, name, available, reorder_level
    FROM v_product_availability WHERE is_below_reorder = 1 ORDER BY available ASC, name`).all();
  for (const row of stockRows) {
    if (!type || type === 'LOW_STOCK') alerts.push({
      type: 'LOW_STOCK',
      severity: row.available <= 0 ? 'HIGH' : 'MEDIUM',
      message: `${row.name} is below its reorder level (available ${row.available}, reorder at ${row.reorder_level})`,
      entity_type: 'PRODUCT',
      entity_id: row.product_id,
    });
  }
  for (const row of pendingApprovals(db).filter((approval) => approval.is_aging)) {
    if (!type || type === 'AGING_APPROVAL') alerts.push({
      type: 'AGING_APPROVAL',
      severity: row.age_hours > (2 * settingNumber(db, 'hold_aging_hours', DEFAULT_SETTINGS.hold_aging_hours)) ? 'HIGH' : 'MEDIUM',
      message: `Order ${row.order_no} has waited ${row.age_hours} hours for a decision`,
      entity_type: 'ORDER',
      entity_id: row.order_id,
      approval_id: row.approval_id,
      age_hours: row.age_hours,
    });
  }
  return alerts;
}

function getActions(db, period) {
  const actions = [];
  const metrics = productPerformance(db, period);
  const reorderCoverDays = DEFAULT_SETTINGS.reorder_cover_days;
  for (const metric of metrics) {
    if (metric.is_below_reorder || (metric.days_of_stock_left !== null && metric.days_of_stock_left <= DEFAULT_SETTINGS.days_of_stock_threshold)) {
      const suggestedQty = Math.max(0, Math.ceil(metric.avg_daily_units * reorderCoverDays) - metric.available);
      actions.push({
        type: 'REORDER',
        severity: metric.available <= 0 || metric.days_of_stock_left !== null && metric.days_of_stock_left <= 1 ? 'HIGH' : 'MEDIUM',
        title: `Reorder ${metric.name}`,
        detail: metric.days_of_stock_left === null ? `Available ${metric.available}; no recent sales recorded` : `${metric.days_of_stock_left} days of stock left at current sales rate`,
        suggested_qty: suggestedQty,
        entity_type: 'PRODUCT',
        entity_id: metric.product_id,
        value_cents: suggestedQty * metric.unit_price_cents,
      });
    }
    if (metric.on_hand > 0 && metric.units === 0) {
      actions.push({
        type: 'SLOW_MOVER',
        severity: 'LOW',
        title: `Review ${metric.name}`,
        detail: `No dispatched sales in the last ${period.days} days`,
        suggested_qty: 0,
        entity_type: 'PRODUCT',
        entity_id: metric.product_id,
        value_cents: metric.on_hand * metric.unit_price_cents,
      });
    }
  }
  for (const approval of pendingApprovals(db).filter((row) => row.is_aging)) {
    actions.push({
      type: 'AGING_APPROVAL',
      severity: approval.age_hours > (2 * settingNumber(db, 'hold_aging_hours', DEFAULT_SETTINGS.hold_aging_hours)) ? 'HIGH' : 'MEDIUM',
      title: `Decide order ${approval.order_no}`,
      detail: `${approval.age_hours} hours waiting for approval`,
      suggested_qty: 0,
      entity_type: 'ORDER',
      entity_id: approval.order_id,
      value_cents: approval.total_cents,
    });
  }
  const hotspot = getUnmetDemand(db, { from: shiftDate(period.to, -6), to: period.to, days: 7 }, 'product').rows[0];
  if (hotspot) {
    actions.push({
      type: 'UNMET_DEMAND_HOTSPOT',
      severity: 'HIGH',
      title: `Prioritise ${hotspot.name}`,
      detail: `${hotspot.lost_value_cents} centavos of lost demand in the last 7 days`,
      suggested_qty: hotspot.shortfall_units,
      entity_type: 'PRODUCT',
      entity_id: hotspot.product_id,
      value_cents: hotspot.lost_value_cents,
    });
  }
  const severityRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  return actions.sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.value_cents - a.value_cents)
    .map((action, index) => ({ rank: index + 1, ...action }));
}

function getReturnsByReason(db, period) {
  return db.prepare(`SELECT ri.reason_code,
      SUM(ri.qty) AS returned_units,
      SUM(CASE WHEN ri.is_restockable = 1 THEN ri.qty ELSE 0 END) AS restockable_units,
      SUM(CASE WHEN ri.is_restockable = 0 THEN ri.qty ELSE 0 END) AS not_restocked_units
    FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    WHERE date(r.recorded_at) BETWEEN date(?) AND date(?)
    GROUP BY ri.reason_code ORDER BY returned_units DESC`).all(period.from, period.to);
}

module.exports = {
  resolvePeriod,
  previousPeriod,
  getOverview,
  getMovers,
  getSalesTrend,
  getAbc,
  getDaysOfStock,
  getUnmetDemand,
  getAlerts,
  getActions,
  getReturnsByReason,
};
