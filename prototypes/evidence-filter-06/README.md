# PROTOTYPE — contextual Evidence filter authoring

This disposable UI prototype compares three materially different constructors
inside the accepted Scoped Evidence Workspace:

- **A — Inline composer:** author below the Ordered Evidence header; open a
  bounded, searchable exact-value explorer only when choosing a value.
- **B — Context lens:** temporarily use Context for structured authoring while
  Ordered Evidence stays visible.
- **C — Filter worksheet:** open a bounded transient document for the whole
  draft and return to the exact investigation after Apply or Cancel.

All variants retain Find as navigation among matches. Free text in Filter changes
the matching Evidence set; it does not replace Find. Active criteria, exact
`shown · matching · in Scope` counts, and one-step Reset remain visible without a
permanent chip bar.

Run from the prototype branch worktree:

```sh
npx vite prototypes --host 127.0.0.1 --port 4181
```

Open `http://127.0.0.1:4181/evidence-filter-06/?variant=A&frame=normal&theme=dark`.
Use the external controls for variant, geometry, theme, and deterministic state.

The prototype is decision evidence for a future Material UI change, not a
production implementation or accepted visual baseline.

For executable state semantics, use `evidence-filter-07`. Its integrated proof
supersedes this comparison mock while preserving the selected inline composer
and bounded value explorer.
