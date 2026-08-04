# PROTOTYPE — Researched raw JSON variants

Question: do established developer-tool patterns reveal a better Local Injection editing structure than a single raw JSON document with optional diff?

Run:

```sh
npm run prototype:local-injection
```

Open:

- `/workbench-ui-05/raw-json-editor/research-variants/?variant=D` — Revision Editor
- `/workbench-ui-05/raw-json-editor/research-variants/?variant=E` — Patch Forge
- `/workbench-ui-05/raw-json-editor/research-variants/?variant=F&drafts=4&palette=1` — Quiet Buffer
- `/workbench-ui-05/raw-json-editor/research-variants/?variant=G&drafts=6` — Draft Set editing
- `/workbench-ui-05/raw-json-editor/research-variants/?variant=G&drafts=6&compare=1` — Draft Set source comparison

These throwaway variants are informed by [`docs/research/local-injection-json-editor-patterns.md`](../../../../docs/research/local-injection-json-editor-patterns.md). The floating controls exercise 84/240/500 fields, one or four future draft documents, invalid/stale states, and Patch Forge's no-source limitation.

Exact target, immutable source identity, Session, listener status, and Local-only execution remain outside every editable document. No variant defines future multi-event execution semantics. Variant G deliberately looks like one continuous workspace while retaining independent document, target, validation, undo, and review boundaries; visual order is explicitly not injection order.

Reviewed 1280×720 captures are in [`screenshots/`](./screenshots/), including G in both edit and compare modes. Use `?presentation=1` to hide prototype controls when reviewing a route live.
