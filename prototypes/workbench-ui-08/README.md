# PROTOTYPE — Workbench visual semantics

This disposable prototype resolved `workbench-ui-08 — Choose visual semantics for status, provenance, diagnostics, and outcomes`. It changes the semantic presentation while keeping the accepted Scoped Evidence Workspace, Elastic Triad layout, Roving Instrument keyboard model, and single-event Local Injection flow fixed.

The accepted direction is **A — Plain Ledger**. The durable contract is [Workbench Visual Semantics](../../docs/WORKBENCH_VISUAL_SEMANTICS.md). B and C remain in the prototype only as reviewed rejection evidence.

Three radically different models are switchable with `?variant=`:

- **A — Plain Ledger (accepted):** explicit words, stable columns, property rows, and the lowest possible chroma.
- **B — Signal Rail (rejected):** a fixed positional gutter accelerates scanning of provenance, phase, COMMAND operation, lifecycle, diagnostics, and outcomes.
- **C — Evidence Blocks (rejected):** labelled boundaries and trace blocks group snapshot sequences and Local Injection evidence while preserving one chronological ledger.

Run:

```sh
npm run prototype:visual-semantics
```

Open:

- `http://127.0.0.1:4178/workbench-ui-08/?variant=A`
- `http://127.0.0.1:4178/workbench-ui-08/?variant=B`
- `http://127.0.0.1:4178/workbench-ui-08/?variant=C`

The prototype controls exercise mixed Evidence, degraded Capture, Frozen high volume, COMMAND projection comparison, raw Server evidence, empty Evidence, and ready/invalid/stale/delivered/failed Local Injection states at compact, normal, shallow, and wide geometries in Dark and Light themes. `presentation=1` hides prototype controls for screenshots.

The [semantic inventory](SEMANTIC-INVENTORY.md) is shared by every variant. The [comparison](COMPARISON.md) records the final decision and rejected trade-offs after live review.

This prototype is read-only and contains no production panel behavior. The product owner requested direct work on `main`; the prototype is isolated by directory and will not be treated as implementation code.
