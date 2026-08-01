# Lightstreamer Developer Tooling Feature Opportunities

Research date: 2026-07-28

## Recommendation

The next evolution of Lightstreamer Workbench should be a developer observability and correctness suite, not only a larger event viewer.

The highest-value direction is:

1. Make the current capture easy to navigate under real production volume.
2. Explain client, session, subscription, snapshot, filtering, and recovery behavior.
3. Turn captured sequences into deterministic, backend-free reproduction scenarios.
4. Add specialized tools for two-level COMMAND, client messages, QoS, and protocol-level incidents.

The public Web Client API should remain the primary source of truth. Raw TLCP and internal client logs are valuable for difficult incidents, but should be supplemental, opt-in diagnostics.

## Current Product Baseline

The extension already provides a strong foundation:

- Client, subscription, listener, item-update, snapshot, lost-update, and COMMAND lifecycle capture.
- Searchable Timeline with normalized and raw event data.
- COMMAND state reconstruction with active rows, deleted keys, lifecycle history, provenance, and diagnostics.
- Single-event replay, mutation, new COMMAND update creation, and local listener or captured-WebSocket reinjection.
- WebSocket/TLCP fallback when the public Web Client constructors are unavailable.
- Session-local IndexedDB storage with an in-memory fallback and high-volume rendering.

The most important current gaps are:

- Client diagnostics capture only `onStatusChange`; the extension does not capture `onServerError`, `onPropertyChange`, or `onServerKeepalive`.
- Subscription capture omits requested and real max frequency, buffer size, selector, active/subscribed state, and two-level COMMAND configuration and callbacks.
- Only COMMAND has a dedicated state model; MERGE, DISTINCT, and RAW are Timeline-only.
- Outbound `sendMessage` operations and their outcomes are not represented as first-class events.
- Replay handles individual updates rather than editable, timed event sequences.
- Structured filters exist in the store but are not exposed as faceted Timeline controls.
- There is no pause/resume, retention policy, trace export/import, watchpoint, or cross-capture comparison workflow.

Relevant implementation seams:

- Capture callbacks: `src/injected/lightstreamer-instrumentation.ts:105`
- Client wrapping: `src/injected/lightstreamer-instrumentation.ts:1283`
- Event model: `src/core/event-envelope.ts:7`
- Capture kinds: `src/bridge/messages.ts:21`
- Store query/index support: `src/core/event-filter.ts:4` and `src/core/indexeddb/event-db.ts:20`
- Architecture extension guide: `docs/ARCHITECTURE.md:919`

## Prioritization Model

The ranking uses four factors:

- **Developer value**: how much debugging time the feature can save.
- **Usability**: how often it is useful and how little setup it requires.
- **Product fit**: how well it reinforces Lightstreamer-native, local-first DevTools workflows.
- **Effort**: relative implementation size in the current architecture.

Effort estimates:

- **S**: localized UI or aggregation work using existing capture data.
- **M**: new capture fields/kinds plus reducers and UI.
- **L**: a new workflow spanning instrumentation, state, bridge, UI, and browser verification.

## Prioritized Feature Backlog

| Rank | Feature | Developer value | Usability | Effort | Priority |
| ---: | --- | :---: | :---: | :---: | :---: |
| 1 | Client, session, and subscription topology inspector | 5/5 | 5/5 | M | P0 |
| 2 | Unified diagnostics center and contextual error explainer | 5/5 | 5/5 | S-M | P0 |
| 3 | Multi-event scenario recorder and deterministic local replay | 5/5 | 4/5 | M-L | P0 |
| 4 | Connection, transport, rebind, and recovery timeline | 5/5 | 4/5 | M | P0 |
| 5 | Snapshot bootstrap visualizer and correctness checker | 5/5 | 5/5 | S-M | P0 |
| 6 | Faceted Timeline filters and clickable filter chips | 4.5/5 | 5/5 | S | P0 |
| 7 | Subscription semantics inspector and configuration linter | 5/5 | 4/5 | M | P0 |
| 8 | Filtering, frequency, bandwidth, buffer, and loss profiler | 4.5/5 | 4/5 | M | P0 |
| 9 | Capture freeze, pause/resume, and retention controls | 4/5 | 5/5 | S-M | P0 |
| 10 | Conditional event breakpoints and watch rules | 4.5/5 | 5/5 | M | P0 |
| 11 | MERGE, DISTINCT, and RAW state views with time travel | 4.5/5 | 4/5 | M-L | P1 |
| 12 | Two-level COMMAND dependency graph and merged-row inspector | 5/5 | 4/5 | L | P1 |
| 13 | Redacted trace export/import and test-fixture generation | 5/5 | 4/5 | M | P1 |
| 14 | Field provenance, value semantics, and JSON Patch inspector | 4.5/5 | 4/5 | M | P1 |
| 15 | Client-to-server message sequence waterfall | 4/5 | 4/5 | M | P1 |
| 16 | Listener performance, exception, and duplicate-listener profiler | 4/5 | 4/5 | M | P1 |
| 17 | Correlated Lightstreamer client-log and TLCP console | 4/5 | 3/5 | M-L | P1 |
| 18 | Multi-client, version, duplicate-session, and churn audit | 4/5 | 4/5 | M | P1 |
| 19 | Cross-frame, worker, HTTP transport, and bundled-client coverage monitor | 4/5 | 3/5 | L | P2 |
| 20 | Guarded live QoS and transport tuning lab | 4/5 | 3/5 | M-L | P2 |
| 21 | Mobile Push Notification workbench | 3.5/5 | 3/5 | L | P2 |
| 22 | Cross-capture comparison and regression diff | 4/5 | 4/5 | M | P2 |

## P0: Highest-Value Features

### 1. Client, Session, and Subscription Topology Inspector

Create a tree or master-detail view:

```text
page
  client
    session
      subscription
        item
          listener
```

Show:

- Client library version when discoverable, instrumentation source, and coverage status.
- Server address, Adapter Set, client status, transport, session ID, server instance, server socket name, and masked client IP.
- Requested and real bandwidth plus keepalive, retry, stalled, reconnect, and recovery settings.
- Active versus server-established subscriptions.
- Mode, item list/group, field list/schema, Data Adapter, selector, snapshot request, buffer, requested/real frequency, and listener count.
- Update counts, first-update time, last-update time, snapshot phase, errors, and lost-update count.

Why it helps:

- It answers the first questions in nearly every incident: "Which client is this?", "What is actually connected?", "Which subscriptions are live?", and "What configuration did the server accept?"
- It makes multiple clients and duplicate subscriptions immediately visible.
- It gives the rest of the proposed diagnostics a stable navigation model.

Implementation notes:

- Read `connectionDetails` and `connectionOptions` through their public getters.
- Capture values immediately on property-change callbacks because listener notifications are asynchronous.
- Never capture passwords. Mask IPs and redact authorization-like headers by default.
- Internal two-level subscriptions are not returned by `LightstreamerClient.getSubscriptions()`, so represent them through the inferred graph described later.

Official basis:

- [LightstreamerClient](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/LightstreamerClient.html)
- [ConnectionDetails](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ConnectionDetails.html)
- [ConnectionOptions](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ConnectionOptions.html)
- [Subscription](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/Subscription.html)

### 2. Unified Diagnostics Center and Contextual Error Explainer

Normalize the following into one searchable problem stream:

- Client/session errors.
- Subscription errors.
- Second-level COMMAND subscription errors.
- Lost-update notifications.
- Snapshot anomalies.
- COMMAND semantic diagnostics.
- Client-message outcomes.
- Instrumentation coverage warnings.

Each diagnostic should include:

- Severity and affected client/subscription/item/key.
- Original code and message.
- Plain-language explanation.
- Likely subsystem: credentials, Adapter Set, Data Adapter, group/schema, selector, mode, license, routing/affinity, server, or client parsing.
- Suggested next check and a link to the relevant official documentation.

Examples:

- `15` or `16`: COMMAND schema is missing `key` or `command`.
- `17`: invalid Data Adapter or no default Data Adapter.
- `21`, `22`, or `23`: invalid group/schema combination.
- `24`: subscription mode not allowed for an item.
- `26` or `27`: unfiltered dispatch refused because of a frequency limit or prefilter.
- Client error `21`: a bind reached the wrong server instance, suggesting load-balancer affinity or routing trouble.
- `61`: server response parsing failure.
- `66` or `68`: Metadata Adapter or server-side internal failure.

Correctness limits:

- Codes less than or equal to zero may be application-specific Metadata Adapter codes.
- Some server-initiated close codes intentionally have limited detail.
- A lost-update callback is not evidence of every update filtered or conflated by the server.

Official basis:

- [ClientListener](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ClientListener.html)
- [SubscriptionListener](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/SubscriptionListener.html)
- [ClientMessageListener](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ClientMessageListener.html)

### 3. Multi-Event Scenario Recorder and Deterministic Local Replay

Extend the current one-event reinjection into a scenario workbench:

- Select a Timeline range or events matching a filter.
- Preserve relative timing or normalize it.
- Step, play, pause, change speed, loop, and stop.
- Reorder, duplicate, remove, and mutate events.
- Edit snapshot flags, changed fields, COMMAND keys/commands, and timing.
- Save named checkpoints inside the current session.
- Show target availability and page acknowledgement per step.
- Add assertions such as "key exists", "field equals value", "diagnostic appears", or "listener completed without throwing".

Support all compatible update modes rather than COMMAND only. A later increment can also replay captured listener callbacks such as end-of-snapshot and clear-snapshot.

Why it helps:

- It directly delivers the product's core value: reproducing hard server event sequences without backend access.
- It turns production-only race conditions into repeatable local test cases.
- It reuses the existing draft, target, bridge, synthetic event, and acknowledgement paths.

Boundary:

- Replay remains local to captured page listeners or a captured page WebSocket.
- It must never imply injection into the real Lightstreamer server stream.

### 4. Connection, Transport, Rebind, and Recovery Timeline

Create a client swimlane that shows:

- `CONNECTING`, stream sensing, WS/HTTP streaming, WS/HTTP polling, `STALLED`, recovery, retry, and disconnected states.
- Time spent in each state.
- Server keepalives and periods of silence.
- Session ID, server instance, socket name, and client-IP changes.
- Recovery attempts versus new-session retries.
- Transport fallback or switch.
- Resubscription epochs and the point where prior subscription state becomes invalid.
- Correlated server errors and configuration changes.

Useful derived diagnostics:

- Repeated streaming-to-polling switches.
- Recovery loops or unusually long recovery attempts.
- New session after a failed recovery.
- Session/server-instance mismatch suggesting cluster-affinity trouble.
- CPU-heavy startup or slow callback periods near transport fallback.

Correctness limit:

- A high-level status transition can show that recovery was attempted, but it cannot prove the exact TLCP progressive position that was resumed. Exact proof belongs in the optional protocol view.

Official basis:

- [ClientListener status model](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ClientListener.html)
- [ConnectionOptions](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ConnectionOptions.html)
- [TLCP 2.5.0](https://www.lightstreamer.com/tlcp-2.5.0)

### 5. Snapshot Bootstrap Visualizer and Correctness Checker

Give each subscribed item a visible phase:

```text
waiting -> snapshot -> snapshot complete -> live -> cleared
```

Explain mode-specific behavior:

- MERGE: at most one snapshot update per item and no end-of-snapshot callback.
- DISTINCT: zero or more snapshot events followed by end-of-snapshot.
- COMMAND: snapshot `ADD` operations for active keys followed by end-of-snapshot.
- RAW: no snapshot.
- An end-of-snapshot notification may represent an empty snapshot.
- Clear-snapshot empties COMMAND state or invalidates the prior DISTINCT list.

Show:

- Requested snapshot setting and DISTINCT requested history length.
- Snapshot start, row/event count, duration, end, clear, and first live update.
- Items still waiting for an expected snapshot.
- Snapshot/live provenance on every field or COMMAND key.
- New snapshot epochs after resubscription or recovery.

Two-level caveat:

- First-level COMMAND end-of-snapshot does not mean all second-level MERGE snapshots are complete. Second-level snapshot updates can arrive before or after it.

Official basis:

- [SubscriptionListener](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/SubscriptionListener.html)
- [ItemUpdate](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ItemUpdate.html)
- [General Concepts](https://lightstreamer.com/docs/ls-server/latest/General%20Concepts.pdf)

### 6. Faceted Timeline Filters and Clickable Filter Chips

Expose the structured filtering already supported by the core store:

- Client and subscription.
- Mode.
- Event kind.
- Item.
- COMMAND key and command.
- Snapshot/live.
- Server/synthetic.
- Listener/wire capture source.
- Error or diagnostic severity.
- Inbound/outbound once client messages are captured.

Usability behaviors:

- Clicking a value in a row or detail pane adds a filter chip.
- Chips are individually removable.
- Include/exclude mode is explicit.
- "Only this key", "Only this subscription", and "Events around this error" are one click.
- Show result counts before applying expensive text searches.

This is the smallest high-impact feature because the IndexedDB metadata and structured-filter types already exist.

### 7. Subscription Semantics Inspector and Configuration Linter

Explain the effective contract of every subscription and flag likely mistakes:

- RAW cannot request a snapshot.
- Buffer size is configurable only for filtered MERGE or DISTINCT subscriptions.
- COMMAND requires `key` and `command`.
- Two-level behavior is valid only for COMMAND.
- Second-level items are implicit MERGE subscriptions with snapshot.
- First- and second-level field-name conflicts make the second-level value positional-only.
- Conflicting MERGE, DISTINCT, and COMMAND requests for the same literal item are suspicious; RAW is the compatible alternate family.
- An unfiltered request can be refused when a server-side frequency limit or prefilter exists.
- Item groups, field schemas, selectors, and mode authorization remain server-defined and cannot always be validated before the response.

Also distinguish:

- `isActive()`: the subscription was activated on a client.
- `isSubscribed()`: the server has established it.

Official basis:

- [Subscription](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/Subscription.html)
- [General Concepts: modes, filtering, and buffers](https://lightstreamer.com/docs/ls-server/latest/General%20Concepts.pdf)

### 8. Filtering, Frequency, Bandwidth, Buffer, and Loss Profiler

Display per client and subscription:

- Requested versus real maximum bandwidth.
- Requested versus real maximum frequency.
- Measured callback frequency by subscription, item, and COMMAND key.
- Filtered versus unfiltered request.
- Requested/default buffer size.
- Update counts and changed-field density.
- Approximate payload bytes where measurable.
- Lost-update counts and affected intervals.
- Snapshot and live rates separately.

Useful conclusions:

- The server applied a lower frequency than requested.
- A session-wide bandwidth cap coincides with lower observed rates.
- An unfiltered subscription reported actual lost updates.
- A listener is receiving an unsustainable callback rate.

Do not claim:

- An exact source-to-client conflation ratio. Filtered suppression can be intentional and silent.
- Per-item server frequency from `onRealMaxFrequency`; it reports the maximum among the subscription's items.
- Server queue occupancy; the public Web Client API does not expose it.
- End-to-end latency unless the application payload contains a trustworthy source timestamp.

Official basis:

- [Subscription frequency and buffer APIs](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/Subscription.html)
- [ConnectionOptions bandwidth APIs](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ConnectionOptions.html)
- [General Concepts: bandwidth and frequency management](https://lightstreamer.com/docs/ls-server/latest/General%20Concepts.pdf)

### 9. Capture Freeze, Pause/Resume, and Retention Controls

Provide separate controls:

- **Freeze view**: stop rerendering while continuing to capture.
- **Pause capture**: stop retaining new events and show how many were skipped.
- **Resume**: start a new visible capture epoch.
- **Retention policy**: keep all, keep the latest count, or keep a rolling time window.
- **Pinned-event protection**: do not prune pinned events or scenario inputs.

Why it helps:

- High-volume sessions become usable without repeatedly clearing all evidence.
- Freeze-view avoids confusing moving selections while an incident is active.
- Explicit skipped-event counts prevent a paused trace from being mistaken for a complete trace.

### 10. Conditional Event Breakpoints and Watch Rules

Let developers define rules on:

- Client status or server error.
- Subscription, mode, item, listener, key, or command.
- Snapshot/live phase.
- A field changed, matched a value, crossed a numeric threshold, or matched a regular expression.
- Lost updates or a diagnostic severity.

Actions:

- Pause JavaScript with `debugger` immediately before the application listener runs.
- Freeze the Workbench view.
- Pin the event.
- Start or stop a scenario recording window.
- Increment a watch counter without interrupting the page.

Implementation guardrail:

- Pausing is opt-in and should be available as "before listener" or "after listener".
- Listener exceptions and application behavior must still propagate exactly as they do without the extension.

## P1: Diagnostic Depth and Team Workflows

### 11. MERGE, DISTINCT, and RAW State Views With Time Travel

Build reducers analogous to the existing COMMAND index:

- MERGE: current field state per item plus field history.
- DISTINCT: ordered event history, snapshot segment, live segment, and clear-snapshot boundaries.
- RAW: exact delivered order with no reconstructed state claim.
- All modes: scrub to an event and compare state before/after it.

This turns the extension from a COMMAND-specific state workbench into a complete Lightstreamer mode debugger.

### 12. Two-Level COMMAND Dependency Graph and Merged-Row Inspector

Render:

```text
first-level COMMAND item -> key -> implicit second-level MERGE item
```

Show:

- Automatic second-level subscribe on `ADD` and unsubscribe on `DELETE`.
- First-level and second-level fields with clear provenance.
- First-level and second-level Data Adapters.
- Current merged row and per-key lifecycle.
- Second-level lost updates and subscription errors.
- Field-name conflicts and positional resolution.

Important details:

- Internal second-level subscriptions are deliberately omitted from `LightstreamerClient.getSubscriptions()`.
- A second-level update appears through the union of fields and carries `command=UPDATE`.
- Second-level snapshot updates can occur on either side of first-level end-of-snapshot.

Official basis:

- [Subscription two-level behavior](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/Subscription.html)
- [SubscriptionListener second-level callbacks](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/SubscriptionListener.html)
- [ItemUpdate two-level semantics](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ItemUpdate.html)

### 13. Redacted Trace Export/Import and Test-Fixture Generation

Export a versioned capture bundle containing:

- Normalized events.
- Optional raw diagnostics.
- Client/subscription topology.
- Capture epochs and skipped-event markers.
- Scenarios and watch rules.
- Extension and discoverable Web Client versions.

Before download:

- Preview all potentially sensitive fields.
- Offer field-name, value, item, key, URL, message, IP, and header redaction.
- Exclude passwords and authorization-like values unconditionally.

Import should support offline inspection and local scenario editing without contacting a server.

Developer-focused generators:

- Vitest fixture using `ItemUpdate`-like values.
- JSON scenario for Workbench replay.
- Minimal TypeScript subscription configuration.
- Markdown incident summary with diagnostics and timings.

### 14. Field Provenance, Value Semantics, and JSON Patch Inspector

For each field show:

- Current resolved value.
- Value changed in this update.
- Inherited from prior state.
- Never observed.
- Cleared by COMMAND `DELETE`.
- First-level or second-level origin.
- JSON Patch and the reconstructed before/after JSON.

Important limitation:

- At the public API level, `null` may mean explicit null, no value received yet, or a COMMAND delete context. The UI should say "ambiguous null" unless prior state, command context, or optional wire provenance resolves it.

JSON Patch tooling:

- Pretty-print changed paths.
- Verify that applying the patch to the previous JSON produces the received value.
- Compare full-value size with patch size.
- Explain when JSON Patch is unavailable. It is conditional and is not available for RAW mode.

Official basis:

- [ItemUpdate](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ItemUpdate.html)
- [General Concepts: delta delivery and modes](https://lightstreamer.com/docs/ls-server/latest/General%20Concepts.pdf)

### 15. Client-to-Server Message Sequence Waterfall

Instrument `LightstreamerClient.sendMessage` and its listener:

- Outbound message call, masked payload, sequence, delay timeout, and enqueue-while-disconnected setting.
- Processed, denied, discarded, error, or aborted outcome.
- Call-to-outcome latency.
- Lanes grouped by sequence.
- Whether an aborted message was probably put on the network.
- Correlation with connection/recovery state.

Correctness limits:

- `onProcessed` proves successful Metadata Adapter handling, not a later business effect.
- `onAbort(sentOnNetwork=true)` does not prove that the server received or processed the message.
- Message sequence order is unrelated to COMMAND cross-key update order.
- Default `UNORDERED_MESSAGES` does not provide strict ordering.

Privacy:

- Message bodies are arbitrary application data. Mask by default and require explicit reveal/export.

Official basis:

- [LightstreamerClient.sendMessage](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/LightstreamerClient.html)
- [ClientMessageListener](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ClientMessageListener.html)

### 16. Listener Performance, Exception, and Duplicate-Listener Profiler

Measure:

- Synchronous callback duration.
- Count, average, p95, and maximum duration by listener/subscription.
- Callback exceptions with stack traces, recorded before rethrowing.
- Duplicate listener registration.
- Listener add/remove churn.
- Event-loop lag and long-task correlation.

Use it to explain:

- UI jank during update bursts.
- Slow processing near streaming-to-polling fallback.
- Duplicate application updates caused by duplicate listener registration.
- Listeners that were added repeatedly but not removed.

Do not call the result end-to-end latency; the browser does not know when the Data Adapter originated an update unless a reliable application timestamp is present.

### 17. Correlated Lightstreamer Client-Log and TLCP Console

Offer two opt-in levels:

1. Official client logging, filterable by stream, protocol, session, requests, subscriptions, messages, and actions.
2. Decoded TLCP frames correlated with API-level events.

The advanced wire view can explain:

- `SUBOK`, `SUBCMD`, `EOS`, `CS`, `OV`, and updates.
- `PROBE`, `LOOP`, and stream endings.
- Request acknowledgement and errors.
- Recovery `PROG` positions.
- Message completion/failure.
- Wire-level unchanged, null, empty-string, and delta encodings.

Guardrails:

- Detect the negotiated protocol version; do not assume every client uses TLCP 2.5.0.
- TLCP decoding is stateful.
- Tee an application's logger provider rather than silently replacing it.
- Keep raw logging disabled by default.
- Redact credentials, headers, messages, item data, and addresses.
- Continue to treat the public API as the semantic source of truth.

Official basis:

- [LightstreamerClient logging categories](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/LightstreamerClient.html)
- [LoggerProvider](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/LoggerProvider.html)
- [TLCP 2.5.0](https://www.lightstreamer.com/tlcp-2.5.0)

### 18. Multi-Client, Version, Duplicate-Session, and Churn Audit

Detect and explain:

- Multiple clients with the same server/Adapter Set/user fingerprint.
- Mixed discoverable Web Client versions.
- Duplicate or overlapping subscriptions.
- Repeated subscribe/unsubscribe cycles.
- Multiple listeners registered on the same subscription.
- Unusually high client/session counts.

All findings should be heuristic warnings because multiple clients and overlapping subscriptions can be intentional.

Do not propose a new connection-sharing controller. Modern Web Client 9 no longer exposes the older sharing surface; the official changelog says it was discontinued because of increasing browser security restrictions.

Official basis:

- [Web Client changelog](https://github.com/Lightstreamer/Lightstreamer-lib-client-haxe/blob/main/CHANGELOG-Web.md)

## P2: Specialized or Guarded Features

### 19. Cross-Frame, Worker, HTTP Transport, and Bundled-Client Coverage Monitor

Show a capability report:

- MAIN-world constructor hooks found or not found.
- Global, namespace, ESM/bundled, iframe, worker, WebSocket, HTTP streaming, and polling coverage.
- Captured versus possibly missed clients/subscriptions.
- Web Client version when discoverable.
- Reason for API capture versus wire fallback.

This is important for trust in the tool, but implementation is foundational and browser-context heavy.

### 20. Guarded Live QoS and Transport Tuning Lab

Allow explicit, reversible experiments:

- Lower or restore active requested max frequency where the API permits.
- Lower or restore requested session bandwidth.
- Force a transport and compare status/recovery behavior.
- Compare callback rate, changed-field density, bytes, and UI responsiveness before and after.

Guardrails:

- Read-only by default.
- Clearly state that changes issue real client control operations to the server.
- Snapshot, buffer, item, field, selector, and two-level changes require an inactive subscription and should not be silently applied.
- Do not offer active transitions to or from `unfiltered`.
- Always retain and offer restoration of the observed baseline.
- Never imply the client can raise a server-enforced limit.

### 21. Mobile Push Notification Workbench

For applications that use the optional MPN module:

- Device registration and suspension state.
- MPN subscription inventory and status.
- Trigger and notification-format inspection.
- Subscription, modification, unsubscription, and registration errors.
- Correlation between real-time subscription fields and resulting MPN configuration.

This is valuable but specialized and license-dependent, so it should follow the more universal client and subscription tooling.

### 22. Cross-Capture Comparison and Regression Diff

After trace import/export exists, compare two captures:

- Client/connection configuration.
- Subscription sets and schemas.
- Snapshot duration and completeness.
- Error/loss counts.
- Update rates and changed-field density.
- COMMAND end state.
- Scenario outcome.

Primary workflows:

- Working versus broken environment.
- Before versus after client/server upgrade.
- Baseline versus performance regression.
- Production trace versus local reproduction.

## Suggested Delivery Increments

### Increment A: Make Capture Navigable and Explainable

1. Faceted Timeline filters.
2. Freeze, pause/resume, skipped-event markers, and retention limits.
3. Client/session/subscription topology inspector.
4. Capture the missing client listener callbacks and connection properties.
5. Capture full subscription configuration and real max frequency.
6. Unified error explanations.
7. Snapshot phase visualizer.

This increment has the best ratio of developer value to implementation risk.

### Increment B: Make Failures Reproducible

1. Multi-event scenario recorder and replay.
2. Conditional breakpoints and watch rules.
3. MERGE, DISTINCT, and RAW state reducers with time travel.
4. Redacted export/import.
5. Test-fixture generation.

This increment strengthens the product's main differentiator: reproducing streaming behavior without backend cooperation.

### Increment C: Add Deep Lightstreamer Diagnostics

1. QoS, filtering, bandwidth, and loss profiler.
2. Two-level COMMAND graph.
3. Client-message waterfall.
4. Field provenance and JSON Patch tooling.
5. Listener profiler.
6. Opt-in client logs and correlated TLCP.

### Increment D: Expand Coverage and Specialized Workflows

1. Iframes, workers, HTTP streaming/polling, and bundled-client coverage.
2. Live tuning lab.
3. MPN workbench.
4. Cross-capture comparison.

## Capture Surface Changes Required

| Area | Additions |
| --- | --- |
| Client listener | `onServerError`, `onPropertyChange`, `onServerKeepalive` |
| Connection details | Session ID, server instance, server socket, masked client IP, user-presence marker |
| Connection options | Requested/real bandwidth, keepalive, idle/polling, retry, stalled, reconnect, recovery, forced transport, slowing |
| Subscription metadata | Requested buffer, requested max frequency, selector, active/subscribed, second-level fields/schema/Data Adapter |
| Subscription listener | `onRealMaxFrequency`, `onCommandSecondLevelItemLostUpdates`, `onCommandSecondLevelSubscriptionError` |
| Outbound client API | `sendMessage` call and all `ClientMessageListener` outcomes |
| Event envelope | First-class outbound direction, connection/session data, QoS data, diagnostic codes, capture epochs |
| State | Subscription epochs plus MERGE, DISTINCT, RAW, snapshot, connection, and scenario reducers |
| Storage/UI | Structured diagnostic and QoS indexes, faceted filters, retention metadata, imported-capture identity |

## Correctness and Product Guardrails

The UI should never make these claims:

- "Every missing source update was lost." Filtered conflation and suppression can be intentional and silent.
- "COMMAND events preserve order across keys." Per-key lifecycle is the dependable model; cross-key order is not generally guaranteed.
- "End-of-snapshot means every two-level row is complete." Second-level MERGE snapshots can arrive before or after first-level end-of-snapshot.
- "A null API value was explicitly sent." Null has multiple meanings without enough context or wire provenance.
- "Internal second-level subscriptions should appear in `getSubscriptions()`." The API intentionally excludes them.
- "A recovery status proves the exact resumed position." Exact proof requires protocol/session-progress correlation.
- "Raw capture enables real server-stream injection." Synthetic reinjection remains local.

Product boundaries to keep:

- Lightstreamer-native primitives, not application-specific domain models.
- Official Web Client API instrumentation first.
- Raw TLCP as diagnostics, not the only source of truth.
- In-memory/session-local data by default.
- No automatic transmission of captured values.
- No real server event injection.
- Read-only inspection by default; any live client/server control operation must be explicit and reversible.

## Features Not Recommended as Near-Term Core

- A generic WebSocket inspector.
- Real server or Data Adapter injection.
- A privileged server-monitoring/JMX dashboard inside the browser extension.
- Always-on DEBUG protocol logging.
- Automatic live mutation of transport, frequency, bandwidth, subscription, or connection options.
- A connection-sharing controller.
- Application-specific business-object interpretation in the core event model.

## Official Documentation Reviewed

- [Lightstreamer Web Client 9.2.3 API](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/index.html)
- [LightstreamerClient](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/LightstreamerClient.html)
- [ClientListener](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ClientListener.html)
- [ClientMessageListener](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ClientMessageListener.html)
- [ConnectionDetails](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ConnectionDetails.html)
- [ConnectionOptions](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ConnectionOptions.html)
- [Subscription](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/Subscription.html)
- [SubscriptionListener](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/SubscriptionListener.html)
- [ItemUpdate](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ItemUpdate.html)
- [LoggerProvider](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/LoggerProvider.html)
- [General Concepts](https://lightstreamer.com/docs/ls-server/latest/General%20Concepts.pdf)
- [TLCP 2.5.0](https://www.lightstreamer.com/tlcp-2.5.0)
- [Web Client Guide](https://github.com/Lightstreamer/Lightstreamer-lib-client-haxe/blob/main/docs/WebClientGuide.adoc)
- [Web Client changelog](https://github.com/Lightstreamer/Lightstreamer-lib-client-haxe/blob/main/CHANGELOG-Web.md)
