Local Injection reproduces an Item Update locally against an exact live Subscription target. A standalone Draft delivers one update; a Local Injection Scenario deliberately runs an explicit sequence against the same local-only boundary. Both remain separate from immutable Captured Evidence.

## Start a Draft

Use one of two explicit entry paths:

- Select compatible captured Item Update Evidence and choose **Create Local Injection Draft**.
- Choose a compatible live COMMAND item or key Scope and choose **Author COMMAND Item Update**.

Workbench protects exactly one standalone target-anchored Draft at a time. A Scenario is a separate, mutually protected temporary document. Visible Evidence never joins either document automatically.

## Edit and validate

Raw JSON is the primary editor. The Subscription instance, Session, item identity, Source, Local-only boundary, target lifecycle, and validation state remain protected outside the editable document.

When a Draft began from captured Evidence, **Compare Source** shows the immutable Source and editable Draft without changing either.

## Review and deliver

**Review Local Injection** presents the exact target and local-only delivery boundary. **Inject locally** then attempts one delivery through the inspected page's captured listener or Lightstreamer WebSocket path.

Local Injection does **not** contact the Lightstreamer Server. A delivered outcome proves only the Workbench local-delivery boundary; it does not prove an application business effect.

## Run a Scenario

Convert a protected Draft to a Scenario, then add compatible captured updates or newly authored updates deliberately. One Scenario contains one to 100 explicitly ordered Steps against one exact page, client, Session, Subscription, and listener or wire delivery path. Optional named Checkpoints occupy ordered positions without allocating an Injection. The complete Scenario document, immutable Run plans, and retained Traces stay within an 8 MiB accounted-state limit.

**Review Scenario** validates every Step and freezes the exact target, order, payloads, relative active-time delays, speed, Checkpoints, and committed-Evidence seed boundary into an immutable Run. **Step next**, **Play**, **Pause**, and **Stop** remain serial and visible. Hidden time does not advance the Scenario Clock, and **Run again** performs a new Review with fresh Run, Injection, request, and resulting Evidence identities.

Every Step uses the ordinary one-request/one-result Local Injection boundary. A Run never batches page requests, contacts the server, overlaps Steps, catches up after suspension, loops, retries automatically, rolls back delivered Steps, or suppresses interleaving Server Updates. Target retirement, failed or uncertain delivery, incomplete Evidence settlement, drift requiring re-review, or a failed Checkpoint stops before another Step and marks the remainder **NOT RUN**.

### Checkpoints

Scenario Assertions inspect Workbench-owned facts only: a prior Injection Outcome; attempted, delivered, or listener counts; existence of correlated committed Local Evidence; Local Effective COMMAND key presence or absence; and strict primitive field equality. Equality distinguishes absent fields from present values and compares type and value without coercion. A server-derived public-API `null` is ambiguous, while a concrete `null` from correlated committed Local Evidence can be evaluated.

Listener-count assertions are unavailable for wire delivery. A positive assertion may wait for an explicit active-time `within` duration. Evidence links appear only while the exact committed boundary remains retained. Checkpoints never execute inspected-page JavaScript or assert arbitrary DOM, application, server, diagnostic, or Authoritative COMMAND State.

## Outcomes and stale targets

Invalid or stale Drafts state that no Injection was attempted. Failed, partial, or uncertain outcomes preserve the Draft and say only what Workbench can prove. Workbench never silently retargets, discards, repeats, or broadens an Injection.
