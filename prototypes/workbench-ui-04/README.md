# PROTOTYPE — Workbench workspace information architecture

This is disposable UI for resolving `workbench-ui-04 — Choose the Workbench workspace information architecture`. It is not production panel code and must not be promoted directly into the extension.

Status: reviewed. The accepted architecture is the [Scoped Evidence Workspace](../../docs/WORKBENCH_WORKSPACE_INFORMATION_ARCHITECTURE.md): A is the organizer, B contributes its runtime-object dossier and explicit target context, and C's maintained investigation stack is rejected.

> Three structurally different Workbench workspace models, switchable with `?variant=`, on one deterministic diagnostic scenario.

Run it with:

```sh
npm run prototype:workbench-ui
```

Then open one of:

- `http://127.0.0.1:4174/?variant=A`
- `http://127.0.0.1:4174/?variant=B`
- `http://127.0.0.1:4174/?variant=C`

Use the fixed switcher or the Left and Right arrow keys to move between variants. Arrow-key switching is disabled while a form field has focus.

All variants use the same fake state: one healthy client and Session, a suspicious COMMAND Subscription, 12,482 captured events, selected key `order-1042`, a difference between Observed Server and Local Effective COMMAND State, and a compatible Local Injection Target. Buttons only change in-memory prototype state.

The product owner requested direct work on `main`, so this prototype is isolated by directory rather than captured on the skill's usual throwaway branch. The accepted decision—not this code—is the durable output.

## Captured evidence

The `screenshots/` directory contains each variant at 563×700, 900×700, and 1440×900. It also contains compact orientation and Local Injection states used during live review.
