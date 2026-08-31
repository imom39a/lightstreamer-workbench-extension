This roadmap lists planned work. It does not specify release dates.

## Next

### JSON Evidence view

Show each retained row as a normalized Workbench Evidence object. Keep retained order, bounded rendering, Find, Filter, selection, and Context.

### Filter and value inspection

Add controls that create Filter criteria from selected values. Show changed fields, Update Deliveries, Source, JSON Patch data, and ambiguous values without requiring raw Evidence.

### Runtime diagnostics

Connect related recovery events, Session epochs, snapshots, Subscription settings, server errors, keepalives, and loss signals. Show the result in Context or Notifications.

### Client Messages and Server Injection candidate

The repository candidate captures `LightstreamerClient.sendMessage` calls and listener outcomes as outbound Evidence. A reviewed Server Injection sends one Client Message through the inspected client's normal message path. It does not create an inbound Item Update, claim an application result, or retry an Unknown result automatically. Independent Material UI review and release publication remain separate gates.

### Local Injection Scenario release

The Scenario workflow is implemented and verified in the release package. It uses explicit Steps, one target, and immutable Runs. Chrome Web Store review controls public availability. Package verification does not mean that the release is public.

## Later ideas

- Capture import, offline investigation, fixture generation, and cross-capture comparison.
- Listener performance, client-log, protocol, frequency, bandwidth, buffer, and loss diagnostics.
- Broader frame, worker, transport, and bundled-client observation coverage.
- Guarded live tuning and specialized Mobile Push Notification tooling.

These items are not release commitments. Their content and order can change.
