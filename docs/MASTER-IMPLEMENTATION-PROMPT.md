# Order Pulse — Master Implementation, Debugging & Expansion Prompt

Copy this prompt into a future implementation session when work should resume.

---

## Role

You are the lead full-stack engineer, product designer, UX researcher, QA engineer, and technical writer for Order Pulse.

Work inside the existing repository and understand the current implementation before changing anything. The goal is to turn Order Pulse into a practical, role-based beverage distribution operations system that improves speed, clarity, accountability, and user confidence for sales, office, warehouse, managers, and administrators.

Do not treat this as a visual-only redesign. Fix broken workflows, add missing functionality, improve information architecture, and then apply a coherent visual system.

## Product context

Order Pulse is a web-based inventory and sales-order system for beverage distribution. It replaces fragmented texts, emails, and spreadsheets with one workflow for:

- customer order entry;
- inventory availability and reservation;
- approvals and exceptions;
- picking, packing, dispatch, and returns;
- analytics, alerts, and decision support;
- access, catalog, settings, and audit governance.

Current stack: Node.js, Express, SQLite, vanilla JavaScript, HTML, CSS, and Chart.js.

Primary references:

- `AGENTS.md`
- `README.md`
- `schema.sql`
- `DESIGN-linear.app.md`
- `docs/api.md`
- `docs/diagrams/order-flow-flowchart.md`

## Non-negotiable system rules

Preserve these rules in every change:

1. Stock is stored per product only. Store `on_hand` and `reserved`; always derive `available = on_hand - reserved`.
2. Only M2 (`product-inventory`) may mutate `on_hand` or `reserved`.
3. Stock mutations must use atomic SQL transactions and preserve `CHECK (reserved <= on_hand)`.
4. Reserve inventory when an order is submitted, not while it is a draft.
5. Order submission must support `Idempotency-Key` and prevent duplicate retries, overselling, and double reservations.
6. Log insufficient stock as `unmet_demand` without creating a false order.
7. Approval is triggered after reservation when order value reaches `high_value_threshold_cents` or post-order availability falls below reorder level.
8. Approve means `APPROVED`; reject or cancel releases the reservation; hold means `ON_HOLD` and keeps the reservation active.
9. Dispatch consumes the reservation and deducts `on_hand`.
10. Returns must record `reason_code` and `is_restockable`; only restock when `is_restockable = true`.
11. M7 (`analytics-alerts`) remains read-only and computes metrics and alerts on read. SSE continues through the internal event bus at `GET /alerts/stream`.
12. Keep the seven consolidated modules. M6 (`intake-bridge`) remains stretch scope unless explicitly promoted.
13. Store money as integer centavos and use UTC timestamps.
14. Do not rewrite stable M1–M2 code unless a verified contract, security, data-integrity, or end-to-end workflow problem requires it.

## Product direction

Transform the frontend from a collection of sparse pages into role-based work cockpits.

Every screen must answer:

1. What needs my attention?
2. What is the next best action?
3. What will happen when I take it?
4. Where can I verify the result?

Use progressive disclosure. Put the primary task first, secondary information in panels or drawers, and deeper investigation behind meaningful click-throughs.

## Shared application shell

Implement a dependable shared shell for every authenticated role:

- working role-aware navigation;
- visible active state;
- keyboard-accessible navigation and focus management;
- responsive sidebar that becomes a usable mobile menu or tab bar;
- header format `ORDER PULSE | [Current workspace]`;
- user avatar/photo with accessible name and role;
- notification bell with unread count capped at `+99`;
- persistent notification center with unread/read state, clear-all, dismiss, and deep links;
- explicit loading, success, error, empty, disabled, and offline/live-update states;
- no browser `alert`, `confirm`, or `prompt` for application workflows;
- accessible dialogs, drawers, or sheets with cancel and escape behavior;
- consistent focus rings, labels, error placement, and status text.

Notifications should be actionable. Approval notifications should link to the approval detail; stock alerts should link to the product or inventory context; fulfillment events should link to the order; feedback issues should link to the case. Do not allow notifications to be only decorative toasts.

## Sales Agent workspace

Make order entry fast and forgiving:

- searchable customer selector;
- required customer name;
- create-customer side sheet with name, customer type, contact, and address;
- customer history and recent orders where useful;
- product picker window rather than a long plain dropdown;
- product image, SKU, category, unit, price, available quantity, reserved quantity, and reorder warning;
- product search, category filter, stock filter, and keyboard navigation;
- editable cart with quantity controls, duplicate-line handling, total, and availability validation;
- useful empty states and inline errors;
- order confirmation motion that preserves spatial continuity and respects reduced motion;
- receipt view containing order number, customer, lines, quantities, prices, total, status, and next step;
- print and download actions;
- email action through a safe preview/mock adapter unless external email delivery is explicitly configured;
- recent orders with status and meaningful detail navigation.

## Office workspace

Build an approval and exceptions cockpit:

- approval queue sorted by urgency, aging, value, and stock risk;
- filters for pending, aging, high value, below reorder, held, and resolved;
- approval detail drawer or window showing customer, order lines, stock before/after, trigger reason, history, and notes;
- proper approve, hold, reject, and cancel actions;
- confirmation for destructive decisions;
- no native browser prompts;
- clear reservation behavior in the interface;
- returns and customer issue cases with owner, status, reason, and resolution.

## Warehouse workspace

Create a fulfillment station instead of a sparse page:

- work board for `To pick`, `Picking`, `Packed`, `Ready to dispatch`, `Dispatched`, and `Returns / issues`;
- order lookup and pick-list detail;
- high-visibility quantities and product information;
- pack and dispatch actions with confirmation and completion feedback;
- receiving and stock-adjustment workflows routed through M2 only;
- return inspection with reason, restock decision, and notes;
- customer complaints represented as traceable issue cases linked to the order and product;
- warehouse-relevant signals such as stock discrepancies, damaged goods, wrong items, and urgent dispatches.

Do not invent warehouse notifications that have no source. Every complaint or issue must have a clear origin, record, owner, status, and next action.

## Manager workspace

Make the command center priority-first:

- top actions requiring attention;
- revenue, orders, fulfillment, pending approvals, low stock, and lost-demand KPIs;
- approval SLA and aging visualization;
- demand and sales trends;
- fast movers, slow movers, and days-of-stock context;
- prioritized alerts with severity, value at risk, owner, and due action;
- clickable cards and chart points when a detail destination exists;
- drill-down views for orders, products, approvals, unmet demand, returns, and alerts;
- filters for time range and operational area.

Do not fill space with charts that do not support a decision.

## Admin workspace

Expand administration beyond two static tables:

- users, roles, active/inactive status, and access review;
- catalog and product visibility management;
- business settings and thresholds;
- audit log search and filtering;
- event-stream/live-update status;
- API and database health indicators appropriate for this project;
- data-quality checks;
- activity and performance summaries;
- clear separation between administrative actions and stock mutations.

## Landing and authentication

Separate public landing content from login:

- short, skippable intro interaction or animation;
- accessible reduced-motion fallback;
- logo and brand story with intentional composition;
- explanation of how Order Pulse helps sales, office, warehouse, and management;
- clear `Get started` and `Sign in` actions;
- role-based access after authentication;
- preserve password-manager support, labels, validation, and accessible errors.

Do not allow the landing page to delay users who need to sign in quickly.

## Visual direction

Use `DESIGN-linear.app.md` as the current visual baseline for Milestone 4: dark surface hierarchy, hairline borders, strong typography, restrained accents, and product-focused layout.

It is not a limit on functionality or information architecture. If the final product direction uses a green brand palette, reconcile the specification first and then apply one coherent token system. Prefer a restrained operational green/emerald accent over indiscriminate green gradients. Maintain semantic distinction between success, warning, danger, and information states.

Keep the visual system consistent across all roles. Use SVG/vector icons from one family, real or generated product images with reserved dimensions, meaningful avatars/photos where available, accessible contrast, and motion that explains state changes rather than adding decoration.

## Implementation process

Work one milestone at a time.

### Milestone 0 — Baseline and diagnosis

- inspect the repository, current git status, routes, schema, frontend shell, and seeded data;
- do not overwrite user changes;
- identify actual breakages before refactoring;
- run syntax checks and safe read-only diagnostics;
- use an isolated temporary SQLite database for destructive smoke tests;
- never run `npm run seed` against the shared database without explicit approval.

### Milestone 1 — Shared shell and navigation

- fix navigation event wiring;
- establish role-aware information architecture;
- add shared header, notification center foundation, responsive behavior, and accessible state handling;
- verify every role can reach every permitted view.

### Milestone 2 — Sales workflow

- customer creation/search;
- product picker;
- editable order cart;
- confirmation receipt;
- print/download/email-preview behavior;
- verify idempotent order submit and reservation behavior.

### Milestone 3 — Office and warehouse workflows

- approval dialogs and detail views;
- returns/issues/feedback workflow;
- warehouse fulfillment board;
- verify approval, rejection, hold, cancellation, dispatch, and return stock behavior.

### Milestone 4 — Manager, admin, and visual system

- interactive analytics and drill-downs;
- prioritized alerts;
- admin governance and health views;
- finalize the agreed color and typography tokens;
- complete responsive, accessibility, and motion pass.

### Milestone 5 — Landing, polish, and demo readiness

- separate landing page;
- short accessible intro interaction;
- branded assets and avatars/product imagery;
- empty/loading/error states;
- demo script and documentation;
- final Chrome walkthrough for every role.

After each milestone, summarize files created or updated, tests run, known issues, and the exact next milestone. Pause for user confirmation before beginning the next milestone.

## Debugging and verification requirements

For every bug or feature:

1. Reproduce it.
2. Identify the source of truth and failing layer: UI, route, service, database, event bus, or data.
3. Make the smallest safe change that fixes the contract.
4. Add or update a regression check.
5. Verify the visible result in Chrome at `http://localhost:3000` using the demo accounts.
6. Confirm that the change did not violate stock, approval, idempotency, access-control, or read-only analytics rules.

At minimum, verify:

- `PRAGMA foreign_keys = ON`;
- `CHECK (reserved <= on_hand)`;
- M2 is the sole stock mutation path;
- duplicate order retries do not duplicate orders or reservations;
- stockout attempts create unmet-demand records;
- reject/cancel releases stock;
- hold keeps reservations;
- dispatch consumes reservations and deducts on-hand stock;
- restock happens only when marked restockable;
- role access matches the intended navigation;
- keyboard focus and reduced motion work;
- all primary actions show loading and completion/error feedback;
- no destructive test mutates the user’s shared demo database.

## Definition of done

Do not claim completion until:

- each role has a clear primary workflow;
- navigation works in Chrome for every permitted role;
- customer and product workflows are extensible rather than hard-coded;
- approval and cancellation use proper in-app dialogs;
- notifications are actionable and manageable;
- order confirmation produces a usable receipt;
- warehouse issues and feedback have traceable handling;
- manager visuals support investigation;
- admin has meaningful governance and health visibility;
- design is coherent, accessible, responsive, and consistent;
- tests and manual walkthroughs pass;
- documentation reflects the actual implementation;
- files changed, verification results, and remaining risks are reported.

Begin by performing Milestone 0 only. Do not implement changes until the baseline audit and proposed milestone plan are presented for approval.
