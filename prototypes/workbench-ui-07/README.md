# PROTOTYPE — Workbench keyboard and high-frequency operation model

This is disposable UI for resolving `workbench-ui-07 — Choose the keyboard and high-frequency operation model`. It is not production panel code.

Status: **A — Roving Instrument selected and accepted as the final interaction model.**

Three interaction models share the accepted Scoped Evidence Workspace, Elastic Triad density behavior, and single-event raw-JSON Local Injection flow. They are switchable with `?variant=`:

- **A — Roving Instrument:** DevTools-native composite navigation, semantic Tab order, one panel-local Find shortcut, and no command layer.
- **B — Operator Lens:** a searchable mirror of visible Find, Filter, Jump, Scope, Open, and contextual Action operations.
- **C — One-Shot Key Lens:** an optional temporary mnemonic layer for geometry-independent surface movement; consequential actions still require ordinary labelled activation.

The product owner selected **A — Roving Instrument** as the operating model and accepted its explicit trade-off: predictable native composite behavior may require more Tab traversal than a command or mnemonic layer. B and C remain rejected comparison evidence. The durable decision is recorded in [Workbench Keyboard and High-Frequency Operation Model](../../docs/WORKBENCH_KEYBOARD_AND_OPERATION_MODEL.md).

Run:

```sh
npm run prototype:keyboard-model
```

Open:

- `http://127.0.0.1:4177/workbench-ui-07/?variant=A`
- `http://127.0.0.1:4177/workbench-ui-07/?variant=B`
- `http://127.0.0.1:4177/workbench-ui-07/?variant=C`

The floating prototype controls exercise Live, Frozen, Empty, high-volume, object-menu, Local Injection, and invalid-draft states at actual, compact, normal, shallow, and wide geometry. The Focus inspector exposes the active surface, selected evidence, owned transient layer, and last keyboard transition.

Final selected-model captures are in [`screenshots/`](screenshots/): normal Evidence, Evidence Find, a Filter-hidden selection, compact Local Injection, and wide invalid-draft handling. These are decision evidence, not production UI assets.

This prototype deliberately does not assign a shortcut to final Local Injection, clearing retained evidence, changing Capture, reloading, or changing Chrome/DevTools panels. It never intercepts printable keys inside inputs or the raw JSON editor.

The product owner requested direct work on `main`, so this prototype is isolated by directory instead of using a throwaway branch. Only the accepted decision will become a production implementation input.
