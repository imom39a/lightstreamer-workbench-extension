# PROTOTYPE — Local Injection interaction models

This is disposable UI for resolving `workbench-ui-05 — Choose the Local Injection interaction model`. It is not production panel code.

> The final Variant A combines the accepted Scoped Evidence Workspace with a continuous raw-JSON Draft Set. The earlier B and C models remain historical comparison material.

Run it with:

```sh
npm run prototype:local-injection
```

Or open the variants directly after starting the command:

- `http://127.0.0.1:4175/workbench-ui-05/?variant=A`
- `http://127.0.0.1:4175/workbench-ui-05/?variant=A&entry=author`
- `http://127.0.0.1:4175/workbench-ui-05/?variant=A&multi=1&drafts=1`
- `http://127.0.0.1:4175/workbench-ui-05/?variant=A&multi=1&drafts=6&compare=1`
- `http://127.0.0.1:4175/workbench-ui-05/?variant=B`
- `http://127.0.0.1:4175/workbench-ui-05/?variant=C`

The prototype is in-memory only. It never communicates with an inspected page or Lightstreamer Server.

Final Variant A uses exactly one event document by default. The selected timeline event seeds one captured-source draft; `entry=author` represents the alternative current entry route that creates one new COMMAND draft with no Injection Source. Other visible timeline events are never inferred as draft members.

Current mode allows one active draft. If a developer asks to create a captured or authored draft while another draft is parked, Workbench must not append, replace, or retarget it silently. It should reveal the active draft and require an explicit resume/finish or discard decision before creating another.

Future multi-edit is isolated behind `multi=1`. It begins with one explicitly seeded member and exposes `Add event…` with two choices: add captured evidence explicitly or create a new COMMAND event. Timeline multi-selection may later accelerate the captured-evidence choice, but both paths must use the same explicit membership operation. Each future member can be collapsed independently. Source and Draft columns share one scroll container per event, so positions cannot drift. Review and execution remain focused on one event only; visual order has no execution semantics.

Live review found that all-in-inspector editing is too cramped for large event payloads. The revised editor-specific comparison is at:

- `http://127.0.0.1:4175/workbench-ui-05/large-event-editor/?variant=A`
- [`large-event-editor/README.md`](./large-event-editor/README.md)

A second live review rejected attribute forms, grids, and structured trees as the primary editing model. The current raw-JSON-first study is at:

- `http://127.0.0.1:4175/workbench-ui-05/raw-json-editor/?variant=A`
- `http://127.0.0.1:4175/workbench-ui-05/raw-json-editor/?variant=B&events=6`
- `http://127.0.0.1:4175/workbench-ui-05/raw-json-editor/?variant=C&events=6`
- [`raw-json-editor/COMPARISON.md`](./raw-json-editor/COMPARISON.md)

## What is simulated

- Entry from a compatible Captured Item Update without changes
- Mutation of a copied draft
- A newly authored COMMAND Item Update with no Injection Source
- Invalid, unavailable, stale, and mismatched targets/drafts
- Delivered, partial listener failure, wire failure, and lost-acknowledgement outcomes
- A marked Injected Update, separate Observed Server and Local Effective COMMAND projections, tracing, and deliberate repetition
- Wide, normal, and compact DevTools docking geometry

The floating **Prototype state** control is test scaffolding, not part of any proposed product UI.

## Verification

The earlier three models were browser-checked at 1440×900, 900×700, and 563×700. Final Variant A was checked at wide, 900×700, and 563×700 widths for single captured-event seeding, single authored COMMAND entry, explicit captured/authored additions in future mode, horizontal overflow, event collapse/expand, structural Source/Draft scroll synchronization, independent invalid/stale blocking, focused-only review, park/resume, and successful Local Injection outcome.

Reviewed screenshots for the final synthesis and earlier studies live in [`screenshots/`](./screenshots/) and [`large-event-editor/screenshots/`](./large-event-editor/screenshots/). The live prototype remains available through the same Vite command.

The current/future boundary is captured in:

- `final-A-single-selected-event.jpg` — today's selected captured event;
- `final-A-single-authored-command.jpg` — today's alternative new COMMAND entry;
- `final-A-future-add-event.jpg` — future explicit membership choices;
- `final-A-draft-set-*.jpg` — the explicitly enabled future multi-edit workspace.

The product owner requested direct work on `main`, so the prototype is isolated by directory rather than captured on a throwaway branch. The accepted interaction decision—not this code—is the durable output.
