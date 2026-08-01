---
status: accepted
---

# Do not automatically retry unknown Server Injections

Workbench does not automatically repeat a Server Injection whose Injection Outcome is Unknown, because the original Client Message may already have produced server-side effects. A user may deliberately start a separate Repeat Injection after being warned about duplication; this favors safety over automatic recovery when generic Client Messages have no universal idempotency contract.

## Considered Options

- Automatically retry a Server Injection whose outcome is Unknown.
- Prevent any repetition after an Unknown outcome.
- End the original Injection as Unknown and let the user deliberately start a warned Repeat Injection.

## Consequences

- Unknown is a terminal outcome for the original Injection, not a retryable failure.
- A Repeat Injection has its own identity and may duplicate server-side effects.
- Application-specific rules may use an application-recognized idempotency identifier, but the generic core cannot claim that repeating a Client Message is safe.
