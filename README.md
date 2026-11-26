# Order-Flow
Web-based inventory and sales order management system uniting sales, office, and warehouse teams to replace fragmented texts, emails, and spreadsheets. Features real-time stock, order approvals, pick lists, dispatches, returns, and a dashboard for daily orders, fast-moving items, and low-stock alerts to improve fulfillment.

**FOLDER STRUCTURE — CURRENT IMPLEMENTATION**

`Order-Flow/`
├─ package.json / package-lock.json
├─ .env.example
├─ README.md
├─ schema.sql                         # canonical SQLite schema and M7 read-only views
├─ index.html / javascript.js / Style.css  # existing root UI scaffold
│
├─ docs/
│  ├─ api.md                           # API contract
│  ├─ erd.md                           # schema documentation
│  ├─ diagrams/order-flow-flowchart.md # canonical order flow
│  ├─ demo-script.md
│  └─ rubrics.md
│
├─ server/
│  ├─ server.js                        # starts the HTTP server
│  ├─ app.js                           # Express app and /api mount
│  ├─ routes.js                         # mounts implemented module routers
│  ├─ config/{env.js,constants.js}
│  ├─ db/connection.js                  # SQLite connection and transactions
│  ├─ shared/
│  │  ├─ audit/service.js
│  │  ├─ events/{event-bus.js,event-names.js}
│  │  ├─ errors/{app-error.js,error-codes.js}
│  │  ├─ middleware/                    # auth, roles, validation, idempotency, errors
│  │  ├─ http.js
│  │  ├─ idempotency-store.js
│  │  └─ utils/password.js
│  └─ modules/
│     ├─ access-admin/routes.js         # M1
│     ├─ product-inventory/routes.js    # M2; stock/service.js is the stock writer
│     ├─ order-management/{routes.js,service.js}  # M3
│     ├─ approval-exceptions/routes.js  # M4
│     ├─ fulfillment/routes.js          # M5
│     └─ intake-bridge/routes.js        # M6 stretch stubs
│
└─ scripts/
   ├─ seed.js                           # schema initialization and demo data
   └─ smoke-milestone2.js               # M1–M2 end-to-end verification

The seven-module design remains the target architecture. The first six modules
are implemented and mounted. `analytics-alerts` is intentionally not present or
mounted yet; it is reserved for Milestone 3 and will be added without changing
the completed M1–M2 module paths.

**Database Schema**

**Canonical order flow:** [docs/diagrams/order-flow-flowchart.md](docs/diagrams/order-flow-flowchart.md)

**Express skeleton**
