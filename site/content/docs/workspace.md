Version 2 replaces separate Timeline, Topology, and COMMAND State destinations with one **Scoped Evidence Workspace**. Wide layouts can show three panes at once, but they remain parts of one investigation rather than separate products.

## Runtime Scope

The Scope breadcrumb is the authoritative investigation boundary. The structural picker follows Page → client → Session → Subscription → item → listener. Retired objects remain readable as historical structure but cannot become Local Injection targets.

Choosing Scope changes which Evidence belongs to the investigation. Selecting an Evidence row does not silently change Scope.

## Ordered Evidence

Ordered Evidence is the dominant working surface. It keeps chronological identity, Lightstreamer semantics, Server versus Local provenance, snapshot/live phase, and COMMAND operations explicit.

High-volume history uses a bounded visible window while retained Evidence remains queryable behind it. Older/Newer controls navigate retained regions without pretending that only rendered rows exist.

## Context

With no selected row, Context describes the active runtime object. With a selected row, its header keeps Evidence provenance visible and presents update Fields first. **Activity summary**, **Filter selected Evidence**, and **Evidence metadata** remain collapsed supporting disclosures immediately above the selected update.

Expand only the context you need. The Filter disclosure exposes typed Include, Exclude, and Around actions without changing unrelated criteria. Evidence metadata exposes Source, phase, identities, observation path, COMMAND details, and limitations.

At compact geometry, opening Context temporarily replaces Evidence. **Back to Evidence** restores the originating selection and focus.

## Notifications

The labelled footer entry opens one Panel Session-wide Notifications document for active Workbench conditions and recent Lightstreamer diagnostics. Notification filters are independent of Evidence Scope and Filter. Stable active conditions update in place instead of piling up duplicate entries.

Dismiss hides only the active footer copy. The retained notification, supporting Evidence, affected Scope, and diagnostic observation remain available until the condition resolves.

## Session operations

**More actions** contains low-frequency session operations: complete scoped Evidence copy, deliberate history clearing, scoped export, appearance settings where needed, and first-party Help resources. These operations do not create a peer navigation destination.
