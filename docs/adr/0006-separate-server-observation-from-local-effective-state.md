---
status: accepted
---

# Separate server observation from local effective state

Workbench maintains two COMMAND projections for each Subscription. Observed Server COMMAND State applies only captured Server Updates, while Local Effective COMMAND State applies those Server Updates plus successful Local Injected Updates in delivery order; this lets developers understand what the page experienced without presenting a local experiment as evidence of server state.

## Considered Options

- Combine Server Updates and Local Injected Updates into one COMMAND projection.
- Exclude Local Injected Updates from every COMMAND projection.
- Maintain separate server-observation and local-effective projections.

## Consequences

- A Server Update advances both projections for its Subscription.
- A successful Local Injection advances only Local Effective COMMAND State.
- Server Injection warnings use Observed Server COMMAND State, never Local Effective COMMAND State.
- The UI and event provenance must make the selected projection visible.
- The current COMMAND projection, which includes synthetic events in one state model, must be split to satisfy this decision.
