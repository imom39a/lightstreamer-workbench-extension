# Surgical prototype review record

## Classification and question

- **Class:** Material UI exploration; disposable prototype only.
- **Production effect:** none. No shipped panel source or maintained visual baseline was changed.
- **Journey:** evidence-backed diagnosis of incorrect application state in high-volume Ordered Evidence.
- **Question:** can only the six-column ledger become a normalized JSON console while every surrounding Workbench contract remains fixed?

The prototype intentionally contains only two variants over the same 180 deterministic events:

- **A — Today’s ledger:** current six-column row grammar.
- **B — Surgical JSON console:** stable retained-order line plus one complete normalized Workbench Evidence JSON object.

`renderLedger()` is the only product-surface branch. Prototype framing and the external A/B switcher are outside the Workbench panel.

## Measured parity outcome

For identical event, theme, frame, Scope, selection, and Live/Frozen state, browser measurements reported exact bounding-box parity between A and B for:

- operating strip;
- Scope strip;
- Evidence header, Coverage condition, and retained-window controls;
- Scope and Context panes;
- Scope and Context splitters;
- status strip.

This passed at compact `563×700`, normal `900×700`, shallow `900×320`, and wide `1440×900`. Workbench shell overflow was `0px` horizontally and vertically at every measured frame; the JSON ledger remained the bounded horizontal scroll owner.

At wide Dark, separately cropped screenshots of the held-constant operating strip, Scope strip, Scope pane, Context pane, and status strip produced identical SHA-256 hashes across A and B. Context `innerText` was also byte-for-byte identical, and it contained no `Event JSON`, `commandKey`, or normalized-envelope block.

The intentional visual delta is therefore confined to the ledger header and rows. Compact B deliberately tests a 27px single-line JSON document instead of the accepted 48px two-line Evidence row; production implementation must obtain the explicit UI-contract decision recorded in the ticket rather than treating this prototype as a silent exception.

## Behavioral outcome

- All 60 rendered B rows parsed as valid JSON. A non-applicable phase serialized as canonical `null`, not a presentation dash.
- `SERVER`, `LOCAL`, `RUNTIME`, and `WORKBENCH`, phase, COMMAND operation, identity, key, and object appear before the nested complete event envelope.
- Up/Down changed selection and Context together.
- Find `LOCAL` reported `1 of 6`, then `2 of 6`; it moved the Find cursor and retained window from the first to second off-window match while selected Context stayed on `event-0165`.
- Filter `Capture Diagnostic` reported `4 shown / 180`, kept the independent selected Context, and exposed the existing hidden-selection recovery condition.
- Compact Enter moved from Evidence to Context; Context Back restored Evidence. The shell retained zero overflow and the JSON ledger retained horizontal scroll.
- The shareable URL preserved variant, frame, theme, selection, Find cursor/query, Filter, and compact surface.

## Accessibility and browser outcome

Agent-browser verified meaningful rendered content, no Vite error overlay, no page errors, and no console errors beyond Vite connection/debug messages.

Axe 4.12.1 reported zero violations and zero incomplete checks for:

- A — today’s ledger, wide Dark;
- B — surgical JSON console, wide Dark with active off-window Find;
- B — surgical JSON console, compact Light.

The JSON code text is hidden from row-navigation announcements while each row exposes a concise semantic accessible name. This is a prototype of the desired behavior; production must retain valid grid semantics and the existing full raw-document route.

## Visual matrix

| Frame | Today | Surgical JSON console |
| --- | --- | --- |
| Wide · Dark | [`current-wide-dark.png`](./screenshots/current-wide-dark.png) | [`json-console-wide-dark.png`](./screenshots/json-console-wide-dark.png) |
| Normal · Dark | [`current-normal-dark.png`](./screenshots/current-normal-dark.png) | [`json-console-normal-dark.png`](./screenshots/json-console-normal-dark.png) |
| Shallow · Light | [`current-shallow-light.png`](./screenshots/current-shallow-light.png) | [`json-console-shallow-light.png`](./screenshots/json-console-shallow-light.png) |
| Compact · Light | [`current-compact-light.png`](./screenshots/current-compact-light.png) | [`json-console-compact-light.png`](./screenshots/json-console-compact-light.png) |

Every image was inspected for clipping, overlaps, unexpected shell scroll, action displacement, Scope/Context movement, selection/focus distinction, semantic text, empty unexplained space, and Context reachability. The prior broad three-variant screenshots were deleted and replaced by this paired matrix.

## Prototype checks

```text
node --check prototypes/workbench-ui-11/prototype.js
npm run typecheck
npm test
npm run build
```

Agent-browser performed route loading, screenshots, keyboard/pointer interaction, error checks, geometry and scroll measurements, Context text comparison, held-surface screenshot hashing, JSON parsing, and axe execution.

This is proportional prototype evidence, not the production Material UI gate. Production still requires failing user-facing tests first, maintained reference/current/diff artifacts, Darwin and pinned-Linux baselines, full browser/extension/fixture/package/docs gates, independent visual QA, resolution of the compact-row contract, and explicit maintainer approval.
