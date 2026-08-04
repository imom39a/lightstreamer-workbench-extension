# PROTOTYPE — Large event Local Injection editor

Question: **What editing surface gives developers enough room to understand and mutate Local Injection payloads containing 50–500 fields and structured values?**

Three editor models are mounted inside the accepted Scoped Evidence Workspace and switch with `?variant=`:

- `A` — Field Grid
- `B` — Draft Document
- `C` — Focus Queue

Run the existing prototype command:

```sh
npm run prototype:local-injection
```

Then open:

- `http://127.0.0.1:4175/workbench-ui-05/large-event-editor/?variant=A`
- `http://127.0.0.1:4175/workbench-ui-05/large-event-editor/?variant=B`
- `http://127.0.0.1:4175/workbench-ui-05/large-event-editor/?variant=C`

The inspector is intentionally limited to entry, parked-draft status, and outcome status. All editing happens in a temporary full-size workspace. The prototype is in-memory only and never communicates with an inspected page or Lightstreamer Server.

The payload-size control exercises 84, 240, and 500 fields. The validation control switches among ready, field-error, and stale-target states. Reviewed screenshots are in [`screenshots/`](./screenshots/), and the design comparison is in [`COMPARISON.md`](./COMPARISON.md).
