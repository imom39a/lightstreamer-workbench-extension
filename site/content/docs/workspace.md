Version 2 replaces separate Timeline, Topology, and COMMAND State destinations with one **Scoped Evidence Workspace**. Wide layouts can show three panes at once, but they remain parts of one investigation rather than separate products.

## Runtime Scope

The Scope breadcrumb is the authoritative investigation boundary. The structural picker follows Page → client → Session → Subscription → item → listener. Retired objects remain readable as historical structure but cannot become Local Injection targets.

Choosing Scope changes which Evidence belongs to the investigation. Selecting an Evidence row does not silently change Scope.

## Ordered Evidence

Ordered Evidence is the dominant working surface. It keeps chronological identity, Lightstreamer semantics, Server versus Local provenance, snapshot/live phase, and COMMAND operations explicit.

High-volume history uses a bounded visible window while retained Evidence remains queryable behind it. Older/Newer controls navigate retained regions without pretending that only rendered rows exist.

## Context

With no selected row, Context describes the active runtime object. With a selected row, it explains that Evidence and exposes applicable fields, raw data, diagnostics, COMMAND detail, and actions.

At compact geometry, opening Context temporarily replaces Evidence. **Back to Evidence** restores the originating selection and focus.

## Session operations

**More actions** contains low-frequency session operations: complete scoped Evidence copy, deliberate history clearing, scoped export, appearance settings where needed, and first-party Help resources. These operations do not create a peer navigation destination.
