# Order-Flow
Web-based inventory and sales order management system uniting sales, office, and warehouse teams to replace fragmented texts, emails, and spreadsheets. Features real-time stock, order approvals, pick lists, dispatches, returns, and a dashboard for daily orders, fast-moving items, and low-stock alerts to improve fulfillment.

## Project structure

`Order-Flow/`
├─ package.json / package-lock.json
├─ .env.example
├─ README.md
├─ AGENTS.md / DESIGN-linear.app.md
├─ schema.sql                         # canonical SQLite schema and M7 read-only views
├─ public/
│  ├─ index.html                      # shared SPA shell: landing, sign-in, and workspace
│  ├─ css/app.css                     # shared design system and responsive styling
│  ├─ js/app.js                       # role-based views, navigation, and API client
│  └─ assets/                         # logos and other static assets
├─ data/                              # local SQLite database (generated/ignored)
│
├─ docs/
│  ├─ api.md                           # API contract
│  ├─ erd.md                           # schema documentation
│  ├─ diagrams/order-flow-flowchart.md # canonical order flow
│  ├─ demo-script.md
│  ├─ rubrics.md                      # IT 314 rubric readiness review
│  ├─ MASTER-IMPLEMENTATION-PROMPT.md
│  └─ ORDER-PULSE-DESIGN-DIRECTION.md
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
│     ├─ intake-bridge/routes.js        # M6 stretch stubs
│     └─ analytics-alerts/{routes.js,service.js}  # M7 read-only analytics and SSE
│
└─ scripts/
   ├─ seed.js                           # schema initialization and demo data
   ├─ smoke-milestone2.js               # M1–M2 end-to-end verification
   └─ smoke-milestone3.js               # M3 analytics and SSE verification

All seven module paths are now implemented and mounted. M7 performs read-only
SQLite queries and forwards internal event-bus updates through the authenticated
SSE endpoints; it does not write stock or bypass M2.

The browser app intentionally uses one shared HTML shell: role-specific screens
are rendered by the client based on the signed-in user's permissions, keeping
authentication, navigation, and shared UI state consistent across roles.

## Demo accounts

These accounts are created by `npm run seed` and are also available through the
login screen’s demo-account shortcuts:

| Role | Username | Password |
|---|---|---|
| Agent | `agent1` | `agent1234` |
| Agent | `agent2` | `agent1234` |
| Office | `office1` | `office1234` |
| Warehouse | `warehouse1` | `warehouse1234` |
| Manager | `manager1` | `manager1234` |
| Admin | `admin1` | `admin1234` |

Run `npm run seed` only when you intentionally want to recreate the demo
database; it resets the configured SQLite database before inserting the sample
accounts and historical data.

## Local checks

- `npm run check` — JavaScript syntax checks for the server, client, and seed script.
- `npm run smoke:m2` — order, approval, fulfillment, return, and stockout workflow.
- `npm run smoke:m3` — analytics, alerts, SSE, and static frontend routes.

**Database Schema**

**Canonical order flow:** [docs/diagrams/order-flow-flowchart.md](docs/diagrams/order-flow-flowchart.md)

**Express skeleton**
