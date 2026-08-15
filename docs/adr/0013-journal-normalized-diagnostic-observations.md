# ADR 0013: Journal normalized Diagnostic Observations independently of rendering

## Status

Accepted.

## Decision

Workbench normalizes diagnostic findings into one versioned `DiagnosticObservation` contract before persistence or renderer adaptation. Every observation has a stable rule code and rule version, severity, occurrence-or-condition lifecycle event, exact typed affected identity, observed timestamp, and four separate semantic fields: observed fact, observation limitation, consequence, and one bounded inspection or recovery route. An optional numeric source code and explicitly safe bounded message may be retained as evidence; neither participates in identity or search.

The Panel Session owns a Diagnostic Observation journal. Its monotonic `DiagnosticObservationBoundary` advances for every newly committed lifecycle event, including findings that are not backed by Event History. Evidence-backed observations additionally retain the exact Committed Evidence Boundary that supported them. Timestamps describe observations but never order them.

Queries are renderer- and storage-neutral. They match a stable code, minimum severity, exact typed affected identity, and immutable `(after, through]` observation range. They report complete, unsupported, retention-gap, cleared, unavailable, or closed coverage explicitly. A subscription feed publishes committed lifecycle events strictly after a chosen boundary. Deduplication, replay, and rendering do not advance the boundary. Resolution is a lifecycle event rather than deletion.

Occurrence identity includes the source occurrence identity. Condition identity includes a stable condition identity and affected identity; a source-backed semantic change creates an update at a new boundary, while an identical repeated observation deduplicates. Clear starts a new diagnostic interval. Retention loss is reported as a gap and never silently treated as absence.

The persisted contract is allowlisted and bounded before it crosses a page or storage boundary. Display titles, localized copy, array positions, arbitrary raw values, and unsafe messages are not normalized identity. Compact observation references intentionally omit semantic and source messages so Scenario Trace and other consumers can retain identity, lifecycle, boundary, affected identity, and route within their own capacity limits.

Affected identity never invents a missing Page epoch. Evidence-backed findings without an observed Page identity use their exact Evidence identity; non-Evidence-backed conditions use the bounded `page-identity-unavailable` marker until an exact Page identity is observed.

Existing history, storage, Capture, Session, COMMAND, subscription-error, and lost-update findings enter through source adapters. Adapters preserve their current presentation independently while adding only facts their source can support.

## Consequences

- Scenario Review can authorize an observation cursor and Checkpoints can query a race-free `(authorization, checkpoint]` range without depending on Event History or footer state.
- Persistent conditions active before an authorization boundary do not become new observations merely because they remain rendered.
- Memory and IndexedDB journals expose identical lifecycle, query, replay, Clear, retention, and ordering behavior.
- Additional callback capture and lint rules can populate the same contract incrementally; they are not required by the contract itself.
- This migration is Non-UI. The existing diagnostic footer's copy, order, focus, accessible state, and layout remain unchanged.
