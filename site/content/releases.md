## Extension 2.0.9 for Chrome and Firefox; MCP companion 0.1.8

This release is in preparation. Both browser packages use **2.0.9** from the same reviewed source; store submission, approval, signing, and public availability are separate steps. Firefox is the first public Mozilla Add-ons candidate. Companion 0.1.8 publication is also pending. This page will record verified outcomes, rather than assume a Store release from a repository version.

- Adds desktop Firefox 140+ support on Windows, macOS, and Linux, with regular browsing only.
- Preserves Capture, COMMAND Evidence, Local Injection, Scenarios, reviewed Server Injection, and JSON/offline HTML exports across both browsers.
- Shares one local companion across Chrome and Firefox panels, including multiple Firefox profiles and colliding browser tab numbers.
- Expands MCP investigation and reviewed Client Message preparation. Each agent Server Injection needs a person's approval of its exact message and send arguments; duplicate requests retrieve the receipt.
- Firefox declares required application-data sharing consent at installation for MCP. Agent access remains enabled by default and can be turned Off per panel.
- Firefox analytics starts Off. Its optional native permission and Workbench preference must both allow collection. Cancellation or Deny leaves the panel usable; opt-out or native revocation stops collection and erases analytics identifiers.

Follow [browser installation]({{site}}docs/getting-started/) and [matching MCP setup]({{site}}docs/agent-access/). The earlier release status below was verified on its stated date.

## Extension 2.0.8 and MCP companion 0.1.7

Companion [0.1.7 is published on npm](https://www.npmjs.com/package/lightstreamer-workbench-agent/v/0.1.7) and pairs with extension 2.0.8. Its exact package passed Windows, macOS, and Linux checks and was published with signed provenance. The companion runtime is unchanged from 0.1.6; setup examples now pin the matching release.

Extension 2.0.8 simplifies the workspace and improves captured-update Scenario composition:

- Search captured updates for the exact target through bounded pages, independently of the current investigation.
- Add selected batches explicitly to an ordered queue with one focused Source/Draft editor.
- Preserve focus and member reading positions through switching, Park/Resume, and Undo.
- Label MERGE and DISTINCT Steps as Item update and bound deleted COMMAND-key history in long sessions.

The [ready-built 2.0.8 download](https://github.com/imom39a/lightstreamer-workbench-extension/releases/tag/agent-v0.1.7) is available now with checksums. Chrome Web Store accepted 2.0.8 for review and will publish it automatically after approval; the October 2, 2026 verification showed Store 2.0.7. Follow [matching Chrome and MCP setup]({{site}}docs/agent-access/) to use the download with companion 0.1.7.

## MCP companion — 0.1.6

Companion [0.1.6 is published on npm](https://www.npmjs.com/package/lightstreamer-workbench-agent/v/0.1.6). It simplifies the npm page around Chrome installation and MCP setup, with links here for user guidance and to GitHub for contributor documentation. Its runtime is unchanged from 0.1.5 and it pairs with extension 2.0.7.

Follow [MCP setup]({{site}}docs/agent-access/) to connect it.

## MCP companion — 0.1.5

Companion [0.1.5 is published on npm](https://www.npmjs.com/package/lightstreamer-workbench-agent/v/0.1.5) and pairs with extension 2.0.7. Its exact package passed Windows, macOS, and Linux checks.

- Read one exact COMMAND key with certainty and provenance.
- Wait for an existing operation receipt without repeating execution.
- Use cancellable reads with bounded request capacity and response sizes.
- Recover from incompatible companion versions with matching-package guidance.

Follow [MCP setup]({{site}}docs/agent-access/) for Chrome installation and version-pinned npm setup. The [matching download](https://github.com/imom39a/lightstreamer-workbench-extension/releases/tag/agent-v0.1.5) includes the ready-built extension and package checksums.

## Extension 2.0.7 — COMMAND and agent reliability

Extension 2.0.7 fixes COMMAND Clear and exact whitespace-key handling, bounds historical bookkeeping, and releases discarded runtime objects. Selected Context preserves encoded JSON numbers and explains uncertain values and unverified JSON Patch basis. Repeated Server Injection correlations do not resend after receipt capacity is reached.

The [ready-built extension 2.0.7](https://github.com/imom39a/lightstreamer-workbench-extension/releases/download/agent-v0.1.5/lightstreamer-workbench-mcp-v2.0.7.zip) remains available. Chrome Web Store published 2.0.7 on October 1, 2026, independently confirmed through the publisher API and public listing on October 2. Companion 0.1.6 pairs with this release. See [matching Chrome and MCP setup]({{site}}docs/agent-access/#install-a-matching-extension) for the current pair.

## MCP companion — 0.1.4

Companion [0.1.4 is published on npm](https://www.npmjs.com/package/lightstreamer-workbench-agent/v/0.1.4). It restores version-pinned `npx` setup and contains the same runtime as 0.1.3, paired with extension 2.0.6. The published tarball passed Windows, macOS, and Linux checks. Follow [MCP setup]({{site}}docs/agent-access/) to connect it. The companion does not install or update the Chrome extension.

## MCP companion — 0.1.3

Companion 0.1.3 is available as a package download from the [agent-v0.1.3 release](https://github.com/imom39a/lightstreamer-workbench-extension/releases/tag/agent-v0.1.3). It introduced bounded replies and excludes cached Evidence query results from operational status. These fixes continue in the current npm companion. The Chrome extension is installed separately.

- Find Subscriptions and items with Scope search.
- Count records and distinct keys before reading examples.
- Select fields and limit response size.
- Validate and run Local Injections or Scenarios.

Follow [MCP setup]({{site}}docs/agent-access/) to install a matching extension and npm companion. The companion does not install or update the Chrome extension.

## MCP companion — 0.1.2

This previous companion version passed Windows, macOS, and Linux checks and included the agent skill. It remains available as a [public GitHub release](https://github.com/imom39a/lightstreamer-workbench-extension/releases/tag/agent-v0.1.2); the Chrome extension is released separately.

## Extension 2.0.6 — MCP reply budgets

This update bounds MCP replies, removes cached Evidence results from operational status, and adds useful pagination for oversized lists and reads. Extension 2.0.6 is published in the Chrome Web Store, confirmed on September 30, 2026.

Follow [Chrome and MCP setup]({{site}}docs/agent-access/#install-a-matching-extension) to install a matching extension and companion.

## Extension 2.0.4

- Shows complete keys and readable JSON in the Evidence stream.
- Adds capture reliability and memory fallback improvements.
- Uses Off / Include / Exclude filter controls.
- Supports dark mode and forced colors.

## Extension 2.0.3

- Captures outbound Client Messages and their outcomes.
- Adds reviewed Server Injection.
- Adds optional usage analytics. See [Privacy]({{site}}privacy/) for data and controls.

## Extension 2.0.2

- Adds Local Injection Scenarios and Checkpoints.
- Adds Notifications for conditions and diagnostics.
- Improves Scope and Context.

## Extension 2.0.0

Introduces the shared Scope, Evidence, and Context workspace, Local Injection Drafts, and scoped exports.

Check `chrome://extensions` for your installed version. The [Chrome Web Store listing]({{store}}) shows the available Store release.
