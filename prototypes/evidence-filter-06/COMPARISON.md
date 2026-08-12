# Contextual filter authoring comparison

Status: disposable design evidence for `evidence-filter-06`; not an accepted
production UI contract.

## Fixed product boundary

- Filter changes the visible matching Evidence set. Its free-text criterion is
  ANDed with structured criteria.
- Find remains separate and moves among matches without changing the set.
- Regular facets use the accepted twelve-facet catalog. Includes within one
  facet OR together; facets AND; exclusions subtract. Around Evidence is a
  separate interval criterion.
- Active criteria, exact `shown · matching · in Scope` counts, and one-step
  Reset stay visible.
- Row and Context actions are accelerators. A labelled Filter constructor is
  always reachable without a menu, right-click, hover, or memorized syntax.
- The UI sends typed, atomic mutation commands to WorkbenchRuntime. It never
  constructs index tokens or owns a facet catalog.

## A — inline composer with bounded value explorer

The labelled Filter control expands a compact authoring region directly below
the Ordered Evidence header. Free text is an ordinary input. Structured
criteria are readable sentences grouped by facet. `Add criterion` opens an
inline facet step, then `Choose values` opens a bounded exact-value explorer
with search, stable paging, Include/Exclude polarity, counts, and explicit
Apply/Cancel.

**Strengths**

- Maintains direct spatial cause and effect: author above the Evidence that
  changes.
- Free text and structured authoring are equally discoverable.
- Works in compact geometry without requiring a new semantic surface.
- A value explorer absorbs high-cardinality search/paging and temporary draft
  state without creating a permanent chip bar.
- Escape closes only the top transient and restores the exact trigger.

**Costs**

- Open authoring consumes vertical Evidence space, most noticeably at
  `563×700` and `900×320`.
- Criteria sentences must stay compact and use one content-scroll owner.

## B — Context filter lens

Filter temporarily changes Context from selected-Evidence explanation to a
structured Filter lens. Ordered Evidence remains unobscured in normal, shallow,
and wide geometry. Compact geometry deliberately navigates to a Filter surface
and returns to Evidence.

**Strengths**

- Excellent room for facets, counts, explanations, and high-cardinality values.
- Ledger height stays stable while authoring.
- The selected row remains visible in wide/normal layouts.

**Costs**

- Temporarily displaces the accepted responsibility of Context and hides the
  selected-Evidence explanation that often motivates the filter.
- Compact users lose simultaneous Evidence visibility and need a surface return.
- Filter is an operation on Ordered Evidence, so locating the constructor in
  Context weakens ownership and increases restoration state.

## C — transient Filter worksheet

The labelled Filter control opens a bounded, Filter-scoped worksheet over the
workspace. The complete draft, facet browser, and exact preview counts share
one temporary document. Apply atomically returns to the exact investigation;
Cancel changes nothing.

**Strengths**

- Most room for complex filters and large facet vocabularies.
- Clear draft/applied boundary and straightforward staged editing.
- One place can explain zero, conflict, and discovery-unavailable states.

**Costs**

- Obscures the Evidence being filtered and feels heavy for one-click inclusion.
- Requires the largest focus trap/restoration contract.
- Risks becoming a general command/query surface, which the accepted Roving
  Instrument model explicitly rejects. It must remain Filter-scoped with no
  global shortcut or command registry.

## Comparison

| Force | A — inline | B — Context lens | C — worksheet |
| --- | --- | --- | --- |
| Cause/effect visible | Strong | Strong except compact | Weak while open |
| Preserves Context | Yes | No while authoring | Visually obscured |
| Compact fit | Good, less ledger height | Requires surface switch | Full overlay |
| High-cardinality values | Bounded explorer | Native pane space | Native document space |
| One-click row action | Natural | Natural, then lens | Natural, worksheet optional |
| Focus restoration burden | Small | Medium | Large |
| Risk of permanent new surface | Low | Medium | High |

## Recommendation

Choose **A — inline composer with bounded value explorer**.

Keep the applied summary collapsed by default and the authoring region open
only on demand. This satisfies the visible constructor requirement without a
query language, preserves Context, fits compact geometry, and gives exact
high-cardinality discovery a purpose-built transient. Row/Context actions apply
one atomic mutation immediately; `Edit Filter` and `Add criterion` provide the
non-menu path to the same capabilities.

## Interaction contract

### Applied summary

The Ordered Evidence header shows one textual summary, not a chip bar:

```text
Filter · text contains “order”; Mode includes COMMAND; Provenance excludes LOCAL
60 shown · 243 matching · 8,410 in Scope                       Edit · Reset
```

Long values truncate only in the summary; their exact typed value and origin
remain available in the composer. A zero-result Filter still shows its active
criteria and `0 shown · 0 matching · N in Scope` with Reset.

### Free text

The authoring region begins with `Evidence contains` and an ordinary text
input. It produces the one free-text Filter criterion. Find retains its own
input, match count, Previous/Next, and current-hit state. Neither control copies
or silently converts the other's text.

### Structured criteria

`Add criterion` reveals a labelled facet chooser in document flow rather than
a menu. After a facet is chosen, `Choose values` opens the bounded explorer.
Each exact value row exposes mutually exclusive `Include`, `Exclude`, and
neutral state with its exact counterfactual Evidence count.

The explorer searches facet value labels, not Evidence. It shows the exact
distinct total and stable range, for example `1–50 of 3,842 values`, with
Previous/Next paging. Active zero values stay pinned above discovered values.
No values, unavailable discovery, and base-zero are distinct messages.

Apply submits one typed mutation batch with the expected investigation
revision. Invalid, stale-revision, or evaluation failure leaves the prior
Filter unchanged and keeps the draft available with a direct recovery message.

### Click-to-filter actions

The selected row exposes labelled accelerators for the most relevant typed
origins: `Include this item`, `Exclude this COMMAND key`, and `Around this
Evidence`. Context exposes the same actions beside the exact value. Every
action identifies the facet/value and resulting polarity before execution.
Around replaces only the prior Around criterion using the accepted ±5-second
timestamp interval.

Actions apply immediately, recompute exact counts, preserve selection/Context,
and move focus to the nearest matching row if the selected Evidence becomes
hidden. The hidden-selection condition keeps `Reveal selected Evidence` and
`Clear selection`; Reveal removes only exact blockers returned by the query
lookup.

### Pointer, accessible traversal, and focus

- The feature adds no dedicated keyboard shortcut scheme. Native Tab/Shift+Tab
  traversal reaches labelled value and polarity buttons.
- Escape closes the value explorer first, then the add-criterion step, then the
  composer. Each close restores the exact trigger. Unowned Escape reaches
  Chrome DevTools.
- Apply restores the Filter trigger; Cancel restores the trigger without
  changing Filter. Passive Capture moves neither focus nor selection.
- Pointer and native button activation invoke the same typed mutation command.

### Geometry

- **563×700 compact:** one Evidence surface; composer uses a bounded internal
  block and value explorer fills the workspace below the operating strip.
- **900×700 normal:** Evidence above Context; composer stays with Evidence.
- **900×320 shallow:** Context parks to the side; composer limits itself to one
  content scroll and the explorer overlays only the workspace.
- **1440×900 wide:** Scope, Evidence, and Context remain visible; the explorer
  is anchored to Evidence and never covers the global operating/status strips.

Geometry relocation never changes draft/applied criteria, selected Evidence,
Find hit, scroll anchor, or Live/Frozen state.

### Deterministic states to carry into production proof

1. ordinary free text plus included Mode and excluded Provenance;
2. exact zero result with active criteria and Reset;
3. syntactically valid conflicting intent with explicit explanation;
4. high-cardinality COMMAND key discovery at page 37 with exact totals;
5. discovery unavailable while page/totals remain usable;
6. selected Evidence hidden, preserved Context, and blocker-specific Reveal;
7. Live Capture growth that leaves focus/selection/filter inert;
8. terminal Capture with final exact counts;
9. memory fallback with semantic parity and qualified coverage;
10. compact, normal, shallow, and wide layouts in Dark and Light, plus
    forced-colors/non-color inspection.

The production ticket remains Material UI and must collect the full UI-standard
browser, baseline/diff, focus/accessibility, axe, extension, fixture, package, docs, and
independent visual-QA evidence. This prototype does not satisfy that gate by
itself.

## Integrated validation amendment

The Build 6 scripts were visual comparison mocks, not a semantic oracle. Build
7 keeps the selected inline-composer/value-explorer direction but supersedes the
mock state behavior with one executable query truth. The integrated proof:

- isolates the draft until Apply, uses one expected-revision mutation batch,
  rejects a stale investigation without partial application, and makes Cancel
  query-free;
- amends rather than replaces same-facet values, searches all 3,842 exact keys
  rather than only the loaded page, and pins only an actually active zero value;
- derives page, counts, discovery, lookup blockers, and optional Find navigation
  from one memory/IndexedDB-equivalent read point;
- keeps `SERVER` and `LOCAL` as the only Provenance facet values (`RUNTIME` is
  row-source presentation only when Provenance is not applicable);
- validates exact nested Escape restoration and native focus traversal without
  a dedicated shortcut scheme, plus Clear invalidation, retired identities,
  lower-capacity fallback, Limited Coverage, and a terminal state with zero
  fictitious newer Evidence; and
- exercises all four geometries in both themes plus forced colors with no
  serious or critical axe finding.

Those corrections do not reopen the UI choice. They establish Build 7's
integrated prototype and review record as the semantic evidence for Variant A;
the original Build 6 screenshots remain comparison evidence only.
