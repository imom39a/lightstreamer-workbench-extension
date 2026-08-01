---
status: accepted
---

# Send Server Injections as Client Messages

A Server Injection sends a Client Message through the inspected Lightstreamer client's normal `sendMessage` path in the context of its current Session, exactly as the application would, and lets the server-side application decide which Server Updates follow. It does not inject an Item Update directly into the inbound server stream or generically translate Item Updates into Client Messages; an application may supply an optional application-specific translation rule and Injection Attribution metadata.

## Considered Options

- Introduce an arbitrary Item Update directly into the server subscription flow through a Data Adapter or dedicated backend.
- Define a generic Item-Update-to-Client-Message translation in Workbench core.
- Send an authored, captured, or mutated Client Message through the inspected client's normal message path.

## Consequences

- A captured Client Message's original submission proceeds unchanged; a later Server Injection is a separate outbound action.
- The server remains authoritative and ordinary Lightstreamer fan-out delivers resulting Server Updates to every applicable subscriber.
- One Server Injection may cause zero, one, or many Server Updates.
- Without application-supported Injection Attribution, Workbench cannot reliably prove that a particular Server Update resulted from the Injection.
- Applications may add translation or idempotency rules without constraining the generic core.
