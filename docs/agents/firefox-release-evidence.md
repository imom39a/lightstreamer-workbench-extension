# First Firefox release verification

The maintainer approved a public Firefox release with full Chrome parity, one
shared MCP companion, optional Firefox analytics consent, regular desktop
browsing, separate manual store submissions and matching extension versions.
The release instruction also requires the completed work on `main` first.
Both extension packages target **2.0.9**; the companion is independently
versioned **0.1.8**. ADR 0017 records the accepted scope and source approval.

## Change classification and boundaries

The analytics consent workflow is **Material UI**. It keeps the existing
analytics checkbox and adds one transient extension-owned browser window for
Firefox's direct native permission request. It creates no permanent workspace
surface. The normal browser window preserves Firefox's keyboard route to its
permission notification. Cancel and Deny keep analytics Off; both Firefox's
optional grant and the Workbench preference are required to send. Off and native
revocation erase analytics identifiers and preserve Capture.

Cancel and Deny save an explicit Off preference. Reopening Workbench preserves
both Allow/On and Deny/Off without another consent window or native prompt. A
new permission request requires explicitly enabling analytics again.

Manifest, background, companion identity, profile-origin validation and packaging
are Non-UI changes. Firefox declares the inspected application data categories
used by MCP as required installation consent; analytics is optional. Arbitrary
application payloads may contain sensitive data beyond recognized credential
redaction. The privacy policy and both store reviewer instructions describe
that boundary. Firefox private browsing is disabled.

## Browser and visual evidence

The shipped panel and helper were exercised in fresh, owned Firefox profiles.
Consent tests use fake analytics ingestion configuration and block all external
HTTP/HTTPS traffic. The stable browser was **157.0.1**, minimum **140.0**, and
current ESR lines **140.17.0esr** and **153.4.0esr**.

The stable consent matrix covers panel content sizes **563 × 699**, **900 × 699**,
**900 × 319** and **1440 × 899**. Helper content sizes are **500 × 390**,
**520 × 390**, and **520 × 260**; Firefox's normal-window minimum limits the
requested compact width. Request and cancellation controls have visible,
unobscured keyboard focus at every size. Tab/Enter cancellation restores the
analytics checkbox. All four panel/helper pairs have **zero serious or critical
axe findings**. The forced-color helper uses system colors; the panel retains
the accepted dark-only treatment with an active forced-color media query and
visible focused checkbox. Empty history, 500 accepted fixture updates during
pending consent, native revocation and a simulated permission-API rejection
cover degraded and recovery states.

The owned official Lightstreamer fixture and installed companion tarball prove
Capture, IndexedDB, bounded MCP discovery/reads, exact Panel Session routing,
duplicate Local Injection suppression, ordered Scenarios and Checkpoints,
reviewed Server Injection with exactly one real Client Message, receipt recovery,
application DOM effects, and actual JSON/offline HTML downloads. Stable, minimum
and the next ESR passed locally. CI adds stable Firefox on Windows/macOS/Linux
and both ESR lines on Linux. The portable origin tests also cover simultaneous
Chrome and Firefox panels with colliding tab IDs and separate Firefox profiles.

Controlled DevTools Close attempts history erasure. The observed successful
runs remove their owned history. If destruction interrupts the asynchronous
erase, the browser proof additionally waits for the live lease to expire,
reopens a fresh Panel Session and requires ownership-safe startup cleanup of
the old database; it never deletes product history through the driver.

The maintained Chrome panel suite passed **427 checks**. No tracked visual
baseline changed. The five previously approved store screenshots are retained;
no regenerated image set is claimed as new acceptance evidence.

## Reproduction and release gates

See [Firefox verification](../firefox-testing.md) for the owned-profile harness,
offline configuration, installed-tarball selection and artifact directories.
The visual run adds `LSEW_FIREFOX_VISUAL_PROOF=1`. The native keyboard proof
adds `LSEW_FIREFOX_NATIVE_KEY_PROOF=1`: it focuses the actual Firefox notification
button and activates Deny and Allow with trusted Marionette Enter events, then
verifies permission, preference and restored checkbox focus. Full native-toolbar
Tab traversal is not evidenced or claimed. An owned headed ESR 153.4.0 capture
also shows the native disclosure and focused Deny button.
Artifacts are kept under `test-results/firefox*/`; the CI workflow uploads its
platform evidence. Source ZIP reproducibility, exact-source CI and store
submission outcomes are independent final gates in [RELEASE.md](../../RELEASE.md).

The full local unit gate passed **2,160 tests**, with four explicit skips. Type
checking, documentation checks, the public site's eight browser checks, installed
npm package proof and release-tooling tests passed. Firefox lint has zero errors
and notices; its desktop-only Android minimum and two generated React DOM
`innerHTML` warnings are explained in the reviewer source instructions.

Final Windows verification found developer-driver defects in UTF-8 input and
coordinates after a consent window closes. The bridge now explicitly uses
UTF-8 and the selected Marionette window viewport. The same Windows run already
proved saved Allow/On and Deny/Off reopen without another permission prompt.

The Windows unit gate also exposed accumulated zero-delay timer pauses in
cooperative memory queries. The shared scan now yields to a MessageChannel task
in browsers and an immediate task in Node; the timer fallback remains available.
Ports are closed after delivery, and cancellation is checked after yielding.
This is **Non-UI**, with unchanged query results, budgets and retention semantics.
All 27 focused performance, task-yield, cancellation, Clear and retention-lifetime
checks passed, as did type checking. The existing latency assertions are retained.
The [HTML task model](https://html.spec.whatwg.org/multipage/web-messaging.html#message-ports)
defines port delivery through queued tasks rather than a microtask-only yield.

Independent visual review passed after inspecting all **26 PNGs** and **eight
browser/result records** in the evidence manifest. Compact cancellation, native
choices and restored focus, forced colors, empty history, failure recovery and
saved consent all satisfy the supplied acceptance criteria. The review found
no remaining material finding or required evidence gap. Submission and public
availability remain separate outcomes and are not inferred from these tests.
