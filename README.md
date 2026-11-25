# Order-Flow
Web-based inventory and sales order management system uniting sales, office, and warehouse teams to replace fragmented texts, emails, and spreadsheets. Features real-time stock, order approvals, pick lists, dispatches, returns, and a dashboard for daily orders, fast-moving items, and low-stock alerts to improve fulfillment.

**FOLDER STRUCTURE** # DAY 1 - #RAVEN
order-pulse/
├─ package.json
├─ .env.example                      # PORT, DB_PATH, JWT/session secret
├─ README.md                         # setup, test accounts, how to seed
│
├─ docs/
│  ├─ sdlc/                          # planning, requirements, business rules, module list
│  ├─ diagrams/                      # flowchart export, context/DFD, ERD, state diagrams
│  ├─ erd.md                         # (Task 2)
│  ├─ api.md                         # (Task 3)
│  └─ demo-script.md
│
├─ server/
│  ├─ server.js                      # starts the HTTP server
│  ├─ app.js                         # builds the Express app, mounts module routers
│  │
│  ├─ config/
│  │  ├─ env.js
│  │  └─ constants.js                # order-value threshold, roles, status names, hold-aging hours
│  │
│  ├─ db/
│  │  ├─ connection.js               # SQLite connection + transaction helper
│  │  ├─ migrations/                 # (Task 2)
│  │  └─ seeds/                      # beverage catalog + ~90 days of sales/returns
│  │
│  ├─ shared/
│  │  ├─ middleware/
│  │  │  ├─ authenticate.js
│  │  │  ├─ require-role.js
│  │  │  ├─ idempotency.js           # reads the idempotency key on order submit
│  │  │  ├─ validate.js
│  │  │  ├─ not-found.js
│  │  │  └─ error-handler.js
│  │  ├─ errors/
│  │  │  ├─ app-error.js
│  │  │  └─ error-codes.js           # e.g. INSUFFICIENT_STOCK, INVALID_TRANSITION
│  │  ├─ events/
│  │  │  ├─ event-bus.js             # small internal emitter (feeds alerts/SSE)
│  │  │  └─ event-names.js
│  │  └─ utils/
│  │
│  └─ modules/
│     ├─ access-admin/               # M1
│     │  ├─ auth/
│     │  ├─ users/
│     │  ├─ audit/                   # "who / when / what" log, used by every module
│     │  └─ tools/                   # Chaos Button, seed trigger, admin-only
│     ├─ product-inventory/          # M2
│     │  ├─ products/
│     │  └─ stock/                   # sole writer of on_hand / reserved + movement history
│     ├─ order-management/           # M3
│     │  ├─ orders/                  # submit, reservation call, status, cancel
│     │  ├─ customers/
│     │  └─ unmet-demand/            # write side of the "Log unmet demand" step
│     ├─ approval-exceptions/        # M4
│     │  ├─ policy/                  # high-value and below-reorder rules
│     │  └─ queue/                   # approve / reject / hold, aging approvals
│     ├─ fulfillment/                # M5
│     │  ├─ pick-lists/
│     │  ├─ dispatch/
│     │  └─ returns/                 # reason codes, restockable or not
│     ├─ intake-bridge/              # M6 (STRETCH, safe to delete)
│     │  └─ parser/
│     └─ analytics-alerts/           # M7
│        ├─ kpis/
│        ├─ abc/
│        ├─ days-of-stock/
│        ├─ unmet-demand-report/
│        ├─ actions-feed/            # "Today's Actions"
│        └─ alerts/                  # low-stock, stuck approvals, SSE stream
│
├─ client/
│  ├─ index.html                     # login
│  ├─ assets/css/                    # tokens.css, layout.css, components.css
│  ├─ js/
│  │  ├─ api/                        # fetch wrapper, one file per module
│  │  ├─ components/                 # table, scorecard, chart wrappers, toast
│  │  ├─ sse.js
│  │  └─ session.js
│  └─ pages/                         # one folder per swimlane/role
│     ├─ agent/                      # order entry, my orders
│     ├─ office/                     # approvals, intake (stretch)
│     ├─ warehouse/                  # pick lists, dispatch, returns
│     ├─ manager/                    # dashboard, Today's Actions
│     └─ admin/                      # users, products, audit, Chaos Button
│
├─ scripts/
│  ├─ seed.js
│  └─ chaos.js                       # CLI version of the concurrency test
│
└─ tests/
   ├─ reservation.concurrency.test.js
   ├─ approval-policy.test.js
   └─ order-lifecycle.test.js

**Database Schema**

**Canonical order flow:** [docs/diagrams/order-flow-flowchart.md](docs/diagrams/order-flow-flowchart.md)

**Express skeleton**
