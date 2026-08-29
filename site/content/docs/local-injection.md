Local Injection delivers an Item Update to an exact live Subscription target in the inspected page. A Draft delivers one update. A Local Injection Scenario delivers an ordered sequence. Local Injection does not change captured Evidence.

A Scenario Checkpoint can require a diagnostic after the latest Review. It matches stable diagnostic data, not the displayed message. An optional `within` period uses active Scenario time.

## Start a Draft

Use one of these paths:

- Select compatible captured Item Update Evidence and choose **Create Local Injection Draft**.
- Choose a compatible live COMMAND item or key Scope and choose **Author COMMAND Item Update**.

Workbench protects one standalone Draft at a time. The Draft has one target. A Scenario is a separate temporary document. Workbench does not add visible Evidence to a Draft or Scenario automatically.

## Edit and validate

Use the raw JSON editor to change the update. You cannot edit the Subscription instance, Session, item identity, Source, local-only boundary, target lifecycle, or validation state.

If the Draft uses captured Evidence, **Compare Source** is active by default. This view is the delivery preview: it shows the immutable Source and editable Draft together without changing either one. You can close or reopen the comparison.

## Preview and deliver

Check the target, validation, local-only delivery boundary, and Source-to-Draft difference on the authoring surface. Then select **Inject locally** on that same surface. Workbench freezes and revalidates the Draft and target before making one delivery attempt through a captured listener or the Lightstreamer WebSocket path.

Local Injection does **not** contact the Lightstreamer Server. A delivered outcome proves only that Workbench completed its local delivery. It does not prove an application business result.

## Run a Scenario

Convert a protected Draft to a Scenario. Then add compatible captured updates or authored updates. A Scenario can contain 1 to 100 ordered Steps. All Steps use the same page, client, Session, Subscription, and listener or wire path. A named Checkpoint can have a position between Steps. A Checkpoint does not create an Injection. Scenario data has an 8 MiB limit.

Select **Review Scenario** to validate all Steps. Review creates an immutable Run. The Run contains the target, order, payloads, active-time delays, speed, Checkpoints, and committed-Evidence seed boundary. **Step next**, **Play**, **Pause**, and **Stop** run serially. Hidden time does not advance the Scenario Clock. **Run again** creates new Run, Injection, request, and Evidence identities.

Each Step makes one Local Injection request and gets one result. A Run does not batch requests, contact the server, overlap Steps, repeat Steps, retry, or reverse delivered Steps. Server Updates can occur between Steps. A target change, failed delivery, uncertain delivery, incomplete Evidence commit, required re-review, or failed Checkpoint stops the Run. Workbench marks the remaining Steps **NOT RUN**.

### Checkpoints

Scenario Checkpoints inspect Workbench data only. They can inspect an earlier Injection Outcome, delivery counts, listener counts, related committed Local Evidence, COMMAND key presence, and primitive field values. Field comparison uses the value and data type. It does not convert types. It distinguishes an absent field from a present field. A server-derived public API `null` is ambiguous. A `null` in related committed Local Evidence can be evaluated.

A listener-count Checkpoint is not available for wire delivery. A positive Checkpoint can wait for an active-time `within` period. An Evidence link is available only while Workbench retains the applicable committed boundary. Checkpoints do not run page JavaScript. They do not test arbitrary DOM, application, server, or server COMMAND state.

## Outcomes and stale targets

An invalid or stale Draft does not make an Injection attempt. A failed, partial, or uncertain result keeps the Draft. Workbench reports only the result that it can prove. It does not change the target, discard the Draft, repeat the Injection, or increase its Scope without an explicit action.
