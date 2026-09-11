Use this guide to inspect Lightstreamer activity. For example, use it for a missing row, an update-order problem, an incomplete snapshot, a recovered Subscription, or a COMMAND sequence.

## Inspect Lightstreamer activity

### 1. Open Workbench before the activity

1. Open the application page.
2. Open Chrome DevTools and select **Lightstreamer Workbench**.
3. Reload the page if the Lightstreamer client existed before DevTools opened.
4. Confirm that **Capture** is running.
5. Read **Coverage** before you use missing Evidence as proof.

Workbench observes clients and Subscriptions that the page owns. It does not connect or subscribe for the application.

### 2. Select a Scope

Open **Scope**. Select the smallest runtime object that contains the activity:

- **Page** for the complete inspected runtime;
- **client** or **Session** for connection and recovery questions;
- **Subscription** for mode, configuration, snapshot, and COMMAND lifecycle questions;
- **item** or **listener** for one delivery path.

Scope controls which Evidence is in the view. An Evidence selection does not change Scope.

### 3. Use Scope, Filter, and Find

Each control has one function:

| Control | What it changes | What it preserves |
| --- | --- | --- |
| **Scope** | Runtime-object boundary | Capture and retained history |
| **Filter** | Visible matching Evidence | Other filter criteria, selection recovery, and Capture |
| **Find** | Current match position | The visible Evidence set |
| **Selection** | Evidence explained in Context | Scope and Filter |
| **Freeze Evidence** | Whether the view follows new matches | Capture, history admission, and the current historical window |

First, select a Scope that contains the complete sequence. Then make the Scope smaller. If a Filter hides the selected event, use **Reveal** or **Clear selection**. The Filter does not delete Evidence.

### 4. Read an Evidence row

Each row presents **Op**, the complete **Key / item**, and **Data**. Only Op stays pinned; keys and data remain on one line and scroll horizontally together. **Codes** explains historical codes such as `U`, `EOS`, and `SUBOK`. `ADD` and `DELETE` annotate COMMAND updates, `S` marks snapshots, and **LOCAL** distinguishes Local Injected Updates. Runtime and Workbench activity use `R` and `W`.

**Readable** displays captured JSON object and array strings as structured values, with a **JSON string** marker. **Raw fields** preserves their original types. Large inline previews are bounded and explicitly marked; Context retains the complete payload and exact event identity, timestamp, retained sequence, Source, and phase.

### 5. Inspect one event in Context

Select a row. Context shows its update Fields first. Open a supporting section only when you need it:

- **Activity summary** for scoped counts, delivery totals, snapshot/live breakdown, and busiest identities;
- **Filter selected Evidence** for one Off / Include / Exclude control per value, plus Around actions;
- **Evidence metadata** for Source, phase, identities, observation path, COMMAND details, and limitations.

If no Evidence is selected, Context shows information about the current runtime object. At compact width, **Back to Evidence** returns to the selected row.

## Diagnose a COMMAND lifecycle

1. Select the COMMAND Subscription or item in Scope.
2. Filter to the relevant item or key.
3. Follow **ADD**, **UPDATE**, and **DELETE** in retained Event order.
4. Check the snapshot or live phase.
5. Do not use first-level snapshot completion as proof that each second-level Subscription completed.
6. Select the applicable update.
7. Inspect its Fields, changed fields, Source, and observation path in Context.
8. Review Notifications for lifecycle, lost-update, snapshot, or Capture Coverage diagnostics.

Workbench uses derived COMMAND state for validation, Scenarios, Checkpoints, and diagnostics. Workbench does not show this state as the server COMMAND state.

## Review Notifications

Open **Notifications** in the global footer. The document contains active Workbench conditions and recent Lightstreamer diagnostics for the Panel Session.

- Use Code, Severity, or Affected identity to filter Notifications. These filters do not change Evidence.
- Select **Inspect supporting Evidence** when the related Evidence is available.
- Select the affected Scope or recovery action when the diagnostic has no related event.
- Select **Dismiss** when an active footer condition obstructs the workspace.

Dismiss changes only the footer. The condition stays in Notifications until it ends. Supporting Evidence does not change. A repeated condition can appear again. Stable conditions update one entry. Notifications keeps up to 100 recent event diagnostics. Notifications is not a complete persistent log.

## Test behavior with Local Injection

Local Injection delivers an Item Update in the inspected page. It does not contact the Lightstreamer Server.

### One update

1. Select compatible captured Item Update Evidence, or select a compatible live Scope.
2. Select **Create Local Injection Draft** for captured Evidence, or select **Author COMMAND Item Update** for a live Scope.
3. Confirm the target, Session, Source, and local-only boundary.
4. Edit the raw JSON.
5. Correct each validation error.
6. If the Draft uses captured Evidence, review the Source comparison that opens by default. You can close or reopen it without changing the Draft.
7. Verify the target and payload on the same authoring surface.
8. Select **Inject locally**.
9. Read the outcome and the related **LOCAL** Evidence.

A delivered outcome proves only the Workbench delivery boundary. It does not prove an application business effect.

When you select **Inject locally**, Workbench freezes and revalidates the Draft and target before its one delivery attempt. It does not change the target or retry without an explicit action, and it does not report a stale or uncertain outcome as success.

### A sequence

Use a **Local Injection Scenario** when update order matters. Convert a protected Draft to a Scenario. Add each compatible Step. Workbench does not add visible or filtered Evidence automatically.

Review creates an immutable Run. The Run contains the target, Step order, payloads, active-time delays, speed, Checkpoints, and committed-Evidence seed boundary. **Step next**, **Play**, **Pause**, and **Stop** run serially. Each Step creates one Injection and one outcome. **Run again** creates new Run, Injection, request, and Evidence identities.

Use Checkpoints for Workbench data. This data includes prior Injection outcomes, related Local Evidence, COMMAND keys, supported listener counts, and exact primitive field values. Checkpoints do not run page JavaScript. They do not test arbitrary DOM or server state.

## Send a Client Message with Server Injection

Server Injection uses the inspected application's normal Lightstreamer client-to-server path.

1. Select a captured Client Message and choose **Create Server Injection Draft**, or select a live public-API client and choose **Author Client Message**.
2. Confirm the exact page, client, Session, and `LightstreamerClient.sendMessage` boundary.
3. Edit the message, sequence, optional delay timeout, and enqueue-while-disconnected choice.
4. Resolve validation errors and select **Review Client Message**.
5. Review every send argument, then select **Send Client Message once**.
6. Read the Processed, Denied, Discarded, Aborted, or Unknown outcome and its **WORKBENCH** Evidence.

Processed means Lightstreamer handled the Client Message. It does not prove a downstream business effect or that a later Server Update was caused by the message. Workbench never retries automatically. If the outcome is Unknown, **Prepare separate Repeat…** is a new call and may duplicate server-side effects.

## Freeze, retain, and export Evidence

**Live** follows the newest matching Evidence. **Frozen** keeps the visible window, selection, and scroll position. Capture continues. Workbench counts new matching Evidence and does not move focus.

One Panel Session owns one temporary Event History:

- normal IndexedDB: up to 100,000 Evidence records or 256 MiB;
- startup memory fallback: up to 25,000 records or 128 MiB.

The first count or byte limit stops the admission of new Evidence. Complete History ends at the current History Interval's **Committed Evidence Boundary**. If Capture stops, preserve the retained range before you close DevTools.

Select **More actions → Export current Scope** to create a versioned JSON snapshot or an offline HTML report. Workbench always excludes credentials. Review the optional redactions before you include complete Evidence.

## Keyboard essentials

- **Tab / Shift+Tab** moves between Workbench surfaces.
- In **Scope**, arrows navigate; Right expands; Left collapses or moves to the parent; Home/End move to visible bounds; Enter or Space commits Scope.
- In **Evidence**, Up/Down select rows; Page Up/Page Down move one viewport; Enter opens or focuses Context.
- In Context disclosures, Enter or Space toggles the focused summary.
- **Control/Command+F** opens Evidence Find when Workbench chrome or Evidence owns focus; inside raw documents and editors it remains document-local.
- Escape clears or closes the active Workbench transient. It does not inject, clear history, change Scope, or change Capture.

Clear, Review, Inject locally, Send Client Message once, Scenario, and export actions always have visible labels.

## When the evidence is incomplete

| What you see | What to do |
| --- | --- |
| **Coverage LIMITED** | Do the displayed recovery action. State the limit when you use missing properties in a conclusion. |
| No activity | Return to Page Scope, clear Filter, confirm the official Web Client is in use, then reload with DevTools open. |
| Historical or retired Scope | Keep inspecting retained Evidence, but select a current live target before Local Injection. |
| History near capacity | Review the Committed Evidence Boundary. Preserve the retained range before Capture stops. |
| In-memory fallback | Open a new Panel Session after restoring IndexedDB when you need normal History Capacity. |
| Local Injection unavailable | Confirm the selected update is compatible, the target is live, and no other protected Draft or Scenario owns the target. |
| Server Injection unavailable | Select a live official public-API client with a current Session, and close any protected Local Draft or Scenario first. Reload with DevTools open if the page bridge is stale. |

For more recovery procedures, see [Troubleshooting]({{site}}docs/troubleshooting/). Remove private data before you post a report. This data includes production payloads, private URLs, tokens, customer data, and screenshots that contain secrets.
