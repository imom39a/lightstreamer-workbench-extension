# Visual-semantic model comparison

Status: **A accepted; B and C rejected**

All candidates preserve the same product and domain boundaries. Server and Local provenance stay textual, Capture stays independent from Live/Frozen, Snapshot phase stays independent from provenance, COMMAND verbs remain neutral operations, focus stays independent from selection, and Local Effective COMMAND State is never presented as Authoritative COMMAND State.

## A — Plain Ledger

Meaning lives in explicit text, stable columns, projection headers, property names, and persistent outcome rows. Color reinforces focus, selection, warnings, and errors but does not identify provenance or ordinary successful states.

Strongest at precision, accessibility, compact implementation, and forced-colors reliability. Its cost is repeated text and slower glance-level differentiation for experienced operators.

## B — Signal Rail

A fixed semantic gutter places provenance, phase, COMMAND operation, lifecycle, diagnostic severity, and Injection outcome in stable lanes. Full text remains in Context and in compact row grammar.

Strongest at high-volume expert scanning and keeping independent axes aligned. Its cost is a permanent width tax and a visual vocabulary that must be learned and strictly governed.

## C — Evidence Blocks

Labelled structural boundaries bracket a Server snapshot sequence, ordinary live flow, a Local Injection trace, or a diagnostic interval while every event remains in capture order. Rows are comparatively quiet; the boundary header and left rule carry repeated context with textual fallbacks.

Strongest at explaining evidence sequences and making a Local Injection plus its deliveries read as one trace. Its cost is variable row rhythm, ambiguity when sequences interleave, and a greater risk that grouping becomes an investigation taxonomy.

## Shared non-negotiable rules

- Never use success/warning/error colors for neutral COMMAND `ADD`, `UPDATE`, or `DELETE` operations.
- Never use Local provenance styling to imply successful delivery or downstream application effect.
- Never infer Server causality from a Local Injection without application-supported Injection Attribution.
- Keep `Capture active`, `Coverage limited`, `View Frozen`, `Snapshot phase Live`, and runtime lifecycle as independently labelled states.
- Keep full **Observed Server COMMAND State** and **Local Effective COMMAND State** titles visible at the projection decision boundary.
- Reserve generic selection fill and focus outline for interaction state.
- Pair every warning, error, retired state, blocking reason, and outcome with text and a non-color shape or placement.
- Keep domain provenance and validation outside raw JSON syntax styling.
- Use persistent outcome evidence rather than a disappearing success/error toast.
- Preserve exact semantic meaning in Dark, Light, forced-colors, compact, and high-volume conditions.

## Final decision

Select **A — Plain Ledger** without a permanent Signal Rail or universal Evidence Blocks.

A is the safest baseline and the easiest to maintain. Explicit text and stable placement make the semantic contract readable in compact, forced-colors, and high-volume conditions without requiring contributors or developers to memorize a private vocabulary. The accepted cost is a visually flatter ledger and somewhat slower glance-level differentiation.

B's rail is rejected because its permanent width and vocabulary tax are not justified. C's grouping is rejected because variable row rhythm and interleaving ambiguity would pull the workspace toward the investigation taxonomy already ruled out. Persistent Local Injection outcomes and full projection titles remain explicit ledger/document regions rather than exceptions to the selected grammar.

## Live review

- A — Plain Ledger was accepted as the durable visual-semantic model.
- B — Signal Rail was reviewed and rejected; no fixed semantic rail is borrowed into A.
- C — Evidence Blocks was reviewed and rejected as the universal ledger or Local Injection trace grammar.
