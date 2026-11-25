# Order Pulse: 5-Day Roadmap (Dec 1–5, 2026)
**Assumptions:** 3 people (Lead, Frontend/UX, Analytics/Data/Docs), ~6–8 focused hours per day each. Stack: Node.js + Express + SQLite + vanilla JS + Chart.js.
**Principle:** Days 1–3 build, Day 4 polishes, Day 5 submission. Dec 5 is the Google Sheet deadline — treat it as a safety day, not a building day.
---
## Roles
| Role | Focus | Owns |
|------|-------|------|
| **L (Lead + Full Stack)** | Backend core, stock engine, integration | Schema, API contract, stock and reservation engine, state machine, Chaos Button, final integration |
| **F (Frontend/UX)** | Interface | Order entry, approval and pick list screens, responsive layout, consistent design |
| **A (Analytics/Data/Docs)** | BA layer | Seed script, dashboard queries and charts, Decision Feed, Unmet Demand Log, README and documentation |
---
## Daily Blocks (Each role works their column each morning/afternoon)
### Day 1 (Dec 1): Foundation
| Block | L | F | A |
|-------|---|---|---|
| Morning | Repo and folder structure, DB schema, API contract in `docs/api.md`, Express skeleton | Design tokens (colors, fonts, spacing), page shell, nav per role, login page | Seed script v1: products, customers, users |
| Afternoon | Auth with 3 roles and role middleware, products and stock endpoints | Product and stock list screen, wired to API (or mock data until ready) | Extend seed to ~90 days of orders, returns, and stock movements |
**Done when:**
- Everyone can clone, install, run the seed, and log in as each role.
- The product list shows seeded stock.
- The API contract is agreed, so nobody is blocked.
**Git rule:** Feature branches, merge to main twice a day at fixed times, and nobody pushes broken code to main.
---
### Day 2 (Dec 2): Core Order Loop
| Block | L | F | A |
|-------|---|---|---|
| Morning | Atomic reservation (one conditional update in a transaction), create and submit order, idempotency key | Order entry form (mobile-first) with live availability display | Dashboard queries v1: daily orders, fast movers, low-stock list |
| Afternoon | Approval endpoints and order status machine; log every insufficient-stock rejection to the Unmet Demand table | Order list, order detail, approval screen for office staff | Dashboard page v1 with scorecards and first charts |
**Done when:** An agent submits an order, stock reserves correctly, the office approves it, and a rejected oversell attempt appears in the Unmet Demand log.
**Checkpoint (end of day):** If this loop isn't working, stop adding anything and fix it first. Everything else depends on it.
---
### Day 3 (Dec 3): Fulfillment + Analytics
| Block | L | F | A |
|-------|---|---|---|
| Morning | Pick list generation, dispatch recording, returns with reason codes, ledger entries for each | Pick list, dispatch, and returns screens (tablet-friendly) | Charts: sales trend, ABC/Pareto, days-of-stock-left |
| Afternoon | SSE stream for stock and alert updates, Chaos Button endpoint | Wire the SSE updates into the UI | Today's Actions feed (rule-based recommendations) and the lost-demand peso scorecard |
**Done when:** The full lifecycle (order → approve → pick → dispatch → return) runs end to end, and the dashboard shows real analytics from seed data.
**Feature freeze for Must-have and Should-have features at end of Day 3.**
---
### Day 4 (Dec 4): Wow Feature + Polish + Docs
| Block | L | F | A |
|-------|---|---|---|
| Morning | Chaos Button UI and results display; then Paste-to-Order (time-box to 3 hours) | Responsive pass on all screens (phone, tablet, desktop) | README, ER diagram, order state diagram, API list |
| Afternoon | Error handling (central middleware, friendly messages), input validation, retry safety | Empty states, loading states, error messages, consistency check | Screenshots, short user guide, demo data check |
| Evening | Full demo rehearsal #1 with a timer, then fix the list of issues it reveals | | |
**Done when:** The demo runs smoothly from login to dashboard to Chaos Button without surprises, and the docs exist.
**Hard feature freeze tonight.**
---
### Day 5 (Dec 5): Verify and Submit
| Time | Task |
|------|------|
| Morning | Bug bash: each member tests another member's part. Fix only real bugs. |
| Midday | Fresh-clone test on a different laptop: clone, npm install, seed, run. This is the check most teams skip. |
| Afternoon | Rehearsal #2 in formal attire, with a backup screen recording of the whole demo |