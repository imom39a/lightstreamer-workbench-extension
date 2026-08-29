Use this guide when you have a real Lightstreamer behavior to explain: a row that vanished, an update that arrived out of order, a snapshot that looks incomplete, a Subscription that recovered, or a COMMAND sequence you need to reproduce.

## A repeatable investigation workflow

### 1. Attach before the behavior

1. Open the application page.
2. Open Chrome DevTools and select **Lightstreamer Workbench**.
3. Reload the page if its Lightstreamer client already existed before DevTools opened.
4. Confirm **Capture** is running and read **Coverage** before treating missing Evidence as proof.

Workbench observes clients and Subscriptions owned by the page. It does not connect or subscribe on the application's behalf.

### 2. Choose the investigation boundary

Open **Scope** and choose the smallest runtime object that still contains the behavior:

- **Page** for the complete inspected runtime;
- **client** or **Session** for connection and recovery questions;
- **Subscription** for mode, configuration, snapshot, and COMMAND lifecycle questions;
- **item** or **listener** for one delivery path.

Choosing Scope changes which Evidence belongs to the investigation. Selecting an Evidence row does not silently change Scope.

### 3. Narrow without losing your place

Use each control for its one job:

| Control | What it changes | What it preserves |
| --- | --- | --- |
| **Scope** | Runtime-object boundary | Capture and retained history |
| **Filter** | Visible matching Evidence | Unrelated criteria, selection recovery, and Capture |
| **Find** | Current match position | The visible Evidence set |
| **Selection** | Evidence explained in Context | Scope and Filter |
| **Freeze Evidence** | Whether the view follows new matches | Capture, history admission, and the current historical window |

Start broad enough to see the sequence, then narrow. If a Filter hides the selected event, use the explicit Reveal or Clear selection action rather than assuming the Evidence was removed.

### 4. Read the row before opening details

Each Ordered Evidence row separates:

- retained **Event** order;
- Evidence meaning;
- timestamp, Source, and snapshot/live phase;
- COMMAND operation;
- runtime object;
- COMMAND key when available.

This keeps event identity and time readable without making either carry the whole row. **SERVER**, **LOCAL**, **RUNTIME**, and **WORKBENCH** provenance is always textual.

### 5. Use Context to explain one thing

Select a row to show its update Fields immediately. Expand supporting sections only when needed:

- **Activity summary** for scoped counts, delivery totals, snapshot/live breakdown, and busiest identities;
- **Filter selected Evidence** for typed Include, Exclude, and Around actions;
- **Evidence metadata** for Source, phase, identities, observation path, COMMAND details, and limitations.

With no selected Evidence, Context instead shows the current runtime-object dossier. At compact width, **Back to Evidence** restores the originating row and focus.

## Diagnose a COMMAND lifecycle

1. Choose the COMMAND Subscription or item in Scope.
2. Filter to the relevant item or key.
3. Follow **ADD**, **UPDATE**, and **DELETE** in retained Event order.
4. Check snapshot versus live phase; first-level snapshot completion does not prove every second-level Subscription completed.
5. Clear the selected row when you need the Subscription-level projection summary.
6. Compare **Observed Server COMMAND State** with **Local Effective COMMAND State**.

Observed Server state uses captured Server Updates only. Local Effective state additionally applies successfully delivered Local Injected Updates. A difference is useful comparison Evidence, not proof of an application or server error. Neither projection is Authoritative COMMAND State.

## Triage Notifications without losing Evidence

Open the labelled **Notifications** control in the global footer to review active Workbench conditions and recent Lightstreamer diagnostics across the Panel Session.

- Filter Notifications by Code, Severity, or Affected identity without changing Evidence Scope or Filter.
- Use **Inspect supporting Evidence** when the exact retained Evidence is still available.
- Follow an affected Scope or recovery route when the diagnostic has no supporting event.
- Use **Dismiss** on an active footer condition when it obstructs the workspace.

Dismissal changes presentation only. The condition remains in Notifications until it resolves, its supporting Evidence remains untouched, and a later recurrence can surface again. Stable conditions update one entry instead of piling up duplicates. Event-like diagnostics retain up to 100 recent presentations; Notifications is not a complete persistent log.

## Reproduce behavior with Local Injection

Local Injection delivers an Item Update through the inspected page. It never contacts the Lightstreamer Server.

### One update

1. Select compatible captured Item Update Evidence and choose **Create Local Injection Draft**, or choose **Author COMMAND Item Update** from a compatible live Scope.
2. Confirm the protected target, Session, Source, and local-only boundary.
3. Edit the raw JSON.
4. Resolve validation errors.
5. Use **Compare Source** when the Draft began from captured Evidence.
6. Choose **Review Local Injection** and verify the exact target and payload.
7. Choose **Inject locally**.
8. Read the outcome and correlated **LOCAL** Evidence. A delivered outcome proves the Workbench delivery boundary only; it does not prove an application business effect.

Workbench never silently retargets, retries, or turns a stale or uncertain outcome into success.

### A sequence

Convert a protected Draft into a **Local Injection Scenario** when order matters. Add compatible Steps deliberately; visible or filtered Evidence is never included automatically.

Review freezes one immutable Run with one exact target, Step order, payloads, active-time delays, speed, Checkpoints, and committed-Evidence seed boundary. **Step next**, **Play**, **Pause**, and **Stop** remain serial and visible. Each executed Step creates its own Injection and outcome. **Run again** performs a new Review with fresh Run, Injection, request, and Evidence identities.

Use Checkpoints for Workbench-owned facts such as prior Injection outcomes, correlated Local Evidence, COMMAND key presence, listener counts when supported, and strict primitive field equality. Checkpoints do not execute inspected-page JavaScript or assert arbitrary DOM or server state.

## Freeze, retain, and export Evidence

**Live** follows the newest matching Evidence. **Frozen** preserves the visible window, selection, and scroll anchor while Capture continues. New matching Evidence is counted instead of stealing focus.

One Panel Session owns one temporary Event History:

- normal IndexedDB: up to 100,000 Evidence records or 256 MiB;
- startup memory fallback: up to 5,000 records or 32 MiB.

The first count or byte limit reached controls admission. Complete History extends only through the current History Interval's **Committed Evidence Boundary**. If Capture stops at a journal or capacity boundary, preserve the retained range before closing DevTools.

Use **More actions → Export current Scope** for a versioned JSON snapshot or offline HTML report. Credentials are always excluded; review optional redactions before including complete Evidence.

## Keyboard essentials

- **Tab / Shift+Tab** moves between Workbench surfaces.
- In **Scope**, arrows navigate; Right expands; Left collapses or moves to the parent; Home/End move to visible bounds; Enter or Space commits Scope.
- In **Evidence**, Up/Down select rows; Page Up/Page Down move one viewport; Enter opens or focuses Context.
- In Context disclosures, Enter or Space toggles the focused summary.
- **Control/Command+F** opens Evidence Find when Workbench chrome or Evidence owns focus; inside raw documents and editors it remains document-local.
- Escape clears or closes only the Workbench transient that owns it. It never injects, clears history, changes Scope, or toggles Capture.

Consequential actions—clear, Review, Inject locally, Scenario controls, and export—always retain visible labelled controls.

## When the evidence is incomplete

| What you see | What to do |
| --- | --- |
| **Coverage LIMITED** | Follow the displayed recovery guidance and qualify conclusions drawn from missing properties. |
| No activity | Return to Page Scope, clear Filter, confirm the official Web Client is in use, then reload with DevTools open. |
| Historical or retired Scope | Keep inspecting retained Evidence, but select a current live target before Local Injection. |
| History near capacity | Review the Committed Evidence Boundary and preserve the retained range before Capture stops. |
| In-memory fallback | Open a new Panel Session after restoring IndexedDB when you need normal History Capacity. |
| Local Injection unavailable | Confirm the selected update is compatible, the target is live, and no other protected Draft or Scenario owns the target. |

For deeper recovery steps, continue to [Troubleshooting]({{site}}docs/troubleshooting/). Before posting a report, remove production payloads, private URLs, tokens, customer data, and screenshots containing secrets.
