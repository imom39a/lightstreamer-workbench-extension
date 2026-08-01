---
status: accepted
---

# Scope Local Injection to one Subscription

A Local Injection targets the selected Subscription and delivers one Logical Update to every listener currently registered on that Subscription. It targets neither one captured listener nor every page Subscription with matching item metadata, because the former models only one delivery and the latter may cross incompatible modes, schemas, and application intent.

## Considered Options

- Deliver only to the listener associated with the captured source.
- Deliver to the selected Subscription and all of its currently registered listeners.
- Deliver to every matching Subscription in the inspected page.

## Consequences

- One Injected Update may produce several Update Deliveries.
- Other Subscriptions remain unaffected even when they contain the same item.
- Listener and wire delivery paths must expose the same Subscription-scoped semantics; the current listener path, which invokes only the captured callback, does not yet satisfy this decision.
