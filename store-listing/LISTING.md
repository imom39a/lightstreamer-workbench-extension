# Chrome Web Store Listing Draft

## Basic Listing

Name:

```text
Lightstreamer Workbench
```

Summary, 91 characters:

```text
Inspect Lightstreamer activity and test Item Updates or Client Messages in Chrome DevTools.
```

Category:

```text
Developer Tools
```

Language:

```text
English (United States)
```

Homepage URL:

```text
https://imom39a.github.io/lightstreamer-workbench-extension/
```

Support URL:

```text
https://imom39a.github.io/lightstreamer-workbench-extension/support/
```

Privacy policy URL:

```text
https://imom39a.github.io/lightstreamer-workbench-extension/privacy/
```

## Detailed Description

The description and reviewer instructions below are prepared for extension 2.0.9 with matching companion 0.1.8. The same product version is prepared separately for Firefox. Current upload, submission, and public availability must be verified in the publisher dashboard. Historical records below retain their original versions.

```text
New in 2.0.9: expanded MCP investigation, richer COMMAND and stream queries, and agent-prepared Server Injection with human approval of the exact Client Message before one send. Companion 0.1.8 supports Chrome and desktop Firefox through one local companion. Both extensions use the same product version.

Lightstreamer Workbench adds a Chrome DevTools panel for applications that use the official Lightstreamer Web Client.

It captures clients, Sessions, Subscriptions, listeners, Item Updates, snapshots, and COMMAND key lifecycles. The workspace has Runtime Scope, Ordered Evidence, and Context.

Key features:

- Select the page, client, Session, Subscription, item, or listener in Runtime Scope. You can inspect retired objects, but you cannot use them as Local Injection targets.
- Read compact operation codes, complete single-line keys, and captured data in retained order. Op stays pinned while keys and data scroll horizontally. Open Codes for the Lightstreamer and Workbench lifecycle reference.
- Read JSON string fields in a clearly marked readable view, or use Raw fields to preserve captured types. Complete data and exact event metadata remain in Context.
- Use a consistent Off / Include / Exclude control for Evidence and notification filters. Workbench uses dark mode in every system appearance.
- Use Find, Filter, selection, Capture, Coverage, and Live or Frozen independently.
- Select an event to inspect its Fields, raw Evidence, Source, COMMAND details, and limits in Context.
- Capture outbound Client Messages and their normal listener outcomes as ordered Evidence.
- Review active conditions and recent Lightstreamer diagnostics in Notifications. Dismiss hides only the footer message.
- Trace COMMAND `ADD`, `UPDATE`, and `DELETE` operations. Use Fields, diagnostics, and Checkpoints for more detail.
- Create one protected Local Injection Draft from captured Evidence or from a live COMMAND Scope.
- Edit raw JSON and validate the Draft. Captured Drafts compare Source and Draft by default, then inject directly from that preview.
- Search captured updates for the exact Scenario target, select a batch, and add it explicitly. Review ordered Steps and Checkpoints in a queue with one focused editor. Scenarios retain immutable reviewed Runs, serial controls, and results for each Step.
- Connect a local MCP companion to inspect a Panel Session's Scope, Evidence, diagnostics, and Local Injection Scenario results. Agents can profile and query streams, validate candidates, prepare Scenarios, and inspect Scenario traces. Agents can prepare Server Injection, but a person must approve the exact Client Message and send arguments in the panel before one send. Duplicate requests return the existing receipt, and Unknown outcomes are never retried automatically. Agents cannot clear Event History or evaluate arbitrary page code.
- When a panel opens, Agent access is on by default with inspection and Local Injection available together. There is no read-only mode. The header shows On, Waiting, or Off and opens the access control under More actions → Agent access and setup. Authentication is off; any local process that can reach the companion can use the connected panel's grant. Run Chrome and the Node.js 22.12+ companion on the same computer.
- Deliver an Item Update to the exact live Subscription in the inspected page. Workbench reports delivered, failed, partial, unknown, and stale-target results.
- Create a protected Server Injection Draft from captured Client Message Evidence, author one for an exact live client and Session, or start from an application-owned Message Recipe.
- Review every LightstreamerClient.sendMessage argument, then send the Client Message once through the inspected application's normal client-to-server path.
- Treat Processed as a Lightstreamer message outcome, not proof of an application business effect or later Server Update. Workbench never retries an Unknown outcome automatically.
- Use WebSocket/TLCP fallback diagnostics when the primary Web Client instrumentation is not available.
- Keep one temporary Event History for each Panel Session. IndexedDB can keep 100,000 records or 256 MiB. The memory fallback can keep 25,000 records or 128 MiB.
- Use the Committed Evidence Boundary to find the end of complete History. Retention removes the oldest accepted prefix while Capture continues and reports the Retention Advance. An Evidence Gap means captured activity could not be accepted into Event History.
- A controlled Close tries to erase Event History. An abnormal stop can leave residual data until Chrome runs the extension again. A new Panel Session starts empty.
- Configured production builds use usage analytics for fixed feature names, engagement time, coarse outcomes, and a random installation identifier. It is on by default and can be turned off in More actions → Help & resources → Usage analytics. Captured Evidence and typed text are excluded from analytics; separate Agent access can send requested Evidence to a local MCP client and its configured model provider.
- No advertising, account sign-in, or maintainer-operated collection backend.
- Help links open the project documentation, privacy policy, and support page.

Use this extension to inspect and test Lightstreamer behavior in Chrome DevTools.
```

## Screenshot Upload Order

Remove every legacy screenshot that shows the retired three-section interface before uploading this 2.0 set.

1. `screenshots/01-workspace-context.png`
   - Caption: Select a Runtime Scope. Read events in order. Inspect the selected update Fields in Context.
2. `screenshots/02-ordered-evidence-context.png`
   - Caption: Inspect the complete raw Evidence, Source, and Lightstreamer runtime context for an event.
3. `screenshots/03-local-injection-editor.png`
   - Caption: Compare, edit, validate, and inject one protected Local Injection Draft from the same preview.
4. `screenshots/04-agent-access.png`
   - Caption: Connect a local MCP agent to inspect Evidence and prepare reviewed Local Injection Scenarios.
5. `screenshots/05-server-injection.png`
   - Caption: Review the exact client, Session, and sendMessage arguments before one deliberate Client Message send.

## Graphic Assets

Store icon:

```text
store-listing/icons/icon-128.png
```

Small promo tile:

```text
store-listing/promo/small-promo-tile.png
```

Marquee promo tile, optional:

```text
store-listing/promo/marquee-promo-tile.png
```

## Release Notes Draft

Version:

```text
2.0.9
```

What's new:

```text
Expanded MCP investigation and reviewed Client Message sending, paired with companion 0.1.8. Adds matching desktop Firefox support as a separate Mozilla Add-ons release.

- Read richer stream, COMMAND, provenance, and bounded Evidence queries.
- Prepare exact Server Injection Client Messages through MCP; require human panel review and approval before one send.
- Preserve duplicate receipts, explicit uncertainty, and no automatic retry.
- Use one companion for Chrome and Firefox with exact Panel Session routing.
- Firefox requires installation consent for captured-data sharing and starts analytics Off behind optional native consent and the Workbench preference.
- Chrome permissions and analytics defaults are unchanged.
```

## Privacy Practices Draft

```text
Lightstreamer Workbench processes inspected-page Lightstreamer event data in the browser extension context. Each Panel Session owns one temporary Event History. IndexedDB can keep 100,000 Evidence records or 256 MiB. The memory fallback can keep 25,000 records or 128 MiB. After bounded journal retries fail, Workbench continues in memory for the rest of the Panel Session and reports the storage change and failure reason. Workbench does not send captured Evidence to maintainers or an analytics service. Agent access separately sends requested Evidence to a local MCP client and may send it to that client's configured model provider. Client Message bodies remain redacted in agent results.

Complete History ends at the current History Interval's Committed Evidence Boundary. Retention removes the oldest accepted prefix while Capture continues and reports a Retention Advance, not an Evidence Gap. An Evidence Gap means captured activity could not be accepted into any canonical Event History segment. Clear makes an exact History Interval cut. A controlled Close tries to erase Event History. An abnormal stop can leave residual data until Chrome runs the extension again. A new Panel Session starts empty and does not load earlier Evidence. Capture, Coverage, History Capacity, and Live or Frozen are independent. The memory fallback does not reduce Coverage by itself.

The analytics candidate sends fixed Workbench feature names, foreground engagement time, coarse outcomes, extension version, event time, and a random installation identifier to Google Analytics 4. Analytics is enabled by default in configured builds. More actions → Help & resources → Usage analytics provides a persistent off switch. Turning it off stops collection and removes the identifier and analytics session. Captured Evidence, payloads, inspected URLs, search text, clipboard/export content, and raw errors are excluded from analytics. Agent access is separate: it sends requested Evidence to the local MCP client and may send it to that client's configured model provider. Agent access is on by default for inspection and Local Injection; authentication is off. Any local process that can reach the companion may use a connected panel's grant. Workbench does not sell data, use analytics for advertising, require sign-in, or operate a maintainer collection server.

Workbench uses host and page access to observe the official Lightstreamer Web Client. It also uses this access for Local Injection in the inspected page. Local Injection does not contact the Lightstreamer Server. Workbench creates a JSON or offline HTML export only when the user requests it. Each export excludes credentials and creates a local download. Agent access uses a loopback connection on port 24817 and requires no additional Chrome permission. Access is enabled by default in an open panel, with authentication off. Any local process that can reach the companion can use the panel grant. Requested Evidence can reach the configured MCP client's model provider.
```

Privacy questionnaire note:

```text
For the analytics candidate, declare collection of user activity and the pseudonymous installation identifier in the dashboard's applicable categories. Describe the fixed product events, Google Analytics recipient, default-on behavior, and off switch. Do not claim that all data stays on the device. Captured website content, message bodies, credentials, browsing history, search text, and raw errors are excluded from analytics. Disclose separately that Agent access can send requested Evidence to the local MCP client and its configured model provider. State that Agent access is on by default for inspection and Local Injection, authentication is off, and any local process with access to the loopback companion can use a connected panel grant. Explain storage permission for preferences/identity and https://www.google-analytics.com/* host access for Measurement Protocol. Keep dashboard answers, listing, and policy consistent before publishing. Earlier no-analytics releases retain their original disclosures.
```

Single purpose description:

```text
Provide a Chrome DevTools panel that observes official Lightstreamer Web Client activity, reconstructs runtime and COMMAND Evidence, and lets developers test Item Updates locally or send reviewed Client Messages through the inspected client's current Session.
```

Storage permission justification:

```text
The storage permission keeps the user's usage-analytics preference and a random installation identifier. Turning analytics off removes the identifier and analytics session. It is not used for captured Lightstreamer Evidence; each Panel Session owns a temporary Event History in IndexedDB with a bounded memory fallback.
```

Host permission justification:

```text
Page access is required to run packaged instrumentation at document_start before the application creates Lightstreamer clients or Subscriptions. It observes the official Web Client, captures outbound Client Messages, and supports developer-requested Local Injection. https://www.google-analytics.com/* is used only by the packaged service worker to send fixed usage events while enabled. Captured Evidence, payloads, inspected URLs, search text, Drafts, and raw errors are excluded. No remote code is loaded.
```

## Reviewer Test Instructions

```text
No account required. On a page using the official Lightstreamer Web Client, open DevTools > Lightstreamer Workbench. Select captured Evidence for Local Injection, or explicitly add updates to a Scenario queue. Server Injection reviews one Client Message before send. Agent access starts on. Test MCP with companion 0.1.8: https://www.npmjs.com/package/lightstreamer-workbench-agent/v/0.1.8. Setup: https://imom39a.github.io/lightstreamer-workbench-extension/docs/agent-access/.
```

For Store MCP review, extract the configured candidate `release/lightstreamer-workbench-v2.0.9.zip` and load it unpacked; record its assigned extension ID. Generate setup from npm:

```sh
npx --yes lightstreamer-workbench-agent@0.1.8 setup --extension-id YOUR_UNPACKED_EXTENSION_ID
```

Copy the printed MCP configuration into the test agent app and start its stdio server. The app starts the companion; no additional terminal or hosted server is needed. On Windows, use `npx.cmd`. The [matching public release](https://github.com/imom39a/lightstreamer-workbench-extension/releases/tag/agent-v0.1.8) includes a ready-built unpacked extension, the same tested companion tarball, source provenance, and SHA-256 checksums. Use both components from this release. Ask the agent to call `list_panel_sessions`, choose the reviewed tab, and call `get_status` before reading Evidence or testing Local Injection. Agent-prepared Server Injection must be reviewed and explicitly approved in the panel; approval alone does not send. Repeat execution with the same request ID retrieves the existing receipt.

## Version 2.0.9 Release Checklist

- [ ] Land the reviewed Chrome and Firefox support on `main` before Store packaging/submission.
- [ ] Pass local unit, type, panel, loaded-extension, official-client/MCP, and Firefox native-consent gates; record independent UI review.
- [ ] Verify the same companion tarball across Windows, macOS, Linux, Firefox stable, the minimum version, and supported ESR lines.
- [ ] Publish and independently verify companion 0.1.8 and matching ready-built Chrome bundle.
- [ ] Build Chrome and Firefox Store ZIPs at 2.0.9 from the same source; audit manifests, sizes, integrity, and SHA-256.
- [ ] Produce the Firefox reviewer source ZIP and reproduce its build exactly.
- [ ] Publish matching documentation and policy; audit each Store's privacy and permission disclosures.
- [ ] Upload and submit Chrome 2.0.9 with automatic publication after approval.
- [ ] Complete the separate first manual AMO submission using `FIREFOX.md` and its reviewer instructions.
- [ ] Record each Store's verified submission/review/publication status separately.

## Version 2.0.8 Release Checklist

- [x] Confirm published Store 2.0.7 and npm `latest` 0.1.6 before allocating new versions.
- [x] Pass the complete local release package gate and inspect ZIP integrity, size, digest, and manifests.
- [x] Regenerate and inspect current Store/site screenshots; keep pixel-identical brand assets.
- [x] Prepare current description, release notes, and version-pinned 0.1.7 reviewer instructions.
- [x] Publish the exact companion tarball after Windows, macOS, and Linux checks; verify provenance, source, integrity, and npm `latest`.
- [x] Publish and verify the matching 2.0.8 download and checksums.
- [x] Upload the configured Store ZIP and confirm upload success.
- [ ] Save and verify the refreshed Store description, reviewer instructions, and screenshots after publisher passkey verification.
- [x] Verify unchanged manifest permissions and maintained public-policy boundaries; retain existing privacy answers. The private questionnaire was not re-audited.
- [x] Submit with automatic publication after approval at 100% distribution and verify 2.0.8 `PENDING_REVIEW` through a separate API read.
- [x] Restore the npm publication guard to `false` and update public setup guidance.
- [ ] Verify Google approval and actual public availability of 2.0.8.

## Version 2.0.7 Release Checklist (historical)

- [x] Push reviewed product source `c0f250cba93d5399553f201d9995cd284be1bd26` to `main`.
- [x] Pass the local package, official-client/MCP, panel browser, and asset-review gates.
- [x] Verify the exact npm companion on Windows, macOS, and Linux.
- [x] Publish and verify companion 0.1.5 with source provenance and matching integrity.
- [x] Publish and verify the ready-built 2.0.7 extension bundle and checksums.
- [x] Upload the configured 516,955-byte 2.0.7 ZIP; API upload succeeded.
- [x] Save the detailed description and 0.1.5 reviewer instructions above in the dashboard.
- [x] Retain the existing five Store screenshots as requested by the maintainer; Agent access stays fourth.
- [x] Confirm existing privacy answers and permission justifications agree with this release.
- [x] Submit with automatic publication after approval and 100% distribution.
- [x] Verify 2.0.7 pending review and 2.0.6 published through the API and refreshed dashboard.
- [x] Verify Google approval and actual public availability of 2.0.7; publisher API and public listing confirmed on October 2, 2026.

The maintainer resumed publishing on September 30, 2026 and chose to keep the current Store screenshots. No screenshot was removed or uploaded. Prepared replacement images remain in this directory for a future update. The exact configured Store ZIP, upload, and review submission are recorded in [`RELEASE.md`](../RELEASE.md).

## Version 2.0.2 Release Checklist (historical)

- [x] Confirm `public/manifest.json` version matches `package.json`.
- [x] Run `npm run release:package`.
- [x] Upload `release/lightstreamer-workbench-v2.0.2.zip`.
- [x] Upload `public/icons/icon-128.png` as the store icon.
- [x] Upload all four screenshots in the order listed above.
- [x] Upload `store-listing/promo/small-promo-tile.png`.
- [x] Optionally upload `store-listing/promo/marquee-promo-tile.png`.
- [x] Confirm the package-derived summary and paste the detailed description from this file.
- [x] Review the privacy practices answer before submission.
- [x] Remove the retired product-usage analytics and identifier declarations from the dashboard privacy fields.
- [x] Confirm the packaged build contains no analytics endpoint, configuration, event, or identifier residue.
- [x] Confirm the packaged Manifest V3 has no new storage permission and no `unlimitedStorage` declaration.
- [x] Confirm the final Event History real-Chrome report is `PASS`, or retain the explicit maintainer-accepted `REVIEW` disposition in the internal Project ticket; a `FAIL` blocks publication.
- [x] Confirm the privacy policy URL is `https://imom39a.github.io/lightstreamer-workbench-extension/privacy/`.
- [x] Confirm the support URL is `https://imom39a.github.io/lightstreamer-workbench-extension/support/`.
- [ ] Confirm the homepage URL is `https://imom39a.github.io/lightstreamer-workbench-extension/` and staged publishing remains enabled.

## Version 2.0.3 Preparation Checklist (historical)

- [x] Confirm `public/manifest.json`, `package.json`, and the package lock use version `2.0.3`.
- [x] Run `npm run analytics:validate` with the dedicated production measurement configuration and confirm the DebugView probes.
- [x] Run `npm run store:assets` and inspect all five current screenshots, including Server Injection Review.
- [x] Run `npm run release:package` and record the ZIP size, integrity result, and SHA-256.
- [x] Run `npm run docs:check` and `npm run test:site`.
- [x] Publish the matching website and privacy policy before submitting the Store candidate.
- [x] Upload `release/lightstreamer-workbench-v2.0.3.zip` as a draft.
- [x] Replace the Store description, reviewer instructions, icon, five screenshots, and promo tiles from this directory; keep the release notes above ready for submission.
- [x] Update the privacy questionnaire for usage analytics, the random installation identifier, captured website content, `storage`, and Google's collection host.
- [x] Confirm the homepage, support, and privacy policy URLs.
- [ ] Confirm staged publishing during the later Store review submission.
- [x] Obtain the Material UI visual-QA disposition; maintainer approval is still required before Store review submission.

## Version 2.0.4 Preparation Checklist (historical)

- [x] Include all maintainer-authorized pending changes and the prior capture reliability, filter and dark-mode fixes.
- [x] Confirm package, lockfile and manifest version `2.0.4`, with unchanged permissions.
- [x] Regenerate and independently review all five 1280×800 screenshots from the production component.
- [x] Prepare the matching description and release notes above.
- [x] Verify the full unit suite, official-client journeys, extension reload and 100,500-event rolling-capacity proof.
- [x] Build and audit `release/lightstreamer-workbench-v2.0.4.zip`: 467,424 bytes; ZIP integrity passes.
- [x] Record SHA-256: `ba105d4cf2319ebd787b7a168a025cdb26d712a083fc08693fe9fb61cf896433`.
- [ ] Upload the package through the existing Chrome publisher session.
- [ ] Replace the description and five screenshots, save, and submit for Store review.
- [ ] Verify the Store's actual review/publication status.

The maintainer explicitly authorized this release. The Chrome session currently requires the Mac to be unlocked; version 2.0.4 has not been uploaded or submitted. Detailed verification is recorded in [`key-json-stream-evidence.md`](../docs/agents/key-json-stream-evidence.md).

## Version 2.0.5 Preparation Checklist

- [x] Prepare the listing and privacy disclosures for the 2.0.5 repository candidate.
- [x] Prepare the MCP reviewer steps using a local companion tarball and matching unpacked extension.
- [x] Verify the configured Store ZIP, release checks, and package provenance recorded in `RELEASE.md`.
- [x] Upload the 2.0.5 package as an unpublished Store draft.
- [x] Replace the fourth Store screenshot with Agent access and save the release note in the description.
- [x] Verify the public MCP companion release download, digest, local installation, and setup guide before Store review.
- [x] Upload the matching extension package.
- [x] Submit the revision for Store review with automatic public publishing after approval.
- [ ] Verify the actual Chrome Web Store review and publication status.

Version-pinned `npx` setup resumed with npm companion 0.1.4 on September 30, 2026. The original public tarball and local setup remain available for this Store submission.

The 2.0.5 submission was canceled on September 29, 2026 while still pending review. Version 2.0.6 supersedes it with the MCP context-budget fixes; 2.0.4 remains the published version.


## Version 2.0.6 Release Checklist

- [x] Cancel the pending 2.0.5 Store submission after verifying 2.0.4 remains published.
- [x] Build and verify the configured 2.0.6 Store ZIP and matching 0.1.3 companion.
- [x] Pass cross-platform installed-artifact checks and bundle assembly.
- [x] Publish the exact tested companion tarball and bundle, then verify anonymous download and local setup.
- [x] Upload 2.0.6 and submit with automatic public publishing after approval at 100% distribution.
- [x] Verify 2.0.6 `PENDING_REVIEW` and 2.0.4 `PUBLISHED` through the Store API.
- [ ] Refresh the Store description and reviewer fields from the maintained text after the Mac is unlocked. Existing fields remain saved; the public guide and superseded-release notice point to 0.1.3.
- [ ] Verify Google approval and actual public availability of 2.0.6.
