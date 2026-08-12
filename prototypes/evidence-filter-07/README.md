# PROTOTYPE — integrated contextual Evidence filtering

Status: disposable Wayfinder validation evidence for `evidence-filter-07`; no
production extension code, storage schema, or accepted visual baseline changes.

## Decision under test

Can the selected Build 5 atomic Event History query and the selected Build 6
inline Filter composer operate as one truthful investigation across realistic
volume, lifecycle, storage, focus, and layout conditions?

This prototype answers with one executable model rather than another static
mock:

- 10,000 deterministic accepted Evidence records;
- exactly 3,842 collision-safe typed COMMAND key values;
- all twelve accepted facets, including intentionally absent values;
- one atomic snapshot containing the bounded page, exact totals, requested
  counterfactual discovery, selected-Evidence lookup, and optional Find result;
- interchangeable memory and browser IndexedDB adapters;
- bounded reverse-page, typed posting, exact discovery, and residual query
  plans; and
- the selected inline composer plus bounded exact-value explorer.

## Run

From the prototype branch worktree:

```sh
/Users/vinothshanmugam/code/lightstreamer-workbench-extension/node_modules/.bin/vite prototypes --host 127.0.0.1 --port 4181
```

Open:

```text
http://127.0.0.1:4181/evidence-filter-07/
```

The external controls select four canonical geometries, Dark/Light, fourteen
deterministic investigation states, and three guided walkthroughs.

Run the complete repeatable review:

```sh
node prototypes/evidence-filter-07/verify.mjs
```

The script writes `review/verification.json` and the screenshot matrix. It
checks semantic transitions, memory/IndexedDB parity, p95 budgets, accessible
focus restoration, all geometry/theme combinations, forced colors, axe, and
browser errors.

## Important boundary

This is implementation-risk evidence, not the implementation. Its adapters and
UI are intentionally disposable and do not replace the maintained production
Event History, WorkbenchRuntime, panel fixtures, or the Material UI gate in
`docs/WORKBENCH_UI_STANDARD.md`.

Build 7 did tighten two upstream artifacts. Build 5 now places active Find
navigation in an optional section of the same snapshot without merging Find
into Filter. Build 6's static comparison scripts are superseded as a semantic
oracle by this integrated prototype; the selected inline UI direction remains
unchanged.

See `REVIEW.md` for the decision record and measured evidence.
