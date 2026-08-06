# PROTOTYPE — Surgical JSON console migration

This disposable prototype asks: **can Ordered Evidence migrate from today’s six-column ledger to a normalized JSON console without changing any surrounding Workbench workflow, surface, control placement, or Context content?**

The earlier broad exploration changed too many variables. This revision deliberately uses only two variants and shares the complete shell. The sole product-surface branch is `renderLedger()` in `prototype.js`:

- **A — Today’s ledger:** `Time / #`, `Source`, `Phase`, `Op`, `Evidence / object`, and `COMMAND key`.
- **B — Surgical JSON console:** absolute line/order plus one complete normalized Workbench evidence JSON object per row.

Everything outside the ledger is held constant: Capture/Coverage/View, Find, Filter, Theme, More actions, Scope strip, Scope pane, retained-Evidence window controls, pane geometry, Context metadata, selected Item Update fields, Context actions, and Live/Frozen status.

Critically, Variant B does **not** add a duplicate normalized envelope to Context. The JSON line is the complete textual Evidence; Context keeps today’s semantic metadata, selected fields, diagnostics/actions, and `Open complete raw` route.

Run:

```sh
npm run prototype:json-console
```

Open:

- `http://127.0.0.1:4180/workbench-ui-11/?variant=A&frame=wide&theme=dark`
- `http://127.0.0.1:4180/workbench-ui-11/?variant=B&frame=wide&theme=dark`

The floating arrows switch variants. The external prototype strip switches only the test frame; Workbench’s existing Theme control remains in its current operating-strip position. URL parameters preserve variant, frame, theme, selection, Find, Filter, and compact surface.

Review [COMPARISON.md](./COMPARISON.md) for the intended delta/non-goal contract, [REVIEW.md](./REVIEW.md) for browser evidence, and [TICKET.md](./TICKET.md) for the production acceptance contract filed in Project #2.

This is read-only, in-memory prototype code. It does not instrument a page, change Capture, contact Lightstreamer Server, or define production architecture.
