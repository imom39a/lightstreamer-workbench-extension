---
status: accepted
---

# Keep capture observational

Lightstreamer Workbench observes Item Updates and Client Messages without altering, suppressing, replacing, or redirecting their original application path. Mutation applies only to an Injection Draft copied from an immutable Injection Source, and every Injection is an explicit additional action; this preserves diagnostic fidelity and deliberate side effects at the cost that original activity and a later Injection can both affect application state.

## Considered Options

- Intercept and mutate runtime activity before it reaches its original destination.
- Observe runtime activity unchanged, then let the user inject an unchanged or mutated copy.

## Consequences

- Capturing an outbound Client Message never prevents the original message from reaching the server.
- Capturing an inbound Item Update never prevents the original update from reaching the application.
- Workbench cannot use mutation to answer “what if the original had been different?” without introducing an additional Injection.
