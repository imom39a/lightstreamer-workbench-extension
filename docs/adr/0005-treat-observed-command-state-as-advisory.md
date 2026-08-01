---
status: accepted
---

# Treat Observed Server COMMAND State as advisory

Workbench may compare a Server Injection Draft with its Observed Server COMMAND State and warn when a key or transition appears inconsistent, but it does not block submission on that basis. Capture may have started late or missed updates, so the server-side application remains the authority for COMMAND state and message validity.

## Considered Options

- Reject Server Injections that conflict with Workbench's reconstructed state.
- Ignore reconstructed state when preparing a Server Injection.
- Show state-based warnings while allowing the user to submit the Client Message.

## Consequences

- A missing or unexpected key in Workbench produces guidance rather than a client-side refusal.
- The server may accept or reject a Client Message regardless of Workbench's warning.
- Workbench may use snapshots or other server-provided evidence to improve Observed Server COMMAND State, but generic capture still does not make that state authoritative.
- An application-specific rule may consult an authoritative application endpoint, but that capability does not belong to the generic core.
