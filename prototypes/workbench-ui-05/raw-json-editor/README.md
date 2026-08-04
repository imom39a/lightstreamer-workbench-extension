# PROTOTYPE — Raw JSON Local Injection editor

Question: can Local Injection editing become a minimal, raw-JSON-first developer surface that works for large events now and can grow toward multi-event editing later without committing to batch execution semantics?

Run:

```sh
npm run prototype:local-injection
```

Open:

- `/workbench-ui-05/raw-json-editor/?variant=A` — Payload Document
- `/workbench-ui-05/raw-json-editor/?variant=B` — Conditional Event Rail
- `/workbench-ui-05/raw-json-editor/?variant=C` — Batch Document
- `/workbench-ui-05/raw-json-editor/research-variants/?variant=D` — Revision Editor
- `/workbench-ui-05/raw-json-editor/research-variants/?variant=E` — Patch Forge
- `/workbench-ui-05/raw-json-editor/research-variants/?variant=F&drafts=4&palette=1` — Quiet Buffer
- `/workbench-ui-05/raw-json-editor/research-variants/?variant=G&drafts=6` — Draft Set
- `/workbench-ui-05/raw-json-editor/research-variants/?variant=G&drafts=6&compare=1` — Draft Set comparison

The floating test controls switch between 84/240/500 fields, one current event or six future event drafts, and ready/invalid/stale states. They are prototype scaffolding, not proposed product UI.

The editable JSON uses the current production projection: `command`, `key`, `isSnapshot`, and `fields`. Target identity, source identity, provenance, and Local Injection delivery remain locked outside the document.

Reviewed 1200×800 captures are in [`screenshots/`](./screenshots/): the single Payload Document, its optional source comparison, the future Conditional Event Rail, and the rejected Batch Document contrast.

The second research pass and its screenshots live in [`research-variants/`](./research-variants/). The primary-source interaction standards behind both passes are recorded in [`docs/research/local-injection-json-editor-patterns.md`](../../../docs/research/local-injection-json-editor-patterns.md).
