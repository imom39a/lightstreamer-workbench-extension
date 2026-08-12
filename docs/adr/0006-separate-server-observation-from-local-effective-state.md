---
status: accepted
---

# Separate server observation from local effective state

Workbench maintains two COMMAND projections for each Subscription. Observed Server COMMAND State applies only captured Server Updates, while Local Effective COMMAND State applies those Server Updates plus successful Local Injected Updates in delivery order; this preserves the accepted separate-projection decision and lets developers understand what the page experienced without presenting a local experiment as evidence of server state. [ADR 0011 — Make one session-owned journal the Evidence acceptance boundary](0011-make-one-session-owned-journal-the-evidence-acceptance-boundary.md) partially qualifies when a Local Injected Update enters that projection for the target Event History contract: successful Local Injection delivery alone does not advance Local Effective COMMAND State; the corresponding Local Injected Update must first become committed Evidence. This target qualification does not claim that current production behavior changed.

## Current production outcome (2026-08-12)

The Event History cutover has now implemented the target qualification described
above. A Local Injected Update advances Local Effective COMMAND State only after
the update becomes committed Evidence. Delivery outcomes remain truthful even
when Evidence retention fails; an unaccepted update never advances either
projection. The separate Observed Server and Local Effective projection
semantics remain accepted and current.

## Considered Options

- Combine Server Updates and Local Injected Updates into one COMMAND projection.
- Exclude Local Injected Updates from every COMMAND projection.
- Maintain separate server-observation and local-effective projections.

## Consequences

- A Server Update advances both projections for its Subscription.
- A successful Local Injection is eligible to advance only Local Effective COMMAND State; under the ADR 0011 target acceptance boundary, its corresponding Local Injected Update must first become committed Evidence, so delivery alone does not advance the projection.
- Server Injection warnings use Observed Server COMMAND State, never Local Effective COMMAND State.
- The UI and event provenance must make the selected projection visible.
- The current COMMAND projection, which includes synthetic events in one state model, must be split to satisfy this decision.
