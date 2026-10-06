# First Firefox release: 2.0.9

This is the manual public Mozilla Add-ons submission. Build from the reviewed
`main` revision used for Chrome 2.0.9. The listed submission completed on
October 6, 2026 and shows **Awaiting Review**. Its version ID is `6548853`,
file ID `5092992`, and permanent add-on ID was accepted. The planned public
URL is <https://addons.mozilla.org/en-US/firefox/addon/lightstreamer-workbench/>;
public availability and signed-install proof remain pending.

## Publisher and package

- Mozilla publisher: `imom39a`, owned by the maintainer; 2FA and recovery are set up.
- Permanent add-on ID: `lightstreamer-workbench@imom39a` (an identifier, not an email address).
- Name: **Lightstreamer Workbench**.
- Summary: **Inspect Lightstreamer activity and test Item Updates or Client Messages in Firefox developer tools.**
- Category: **Web Development** (choose the equivalent developer-tools category offered by AMO).
- Language: English (United States).
- License: Apache License 2.0.
- Platform: desktop Firefox 140+ on Windows, macOS, and Linux; private browsing disabled.
- Distribution: public listing on addons.mozilla.org, automatic public availability after approval if offered.
- Extension ZIP: `release/lightstreamer-workbench-firefox-v2.0.9.zip`.
- Reviewer source ZIP: `release/lightstreamer-workbench-firefox-source-v2.0.9.zip`.
- Icon: `public/icons/icon-128.png`.
- Screenshots: the five shared Workbench panel screenshots in `store-listing/screenshots/`, in the order recorded in [LISTING.md](LISTING.md).
- Homepage: <https://imom39a.github.io/lightstreamer-workbench-extension/>.
- Support: <https://imom39a.github.io/lightstreamer-workbench-extension/support/>.
- Privacy: <https://imom39a.github.io/lightstreamer-workbench-extension/privacy/>.

## Description

```text
Lightstreamer Workbench adds a developer-tools panel for applications using the official Lightstreamer Web Client.

Inspect clients, Sessions, Subscriptions, listeners, Item Updates, snapshots, COMMAND key lifecycles, and outbound Client Messages. Select Runtime Scope, read Ordered Evidence, and inspect complete Context. Find, Filter, Capture, Coverage, and Live/Frozen investigation work independently.

Create protected Local Injection Drafts from captured updates or live COMMAND targets. Edit and validate raw JSON, then deliver an Item Update locally through the application's normal listeners. Compose ordered Scenarios with Steps and Checkpoints. Local Injection does not contact Lightstreamer Server; application listeners may still cause effects.

Review Server Injection Client Messages and every send argument before one deliberate call through the page-owned client's current Session. This does not create an inbound Server Update. Processed describes the message outcome, not a downstream business effect. Unknown outcomes are never retried automatically.

Optionally connect the local npm MCP companion, lightstreamer-workbench-agent 0.1.8. One companion serves Chrome and Firefox panels. Agents can inspect retained Evidence, query COMMAND/stream state, prepare Local Injection Scenarios, and prepare Server Injection. Each agent Server Injection requires a person's approval of the exact message and send arguments in the panel before one send. Repeated requests retrieve the receipt. No arbitrary page evaluation or history clearing is exposed through MCP.

Each Panel Session owns a temporary rolling Event History: up to 100,000 records or 256 MiB in IndexedDB, or 25,000 records or 128 MiB in memory fallback. Retention removes the oldest accepted prefix while Capture continues. Controlled Close attempts erasure; abnormal termination may leave residual data until a safe cleanup. A new panel starts empty. JSON and offline HTML exports are deliberate local downloads.

Firefox requires installation consent for sharing captured application data with the local companion and configured MCP client/model provider. Arbitrary application fields may contain sensitive information. Agent access starts On for a new panel and can be turned Off. Local authentication is off; use a trusted development computer.

Usage analytics starts Off. It sends fixed Workbench feature names, engagement time, coarse outcomes, version, event time, and a random installation identifier to Google Analytics only after both optional Firefox permission and the Workbench setting allow it. Captured Evidence, inspected URLs, and typed text are excluded. Cancel or Deny leaves analytics Off and Workbench usable. Opt-out or native permission removal stops collection and erases analytics identifiers.

Desktop Firefox 140+ only; private browsing is disabled. No advertising, account sign-in, remote executable code, or maintainer collection server. Read the privacy policy before sharing application data.
```

## Reviewer instructions

No Workbench account, subscription, or paid service is required. Install the
submitted extension in regular desktop Firefox, open a page using the official
Lightstreamer Web Client, open developer tools, and select **Lightstreamer
Workbench**. Reload the page if the client existed before opening the panel.
Check Capture and Coverage, select an Item Update, and inspect its Context.
The public [Lightstreamer Stock List demo](https://demos.lightstreamer.com/StockListDemo/)
can be used for inspection; do not send arbitrary Server Injection messages to
that public service. Local Injection may affect that page's displayed values.

Capture does not alter the application's original updates/messages. Local
Injection delivers a marked local update through captured listeners. Server
Injection needs a developer-authorized test application and its message contract.
The repository contains a deterministic official-client/server fixture for
those checks; its developer procedure is in [Firefox verification](../docs/firefox-testing.md).
The test driver creates disposable profiles and must never be used on a personal
Firefox profile or publisher account.

For MCP, install Node.js 22.12+ with npm on the same computer. Run
`npx --yes lightstreamer-workbench-agent@0.1.8 setup` (`npx.cmd` on Windows).
Copy its printed configuration into a local stdio MCP client and start it.
No Firefox ID override is needed. Ask `list_panel_sessions`, select the exact
`panelSessionId`, then call `get_status` and a bounded Evidence query. Turn
Agent access Off in the panel and confirm the session is no longer available.
Use the matching published companion, not an older Chrome-only package.

For analytics, open **More actions → Help & resources → Usage analytics**.
It starts Off. Selecting On opens a consent window; **Request Firefox permission**
opens Firefox's native optional permission prompt. Cancel or Deny leaves it Off;
Allow enables it only together with the Workbench preference. Turn the control
Off to stop collection and erase analytics identifiers. Removing native
permission also stops collection. Capture remains available without analytics.

The source ZIP includes locked dependencies and exact build instructions. Run
`npm ci` followed by `npm run build:firefox` under the recorded Node 24 version,
then compare all `dist-firefox/` files with the extension ZIP. Its analytics
configuration is only the ingestion configuration already embedded in the
submitted extension, with no publisher or account credentials. Executable code
is bundled locally. Generated React DOM `innerHTML` warnings are framework code;
application data is rendered as text. The Android minimum-version warning is
outside this desktop-only release.

## Data declarations

Required native sharing categories cover `websiteContent`, `browsingActivity`,
`personallyIdentifyingInfo`, `healthInfo`, `financialAndPaymentInfo`,
`authenticationInfo`, `personalCommunications`, and `locationInfo`. Arbitrary
captured fields shared through MCP can contain these categories; redaction of
recognized credentials does not guarantee their absence. The recipient is the
local companion and configured MCP client/model provider, not the maintainers
or analytics. The user explicitly accepts required consent at installation
and can disable Agent access per panel.

Optional `technicalAndInteraction` is exclusively fixed usage analytics sent
to Google Analytics after native consent and the Workbench preference. The
public policy explains recipients, defaults, controls, temporary retention,
abnormal-cleanup limitations, deliberate exports, and reviewed Server Injection.
Use the same disclosure in AMO privacy fields; do not claim all data stays local.

## Manual checklist

- [x] Confirm the reviewed source is on `main` and both browser versions are 2.0.9: `55f9cdee7be1ec02154cb81f929fb5cb17c7981d`.
- [x] Confirm local and CI gates, independent UI review, and maintainer privacy/release authorization.
- [x] Confirm companion 0.1.8 is published and verified on npm and GitHub.
- [x] Build/audit the extension ZIP and reproduce all 30 reviewer-source output files exactly under Node.js 24.19.0.
- [x] Deploy and verify the matching public documentation and privacy policy.
- [x] Sign in to the existing AMO Developer Hub; start a new public add-on submission.
- [x] Account prompts completed; AMO did not present a new binding Distribution Agreement acceptance step in this submission. The maintainer had already confirmed personal policy/agreement review.
- [x] Upload the extension ZIP; inspect every validator result and ID/version: zero errors, three explained warnings, zero notices.
- [x] Upload reviewer source, description, Apache-2.0 license, shared icon/five screenshots with captions, homepage/support/privacy resources, release notes, and reviewer instructions.
- [x] Verify privacy declarations and desktop/private-browsing support match the manifest and policy.
- [x] Complete the public review submission and retain its confirmation.
- [x] Record add-on URL, submitted version, review status, and source/digests in [RELEASE.md](../RELEASE.md).
- [ ] After approval, verify the public signed 2.0.9 package and one installed real-browser smoke test; submission alone does not satisfy this step.
