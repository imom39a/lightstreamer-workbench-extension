A COMMAND Subscription uses `ADD`, `UPDATE`, and `DELETE` operations for each key. Workbench shows these operations in retained Event order. Use this order to inspect the sequence that reached the client.

## Investigate a keyed lifecycle

1. Select the applicable COMMAND Subscription, item, or listener in **Scope**.
2. Filter **Ordered Evidence** by item or key.
3. Read `ADD`, `UPDATE`, and `DELETE` in retained Event order.
4. Check whether each operation is in the snapshot or live phase.
5. Select an update.
6. Inspect its Fields, changed fields, Source, and observation path in **Context**.
7. Review **Notifications** for missing keys, duplicate operations, lost updates, limited Coverage, or snapshot limits.

Workbench does not show a reconstructed COMMAND table as current server state. Use the captured Evidence sequence and its Coverage limit for your conclusion.

## Internal state services

Workbench derives COMMAND state from committed Evidence. It uses this state to validate Local Injection Drafts, prepare Scenarios, evaluate COMMAND Checkpoints, and create diagnostics. Retained Local Injection Evidence can be part of these local workflows. It does not change captured Server Evidence.

Derived state is not direct access to server state. Late attachment, incomplete snapshots, lost updates, or Evidence retention failures can limit the result.

## Snapshot behavior

A COMMAND snapshot contains `ADD` operations for active keys. First-level snapshot completion does not prove completion for each second-level Subscription.
