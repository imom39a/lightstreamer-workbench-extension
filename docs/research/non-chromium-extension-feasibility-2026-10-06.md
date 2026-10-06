# Non-Chromium extension feasibility

Date: 2026-10-06. Status: research and recommended direction, not an accepted architecture decision.

Change class: Non-UI. This note changes no product behavior or UI contract. No browser port or live extension verification was performed.

## Conclusion

Firefox desktop and Safari on macOS can host Workbench in their developer tools. Firefox supports extension panels; Safari has supported Web Inspector extension tabs since Safari 16. A separate debugger window is therefore an optional product direction, not a prerequisite for Safari support. [Mozilla panel documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/devtools_panels), [Apple Web Inspector extension documentation](https://developer.apple.com/documentation/safariservices/adding-a-web-development-tool-to-safari-web-inspector).

**Recommendation:** keep one Lightstreamer instrumentation, Evidence, Injection, and panel implementation; add browser-specific manifests, a small extension API boundary, separate packages, and verification in the actual browsers. Ship Firefox first, then Safari on macOS. This is an engineering inference from the capabilities and repository findings below, not a claim that today's Chrome package runs unchanged.

## Verified capability

| Capability needed by Workbench | Firefox desktop | Safari on macOS |
|---|---|---|
| `devtools_page`, `panels.create`, `ExtensionPanel.onShown/onHidden` | Supported from 54 | Supported from 16 |
| `inspectedWindow.tabId`, `eval`, `reload` | Supported from 54 | Supported from 16 |
| Declarative `content_scripts.world: "MAIN"` | Supported from 128 | Supported from 18 |
| Manifest V3 background | Event page through `background.scripts`; no `service_worker` support | Service worker supported from 15.4; module type from 16.4; event pages also supported |

Version facts: [Mozilla DevTools compatibility data](https://github.com/mdn/browser-compat-data/blob/7eb4cac1d548a0441a2f7075e0295e0d665944f1/webextensions/api/devtools.json), [manifest content-script data](https://github.com/mdn/browser-compat-data/blob/7eb4cac1d548a0441a2f7075e0295e0d665944f1/webextensions/manifest/content_scripts.json), [background data](https://github.com/mdn/browser-compat-data/blob/7eb4cac1d548a0441a2f7075e0295e0d665944f1/webextensions/manifest/background.json).

**Recommended starting baselines:** Firefox 140+ and Safari 18+ on macOS. Firefox 128 is the instrumentation capability floor; 140 simplifies Mozilla's current built-in data consent requirements. Safari 16 supplies the panel, but 18 supplies the declarative MAIN-world mechanism used here. These are proposed support floors, subject to real-browser verification. [Firefox consent requirements](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/), [content-script compatibility](https://github.com/mdn/browser-compat-data/blob/7eb4cac1d548a0441a2f7075e0295e0d665944f1/webextensions/manifest/content_scripts.json).

### Instrumentation and permissions

Both browsers support declarative `run_at: "document_start"`. Safari's initial permission grant can happen after a page loads; subsequent loads honor `run_at`. Preserve the existing early MAIN-world hook and isolated relay, and verify permission grant followed by reload before claiming complete early Observation Coverage. A panel-open-time script injection is not evidence that constructors were captured before app startup. [Content-script timing and Safari permission notes](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts).

Firefox derives its DevTools permission from `devtools_page`. Safari requires adding `devtools` to `permissions`, requires permission for the inspected target, and says to create the Inspector tab unconditionally so Safari can present its permission dialog there. Firefox MV3 host permissions are granted at installation from version 127 and remain revocable. [Firefox DevTools permission](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/devtools), [Safari Inspector permissions](https://developer.apple.com/documentation/safariservices/adding-a-web-development-tool-to-safari-web-inspector), [Firefox MV3 permission behavior](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/).

### API contracts that need an adapter

Firefox and Safari support `chrome.*` and callbacks for compatibility, alongside `browser.*` and promises. A wholesale product rewrite is unnecessary; normalize asynchronous results and errors at the extension boundary. [Mozilla cross-browser guidance](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Build_a_cross_browser_extension), [Apple compatibility guidance](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility).

Firefox's `browser.devtools.inspectedWindow.eval()` resolves to `[result, exception]`, evaluates in the main frame, and does not support evaluation options such as `frameURL`. Workbench currently uses main-frame expressions, so that missing option does not by itself block the current bridge. [Firefox evaluation contract](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/devtools/inspectedWindow/eval).

Current WebKit source dispatches `onShown` with the panel Window and `onHidden` without arguments, matching Workbench's visibility-message approach. Its `create` IDL rejects an empty icon path; Workbench currently supplies `""`, so use a packaged icon. [WebKit panel event implementation](https://github.com/WebKit/WebKit/blob/7c3395d79582fe6e3754b5c536119f58adb73a0b/Source/WebKit/WebProcess/Extensions/API/Cocoa/WebExtensionAPIDevToolsExtensionPanelCocoa.mm), [panel creation IDL](https://github.com/WebKit/WebKit/blob/7c3395d79582fe6e3754b5c536119f58adb73a0b/Source/WebKit/WebProcess/Extensions/Interfaces/WebExtensionAPIDevToolsPanels.idl).

WebKit's current `eval` implementation passes `[result, exception]` as one callback argument; Workbench expects two Chrome callback arguments. Normalize this result explicitly or use the browser promise contract. Current source also implements `frameURL` for evaluation and `ignoreCache` for reload, with other options marked unfinished. These are source findings, not proof of identical behavior in every released Safari version; verify the shipped baseline, including exception handling. [WebKit evaluation and reload implementation](https://github.com/WebKit/WebKit/blob/7c3395d79582fe6e3754b5c536119f58adb73a0b/Source/WebKit/WebProcess/Extensions/API/Cocoa/WebExtensionAPIDevToolsInspectedWindowCocoa.mm), [callback dispatch implementation](https://github.com/WebKit/WebKit/blob/7c3395d79582fe6e3754b5c536119f58adb73a0b/Source/WebKit/WebProcess/Extensions/Bindings/JSWebExtensionWrapper.cpp).

Safari on iOS/iPadOS has no `devtools_page` or `devtools` extension API support in the compatibility data. Ordinary mobile Safari Web Extensions exist, but packaging a mobile app would not create Workbench panel parity. Treat mobile/remote inspection as a separate unverified scope. [DevTools compatibility](https://github.com/mdn/browser-compat-data/blob/7eb4cac1d548a0441a2f7075e0295e0d665944f1/webextensions/api/devtools.json), [DevTools manifest compatibility](https://github.com/mdn/browser-compat-data/blob/7eb4cac1d548a0441a2f7075e0295e0d665944f1/webextensions/manifest/devtools_page.json).

## Current repository boundaries

- Chrome Store release is already supported: [README](../../README.md), [package scripts](../../package.json), and [store upload/publish/status tooling](../../scripts/chrome-web-store.mjs). No store account state was inspected for this research.
- [Manifest](../../public/manifest.json) uses MV3, a module service worker, and MAIN/isolated content scripts at `document_start`. Firefox needs a generated `background.scripts` manifest; Safari needs the explicit DevTools permission. [Content-script build](../../scripts/build-content-scripts.mjs) currently targets `chrome114` and should gain browser targets.
- [Panel creation](../../src/extension/devtools.ts), [background](../../src/extension/background.ts), [content relay](../../src/content/content-script.ts), [panel bridge](../../src/extension/panel/bridge-client.ts), and analytics own the extension API integration. Server Injection and Message Recipes use inspected-window evaluation; Local Injection also has a runtime relay path. Verify each execution path, not just panel rendering.
- Agent access has a concrete portability blocker: [panel pairing](../../src/agent/panel-pairing.ts) only accepts Chrome extension origins; [portable broker](../../src/agent/companion/portable-broker.ts) constructs and validates them; [agent connection](../../src/extension/panel/agent-connection.ts) parses Chrome IDs and exposes `chromeTabId`. Introduce browser-neutral tab and extension identity while retaining exact allowed-origin checks; verify the browsers' actual loopback WebSocket Origin values. Changing only the manifest cannot deliver agent parity.

Preserve the owning Panel Session, temporary Event History, observational Capture, and existing Local/Server Injection boundaries. This direction aligns with [ADR 0014](../adr/0014-continue-event-history-with-rolling-retention.md), [ADR 0016](../adr/0016-panel-owned-agent-access.md), and [CONTEXT](../../CONTEXT.md).

## Distribution work

**Firefox:** produce an AMO package and obtain Mozilla signing; both public AMO distribution and self-distribution require signing for release Firefox. MV3 submissions must specify an add-on ID. New extensions have required `data_collection_permissions` declarations since November 3, 2025. Classify Workbench's actual analytics and agent data transfer; `technicalAndInteraction` must be optional, and `none` is only appropriate when there is no collection/transmission. The loopback companion and possible model-provider transfer need consideration because Mozilla defines transmission as handling outside the add-on or local browser. [Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), [MV3 add-on ID](https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/), [data consent and taxonomy](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

**Safari:** package the shared extension resources in a containing app and use Apple distribution. Apple's current `safari-web-extension-packager` command (formerly `safari-web-extension-converter`) generates an Xcode project and reports unsupported manifest keys. Apple now also supports App Store Connect packaging from any browser without Mac/Xcode, followed by TestFlight and App Store review; this still requires Apple Developer Program enrollment. Signed/notarized Developer ID distribution outside the Mac App Store is another macOS route. Actual macOS Safari remains necessary for the proposed Workbench verification. [Xcode packager](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari), [App Store Connect packager and TestFlight](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect), [signing and distribution](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension).

## Proposed acceptance evidence

Before advertising support, load the real target-browser extension and verify early official Web Client Capture, page reload/navigation, multiple inspected tabs, panel hide/show, Local Injection, reviewed Server Injection, Message Recipes, IndexedDB retention/cleanup and fallback, and MCP connection/identity/reconnect. Test granted and revoked permissions and page CSP behavior. Browser-engine emulation alone does not establish extension or DevTools parity. This is a recommended validation plan; no such evidence was collected here.
