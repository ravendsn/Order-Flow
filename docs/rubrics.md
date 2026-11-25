# Order Pulse: Rubric Coverage Map (BA Track)
**Purpose:** Shows every rubric criterion and exactly how Order Pulse earns those points. Used for defense and to ensure nothing is missed.
---
## Rubric Criteria & Order Pulse Alignment
| Rubric Item | Max Points | How Order Pulse Earns It | Evidence / Feature |
|-------------|------------|--------------------------|-------------------|
| **1. Front-end (8 pts)** | 8 | Role-based screens: order entry, approvals, pick list, dashboard | Screens for AGENT (order entry), OFFICE (approvals), WAREHOUSE (pick list/dispatch), MANAGER (dashboard). Responsive layout passes phone/tablet/desktop. |
| **2. Back-end (8 pts)** | 8 | Express modules, state machine, atomic reservations | 7 module routers (access-admin, product-inventory, order-management, approval-exceptions, fulfillment, intake-bridge, analytics-alerts). State machine: DRAFT → SUBMITTED → (PENDING_APPROVAL | APPROVED) → PICKING → FULFILLED, with legal transitions enforced in code. Atomic reservation via one conditional SQL update in a transaction. |
| **3. Data/API (6 pts)** | 6 | REST API with documented contracts, plus SSE stream and CSV import/export | Full API contract in `docs/api.md` (25+ endpoints). SSE stream at `/sse/updates` for stock alerts and Today's Actions. CSV import/export via the Intake Bridge (PASTE-to-Order). |
| **4. Features Work (5 pts)** | 5 | Run an end-to-end scenario: agent order → approval → pick → dispatch → return | Full lifecycle tested: agent submits order → office approves → warehouse picks & dispatches → return recorded. One-click end-to-end test script included. |
| **5. Error Handling (3 pts)** | 3 | Central error middleware, validation, friendly "insufficient stock" and retry messages | Error handler middleware (`middleware/error-handler.js`) returns consistent `{error, code, path, timestamp}` format. Friendly messages include available qty. Idempotency key prevents duplicate orders on retry. |
| **6. Responsive (5 pts)** | 5 | Mobile-first agent screens, tablet for warehouse, desktop for dashboard | Agent order entry designed mobile-first. Pick list and dispatch screens tablet-friendly. Dashboard works desktop-width. All CSS uses CSS vars (`var(--foreground)`, etc.) for auto theming. |
| **7. Creativity (15 pts)** | 15 | The three signature features, plus modern web tech (SSE, PWA-installable) | **Signature 1:** Oversell-proof reservations + Chaos Button (admin tool simulating 20 concurrent agents). **Signature 2:** Exception-first BA dashboard (Today's Actions, unmet demand peso value). **Signature 3:** Paste-to-Order bridge (regex + fuzzy product matching). PWA manifest included for installability. |
| **8. Track Relevance: BA (15 pts)** | 15 | BA metrics: days-of-stock-left, ABC analysis, channel adoption, return reasons | `GET /kpis/days-of-stock-left/:sku`. `GET /kpis/abc-analysis` (A/B/C Pareto by revenue). `GET /kpis/today-actions` (prescriptive rule-based feed). `GET /kpis/unmet-demand-summary` (lost demand quantified). Channel adoption % tracked on dashboard. |
| **9. Tech Implementation (10 pts)** | 10 | Clean module structure, README and API docs, consistent code style | 7 consolidated modules with clear boundaries (`M1` gates everything → `M2` supplies availability → `M3` feeds `M4` → `M5` updates `M2`). `docs/api.md`, `docs/erd.md`, `roadmap.md` all present. Lint-friendly JS (no transpilation needed). |
| **10. Presentation (10 pts)** | 10 | Scripted demo where every member owns a section, plus the Chaos Button finale | 10-minute demo script (`roadmap.md` §5) with timed segments: Member 3 (problem, 2 min), Member 2 (live walkthrough, 3 min), Lead (Chaos Button + Paste-to-Order, 2.5 min), Member 3 (dashboard + recommendations, 2.5 min), Lead (process + what was left out, 1 min). All 3 members participate and can explain their section. |
| **TOTAL** | **85 pts** | | |
---
## Point-Earning Summary
| Category | Points | How It's Achieved |
|----------|--------|-------------------|
| Front-end | 8 / 8 | All role screens built, responsive, design tokens |
| Back-end | 8 / 8 | 7 modules, Express routers, state machine, atomic reservations |
| Data/API | 6 / 6 | Full API contract, SSE, CSV import |
| Features Work | 5 / 5 | E2E order lifecycle functional |
| Error Handling | 3 / 3 | Central middleware, idempotency, friendly messages |
| Responsive | 5 / 5 | Mobile-first, tablet, desktop |
| Creativity | 15 / 15 | 3 signature features + PWA |
| Track Relevance (BA) | 15 / 15 | KPIs, ABC, days-of-stock, unmet demand, channel adoption |
| Tech Implementation | 10 / 10 | Module structure, docs, consistent code |
| Presentation | 10 / 10 | Scripted demo, Chaos Button finale, all members participate |
| **TOTAL** | **85 / 85** | **Perfect score if everything built as designed** |
---
## Critical Path — What You Cannot Cut Without Losing Points
| If Cut | Points Lost | Why It Matters |
|--------|-------------|----------------|
| Paste-to-Order (M6) | ~3 pts (creativity + track relevance) | Loses the "system integration" story; can't show how legacy SMS/email/spreadsheets transition |
| SSE stream / real-time updates | ~4 pts (tech implementation + creativity) | Dashboard becomes static; loses modern web tech demonstration |
| Unmet Demand Log + peso value | ~6 pts (track relevance: BA) | BA identity weakened; can't quantify "lost sales" — a core BA metric |
| ABC/Pareto analysis | ~4 pts (track relevance: BA) | Less recognizable BA concept on dashboard |
| Chaos Button (concurrent reservation test) | ~5 pts (functionality + creativity) | No proof of anti-oversell; weakest defense in Q&A |
| Today's Actions prescriptive feed | ~4 pts (track relevance: BA) | Loses the "decision intelligence" aspect that defines BA track |
| **Total maximum loss if ALL cut** | **~26 pts** | Drops from 85 → ~59; still passing but misses top scores |
---
## Maximum-Payoff Features (Do These First)
If time runs short, prioritize in this order:
1. **Atomic reservation + Chaos Button** (5 + 5 pts = 10 pts) — Proves no oversell; easiest technical defense
2. **Unmet Demand Log + peso summary** (6 pts) — One extra table, one query; gives BA identity immediately
3. **Today's Actions feed** (4 pts) — Rule-based recommendations; cheap formulas, looks smart
4. **ABC/Pareto chart** (4 pts) — Recognizable BA concept; easy to compute from seed data
5. **Paste-to-Order bridge** (3 + 3 pts = 6 pts) — System integration story; regex parser + human confirmation
6. **SSE stream** (3 + 4 pts = 7 pts) — Real-time updates; a few lines of code, modern web tech
---
## Rubric Defense Script (1-Minute Summary)
> "Order Pulse earns its 85/85 rubric points through a structured SDLC: planning, analysis, design, implementation, and testing across 7 consolidated modules. The BA track identity comes from the analytics layer — days-of-stock-left, ABC analysis, unmet demand in peso value, and a prescriptive 'Today's Actions' feed. Functionality is demonstrated through the full order lifecycle (agent order → approval → pick → dispatch → return) and the Chaos Button, which proves atomic stock reservation holds under concurrent load. Error handling is centralized with idempotency keys preventing duplicate orders. The responsive design works across phone, tablet, and desktop. Presentation is a 10-minute scripted demo where each of the three team members owns a section, culminating in the Chaos Button finale that visually proves the anti-oversell design."
---
*Rubric Coverage Map for Order Pulse — BA Track, 5-day build window (Dec 1–5, 2026)*