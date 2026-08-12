# PROTOTYPE — coherent Event History query seam

This disposable prototype compares three external interfaces for contextual,
faceted Evidence queries. It does not change production code or storage.

Run from the prototype branch worktree:

```sh
npx vite prototypes --host 127.0.0.1 --port 4181
```

Open `http://127.0.0.1:4181/evidence-filter-05/?variant=A` and use the floating
switcher to compare all designs. The guided `Capture advances between calls`
scenario deliberately exposes torn results in the task-oriented alternative.

The decision under test is whether one storage-neutral query must own the page,
exact totals, contextual facet discovery, selected-Evidence lookup, and one
committed Evidence boundary.

Build 7 subsequently tightened the chosen seam: active Find navigation is an
optional result section on the same snapshot, while Find remains independent
from Filter and totals. See the integrated validation amendment in
`INTERFACES.md` and the executable `evidence-filter-07` proof.

This is read-only, deterministic prototype code. It neither captures nor clears
Evidence and it never contacts the inspected page or Lightstreamer Server.
