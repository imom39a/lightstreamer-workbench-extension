# Integrated Activity in Evidence

Status: accepted direction, 2026-08-28; production verification is recorded separately.

The maintainer reviewed prototype D, requested one shared SERVER/LOCAL track on the main landing surface, and explicitly approved implementation in the actual extension. This focused amendment supersedes the separate Activity-document presentation, not the Activity evidence or counting model.

## Workspace

A compact timeline belongs directly above Ordered Evidence. It shares Evidence's geometry and disappears when Evidence is parked for another primary surface. It has no independent content scroll, permanent destination, or separate SERVER and LOCAL lanes. Evidence remains the dominant working area, including shallow and compact layouts.

One collapsed-by-default **Activity summary** belongs in existing Context, labelled for its Scope and available alongside selected Evidence. It retains exact SERVER and LOCAL Logical Update and Update Delivery counts, the SERVER Snapshot/Live breakdown, and one bounded SERVER-only busiest Subscriptions/items list. Captured bandwidth and frequency facts remain contextual. Material diagnostics remain in the existing global footer; markers link to captured Evidence rather than duplicating diagnostic banners.

Once these capabilities are available, remove the separate Open Activity doorway and its parallel bucket-table workflow. Do not add more activity pages, ranking charts, source-counter cards, or an investigation-step stack.

## Time and evidence boundaries

The ruler shows elapsed time **since the first retained timestamped Lightstreamer event** in the current History Interval. This is not a claim about when Capture or the Session began. Untimed structural topology checkpoints provide no clock and never supply an elapsed-time origin or endpoint. The origin remains stable through Scope, Filter and selected-range changes; Clear establishes a new origin. Timeline bounds and clock qualification use all retained timestamped Lightstreamer events at the current committed or Frozen read point. Counts and marks apply canonical Scope and Filter to that complete prefix, never only the rendered Evidence window. Clock regressions and unavailable evidence remain explicit limits rather than invented durations or zeros.

Display aggregation may bound visual density; it must not present an aggregate as an individual event or make an approximate bucket boundary look like an exact event timestamp. Selecting a snapshot burst applies its captured time extent and Snapshot phase. Arbitrary range selection changes the existing canonical time Filter and leaves structural Scope, other criteria, Find, selection and Live/Frozen position independent.

The canonical Filter, before-range/in-range counts and existing Reset/Back actions expose the resulting restriction. A selected record hidden by a Filter remains selected and disclosed. Passive Capture does not move focus, selection or a Frozen read point.

## Interaction

Pointer selection has a discoverable keyboard equivalent. Range editing is a bounded transient: commit applies the Filter, cancel discards only the pending range, and Escape is consumed only while that transient is owned. Native controls and any roving marker group use conventional keyboard behavior; Tab remains the cross-surface navigation command.

An ordinary update mark selects and reveals existing Evidence. A captured client-status, Session-transition, loss or error marker deliberately inspects its immutable record in existing Context. Neither action silently rescopes, filters or changes Live/Frozen position. Coincident marks remain individually reachable. Compact Back restores the originating selected row and keyboard focus.

## Narrow provenance amendment

Within this shared timeline only, SERVER uses neutral marks and LOCAL uses purple outlined diamonds. A visible SERVER/LOCAL legend, accessible marker names and the existing textual Evidence provenance are mandatory. Shape preserves the distinction without color and under forced colors. Purple means Local provenance, never success, safety or delivery outcome.

This is the maintainer-approved amendment to the earlier blanket prohibition on provenance colors. It does not authorize colored Evidence rows, raw JSON, COMMAND verbs, Snapshot phases, lifecycle palettes or application identities. All other Plain Ledger rules continue unchanged.

## Implementation and verification

Production tickets are `activity-main-01` through `activity-main-03` in [Project 2](https://github.com/users/imom39a/projects/2). They carry forward the approved functional slices and public Activity projection/runtime plus rendered Evidence, Filter and Context test seams. Work starts from `82bd61b6dabf8060da8d00be0a2245dbad50b5af` on `feat/integrated-activity-timeline`.

This is **Material UI**. Apply the full [UI Standard](WORKBENCH_UI_STANDARD.md), including compact 563×700, normal 900×700, shallow 900×320 and wide 1440×900, Light/Dark, non-color/forced-colors, keyboard and axe checks, independent visual QA, and explicit review of affected visual baselines. A successful prototype or intermediate test is not production completion.
