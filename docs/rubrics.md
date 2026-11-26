# IT 314 Final Project Rubric Readiness

This is an evidence-based readiness review against the 100-point rubric supplied
for the final project. It is not an instructor score; usability, originality,
and presentation points depend on evaluation and the live demonstration.

## Summary

**Implementation outlook: likely to meet the core pass requirements, subject to
the live demo.** The order lifecycle, analytics endpoints, role-based interface,
and responsive layout have working evidence. The presentation category cannot
be verified from the repository. M6 is explicitly a stretch and is not a
completed paste-to-order workflow.

## Rubric coverage

| Category | Weight | Readiness | Evidence and remaining work |
|---|---:|---|---|
| Website functionality | 30 | Strong | Role-based screens and a shared client shell are in `../public/`. Express APIs are split into modules under `../server/modules/`. The isolated M2 smoke test covers login, idempotent order submission, approval, pick/pack/dispatch, return/restock, cancellation, and stockout replay. The M3 smoke test covers analytics, alerts, actions, and SSE. M6 is still a stub. |
| Design, usability, responsiveness | 20 | Good; validate in demo | The interface uses a consistent dark operational design and responsive CSS in `../public/css/app.css`. The workspace now has an in-app Back control and the prior UI pass checked desktop and 390px mobile layouts. Deep links and browser-native history are not implemented; demonstrate the in-app navigation path. |
| Creativity and innovation | 15 | Good | The system connects sales, office, and warehouse workflows and provides live stock, alerts, and decision-support analytics. SSE is implemented. Do not claim the unimplemented Chaos Button, PWA installability, or complete M6 intake as delivered features. |
| Academic-track relevance | 15 | Strong | Analytics includes revenue and sales trends, ABC/Pareto, days of stock, unmet demand, returns by reason, alerts, and ranked actions. These support business-analysis decisions using the distribution workflow. |
| Technical implementation | 10 | Good | The stack is HTML/CSS/JavaScript, Node/Express, and SQLite. The repository has separate `public/`, `server/`, `scripts/`, `data/`, and `docs/` areas. API and schema documentation are present. The client application logic remains a single file, and M6 remains a stretch stub. |
| Presentation and demo | 10 | Not verifiable from code | `demo-script.md` provides a walkthrough, but the repository cannot establish the quality of the explanation, live demo, participation of all members, professionalism, or Q&A. Rehearse the full order lifecycle and analytics walkthrough. |

## Verification run

The implementation was checked with:

- `npm run check` — server, client, and seed-script JavaScript syntax.
- `npm run smoke:m2` — passed against an isolated, seeded SQLite database.
- `npm run smoke:m3` — passed against an isolated, seeded SQLite database,
  including the relocated static HTML, CSS, JavaScript, and logo asset routes.

The smoke tests are supporting evidence, not proof that every UI interaction or
rubric judgment will receive full points. Run the demo with the seeded accounts
and explain the M6 scope honestly.
