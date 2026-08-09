COMMAND subscriptions represent keyed row lifecycles through `ADD`, `UPDATE`, and `DELETE` operations. Workbench follows these operations as Evidence and exposes two intentionally distinct projections.

## Observed Server COMMAND State

**Observed Server COMMAND State** is reconstructed from captured Server Updates only. It describes what Workbench could observe through the current Capture boundary; it is not direct access to server-side authoritative state.

## Local Effective COMMAND State

**Local Effective COMMAND State** begins with the same captured Server Updates and additionally applies successfully delivered Local Injected Updates for the Subscription.

When the projections differ, that difference is comparison evidence. It is not an error by itself, and it does not change Observed Server COMMAND State.

## Authority limit

Neither projection is **Authoritative COMMAND State**. Incomplete observation, late attachment, filtering, lost-update signals, snapshot limitations, or failed Evidence retention can limit the conclusions Workbench supports. Read the coverage and diagnostic text before relying on a projection.

## Snapshot behavior

COMMAND snapshots are formed from `ADD` operations for active keys. Snapshot completion at the first level does not prove that every second-level subscription has completed its own snapshot.
