# Order Pulse — Design Direction

Status: baseline design brief for Milestone 4 implementation

## Source references

The supplied images are visual references only. Text, brand names, product claims, and UI labels visible inside them are not requirements and must not be copied into Order Pulse.

- `C:\Users\Raven\Downloads\reference 1.jpg` — dense dark SaaS dashboard hierarchy.
- `C:\Users\Raven\Downloads\reference 2.jpg` — dark green analytics workspace with strong operational density.
- `C:\Users\Raven\Downloads\reference 3.jpg` — emerald glass operations cockpit with calendar, score, tasks, and assistant panels.
- `C:\Users\Raven\Downloads\color pallete idea.jpg` — Brunswick Green, Emerald, Polar, and soft emerald gradients.
- `C:\Users\Raven\Downloads\logo.jpg` — Order Flow logo and flowing-line mark.
- `C:\Users\Raven\Downloads\Landing page reference.jpg` — long-form cinematic product landing composition.
- `C:\Users\Raven\Downloads\Landing page reference 2.jpg` — product-led hero with device imagery, metrics, and feature proof.
- `C:\Users\Raven\Downloads\Landing page reference 3.jpg` — dark nature-inspired hero, glass navigation, feature cards, and trust strip.

## Product personality

Order Pulse should feel like a calm, high-confidence operations room:

- precise enough for inventory and order decisions;
- energetic enough to make daily work feel active;
- premium without looking like a finance or crypto template;
- dense in information but generous in hierarchy;
- visually connected to beverage distribution through freshness, flow, and movement.

## Palette

Use semantic tokens, not raw colors scattered through components.

```css
:root {
  --canvas: #03130f;
  --canvas-deep: #02100c;
  --surface-1: #071d17;
  --surface-2: #0a281f;
  --surface-3: #0d3428;
  --surface-glass: rgba(9, 39, 30, .76);
  --emerald: #06d6a0;
  --emerald-hover: #25e4b3;
  --emerald-deep: #0c4137;
  --polar: #e6fbf6;
  --ink: #effcf8;
  --ink-muted: #b9d8cf;
  --ink-subtle: #82a79c;
  --ink-tertiary: #54766d;
  --hairline: rgba(168, 235, 218, .14);
  --hairline-strong: rgba(168, 235, 218, .28);
  --success: #06d6a0;
  --warning: #f2c46d;
  --danger: #f27f8b;
  --info: #8fc8ff;
}
```

Green must not be the only status signal. Pair state colors with labels, icons, and text. Ensure normal text maintains at least 4.5:1 contrast against its surface.

## Surface and component language

- Deep forest canvas with a restrained emerald glow.
- Layered charcoal/green surfaces for hierarchy.
- Hairline mint borders and occasional glass panels.
- Use blur only when it helps establish depth or modal context.
- Avoid excessive neon, noisy gradients, and decorative dashboard widgets.
- Use one consistent vector icon family; do not use emoji as structural icons.
- Use 8px spacing rhythm with dense dashboard gaps and larger section spacing.
- Use 8–16px radii for operational panels; reserve larger radii for hero cards and landing sections.

## Typography

- Display: a clean geometric or modern grotesk sans with strong weight contrast.
- Body: a highly readable sans with 15–16px default size and 1.5 line height.
- Data values: tabular numerals; use a mono face only for IDs, SKUs, and technical labels.
- Titles should emphasize the work context, not look like generic marketing headings.

## Application shell

- Desktop: persistent left navigation, sticky top bar, content canvas.
- Header label: `ORDER PULSE | [Current workspace]`.
- Top-right: global search where useful, notification bell with `+99` maximum, user avatar/menu.
- Mobile/tablet: accessible collapsed navigation; never rely on a tiny icon-only control.
- Active navigation state must remain visible on every page.
- Main content must prioritize one primary task and one primary CTA.

## Role page composition

### Sales Agent

Use a focused order desk with:

- customer search/create;
- product-picker window with product imagery and stock context;
- editable order cart;
- live availability and reorder warnings;
- recent orders;
- receipt confirmation panel after submit.

### Office

Use an approval triage layout with:

- prioritized queue;
- aging and value indicators;
- detail drawer for customer/order/stock context;
- in-app decision window for approve, hold, reject, and notes.

### Warehouse

Use a fulfillment station with:

- pick/pack/dispatch workflow board;
- high-visibility order and quantity data;
- returns and issue cases;
- inventory and fulfillment alerts that have a clear source and next action.

### Manager

Use a command center with:

- prioritized actions before historical charts;
- KPI strip;
- interactive sales and demand views;
- low-stock, approval-aging, fast-mover, and lost-demand drill-downs.

### Admin

Use a governance workspace with:

- users and roles;
- catalog and settings;
- audit history;
- system/event health;
- data-quality and activity summaries.

## Landing page direction

Use the supplied landing references for composition only:

- separate landing page from login;
- cinematic forest/emerald hero background;
- Order Flow logo placed with correct proportions and clear space;
- short, skippable intro animation with reduced-motion fallback;
- hero statement about moving orders from request to fulfillment;
- product UI preview rather than unrelated stock imagery;
- sections for how it works, role benefits, operational proof, and a clear `Get started` CTA;
- trust/metric content must be truthful to the actual system.

Do not copy the reference brands, fake testimonials, fake customer logos, or unsupported performance claims.

## Motion

- Use motion to explain route changes, panel expansion, notification arrival, and order confirmation.
- Prefer opacity and transform; avoid layout-shifting animations.
- Keep operational interactions around 150–300ms and confirmation motion short.
- Animate no more than one or two focal elements per view.
- Respect `prefers-reduced-motion` and render a stable final state.

## Relationship to DESIGN-linear.app.md

`DESIGN-linear.app.md` remains a useful reference for hierarchy, dark surfaces, hairline borders, typography discipline, and restrained UI composition. This emerald direction supersedes its lavender accent for Order Pulse only after the project team accepts this brief. Neither document overrides the system invariants in `AGENTS.md` or the user-facing workflow requirements.
