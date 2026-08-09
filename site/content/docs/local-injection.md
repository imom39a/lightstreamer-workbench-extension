Local Injection reproduces one Item Update locally against an exact live Subscription target. It is separate from immutable Captured Evidence.

## Start a Draft

Use one of two explicit entry paths:

- Select compatible captured Item Update Evidence and choose **Create Local Injection Draft**.
- Choose a compatible live COMMAND item or key Scope and choose **Author COMMAND Item Update**.

Workbench protects exactly one target-anchored Draft at a time. Visible Evidence never joins that Draft automatically.

## Edit and validate

Raw JSON is the primary editor. The Subscription instance, Session, item identity, Source, Local-only boundary, target lifecycle, and validation state remain protected outside the editable document.

When a Draft began from captured Evidence, **Compare Source** shows the immutable Source and editable Draft without changing either.

## Review and deliver

**Review Local Injection** presents the exact target and local-only delivery boundary. **Inject locally** then attempts one delivery through the inspected page's captured listener or Lightstreamer WebSocket path.

Local Injection does **not** contact the Lightstreamer Server. A delivered outcome proves only the Workbench local-delivery boundary; it does not prove an application business effect.

## Outcomes and stale targets

Invalid or stale Drafts state that no Injection was attempted. Failed, partial, or uncertain outcomes preserve the Draft and say only what Workbench can prove. Workbench never silently retargets, discards, repeats, or broadens an Injection.
