# Lightstreamer Workbench

Language for observing Lightstreamer activity, introducing Item Updates locally, and sending Client Messages through the inspected application's normal server path.

## Language

### Capture

**Capture**:
An observation of Lightstreamer activity that continues along its original application path. Capture does not alter, suppress, replace, or redirect the observed activity.
_Avoid_: Interception, in-flight mutation

**Item Update**:
An inbound set of field values for one subscribed item, interpreted under its Subscription mode. In COMMAND mode it applies to one key and carries a command.
_Avoid_: Incoming message, server message

**Logical Update**:
One Item Update before it is fanned out to registered listeners. It is counted once regardless of how many listeners receive it.
_Avoid_: Callback, listener event

**Update Delivery**:
One delivery of a Logical Update to one registered listener. A Logical Update may have multiple Update Deliveries.
_Avoid_: Logical update, duplicate update

**Captured Item Update**:
An immutable record of an Item Update observed as it reaches the inspected application. It may become the Injection Source for a Local Injection.
_Avoid_: Captured message

**Captured Client Message**:
An immutable record of a Client Message submitted by the inspected application. Its original submission proceeds unchanged, while the record may become the Injection Source for a later Server Injection.
_Avoid_: Intercepted message

### Injection

**Injection**:
A single user-requested execution that introduces an Item Update locally or sends a Client Message through the server boundary. It exists regardless of its outcome, and its payload may be unchanged, mutated, or newly authored.
_Avoid_: Replay, reinjection

**Injection Source**:
A Captured Item Update or Captured Client Message selected as the immutable basis for an Injection. It is never changed by drafting, mutation, or injection.
_Avoid_: Replay source, mutable source

**Injection Draft**:
An editable prospective payload copied from an Injection Source or newly authored. It carries an Item Update for Local Injection or a Client Message for Server Injection.
_Avoid_: Replay draft, reinjection draft

**Injection Outcome**:
The result of an Injection at its chosen delivery boundary, such as delivered, accepted, rejected, failed, or unknown. It describes boundary handling, not whether downstream item updates or application effects occurred.
_Avoid_: Business effect, update result

**Unknown Injection Outcome**:
An Injection Outcome in which Workbench cannot determine whether a Server Injection was processed. It is neither a confirmed failure nor evidence that repeating the Injection is safe.
_Avoid_: Failed injection, retryable failure

**Repeat Injection**:
A new Injection that intentionally resubmits the same or an equivalent Client Message after an earlier Injection. It is a separate execution and may duplicate server-side effects.
_Avoid_: Automatic retry, safe resend, continuation

**Mutation**:
A deliberate change to an Injection Draft before delivery. Mutation never changes the Injection Source or the application's original activity.
_Avoid_: Replay edit

**Local Injection**:
An Injection carrying an Item Update to a Local Injection Target within the inspected application's browser runtime. It does not enter Lightstreamer Server's update flow.
_Avoid_: Local replay, synthetic replay, local-session injection

**Local Injection Target**:
The selected Subscription that receives a Local Injection. The Logical Update is delivered to every listener currently registered on that Subscription and to no other matching Subscription.
_Avoid_: Captured listener, page-wide target, matching subscriptions

**Server Injection**:
An Injection carrying a Client Message to the server-side application through the inspected client's normal Session. Any resulting Server Updates follow ordinary Lightstreamer fan-out to every applicable subscriber.
_Avoid_: Remote replay, session-targeted injection

**Client Message**:
An application message sent from a Lightstreamer client to the server-side application in the context of its current Session. It is a request, not an item update.
_Avoid_: Upstream update, injected update

**Server Update**:
An item update delivered through the normal Lightstreamer Server subscription flow. It is not distinguishable as injection-caused unless it carries Injection Attribution.
_Avoid_: Injection response

**Injection Attribution**:
Optional application-supported metadata that identifies Workbench as the initiator and correlates a Server Injection with resulting Server Updates. Its absence does not change delivery behavior but prevents reliable causal attribution.
_Avoid_: Synthetic marker

**Injected Update**:
A Logical Update known to have been caused by an Injection. One Injection may cause zero, one, or many Injected Updates; a Server Update qualifies only when Injection Attribution provides the causal link.
_Avoid_: Synthetic update, replayed update

### COMMAND State

**Observed Server COMMAND State**:
The key and row state reconstructed only from captured Server Updates. It may be incomplete; inconsistencies may produce warnings but must not block a Server Injection.
_Avoid_: Observed COMMAND State, authoritative state, server truth

**Local Effective COMMAND State**:
The key and row state projected from Server Updates and successfully delivered Local Injected Updates, in delivery order, for one Subscription. It represents locally delivered Lightstreamer state, not the server's Authoritative COMMAND State.
_Avoid_: Synthetic COMMAND State, combined COMMAND state, local server state

**Authoritative COMMAND State**:
The server-side application state that determines whether a COMMAND action is valid and which updates it produces. Workbench may observe evidence of this state but does not own it.
_Avoid_: Workbench state, local truth

**COMMAND Snapshot**:
A server-delivered initial sequence sufficient to reconstruct the current COMMAND table when snapshots are supported and requested. It can seed both Workbench projections but does not provide direct access to Authoritative COMMAND State.
_Avoid_: Server query, authoritative-state pull
