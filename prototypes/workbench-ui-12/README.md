# PROTOTYPE — Scope and Ordered Evidence readability

Disposable comparison for the proposed Scope-tree and Ordered-Evidence row readability improvement. This is decision evidence only: it is not extension code and must not be promoted directly into production.

Status: **Variant C approved on 2026-08-29**. The production change is classified as **Material UI** and must pass the repository's visual-verification gates during implementation.

Run:

```sh
npm run prototype:scope-evidence-readability
```

Open:

- `http://127.0.0.1:4181/?variant=A&frame=normal`
- `http://127.0.0.1:4181/?variant=B&frame=normal`
- `http://127.0.0.1:4181/?variant=C&frame=normal`

Use the fixed switcher, or Left/Right arrow keys, to compare variants. Change **Frame** to Compact to pressure-test the narrow-pane behavior that motivated this work.

All content is deterministic synthetic data. Controls only change in-memory prototype state.

## Decision question

Decision: Variant C for both Scope and Ordered Evidence. See [DECISION.md](./DECISION.md).

### A — Targeted two-line fix

- Scope: only the selected `Inspected page` row gets an identity line and a secondary facts line; children keep today's density.
- Evidence: timestamp and event ID share a deliberately aligned two-line cell.
- Tradeoff: smallest production delta and highest density, while long child identities can still truncate.

### B — Root summary + split order/time

- Scope: `Inspected page` becomes the fixed pane header, with counts underneath and a dense child tree below.
- Evidence: event sequence and clock time become separate columns.
- Tradeoff: keeps child rows dense, but introduces another structural region and consumes horizontal width.

### C — Priority blocks + order rail

- Scope: object type, identity, facts, and status get explicit priority within compact blocks.
- Evidence: event sequence becomes an order rail while semantic evidence leads; timestamp moves to a quiet second line.
- Tradeoff: strongest scanning at narrow widths, but the largest departure from today's ledger.
