<!-- GSD:project-start source:PROJECT.md -->
## Project

**Lightstreamer Event Workbench**

Lightstreamer Event Workbench is a Chrome DevTools extension for debugging web applications that use the official Lightstreamer Web Client. It captures Lightstreamer clients, sessions, subscriptions, item updates, snapshots, and COMMAND-mode key lifecycles, then lets developers inspect, search, mutate, and locally reinject those updates into the running page.

The tool is generic developer infrastructure, not an application-specific debugger. Application teams can later add optional interpretation rules, but the core product models Lightstreamer primitives: client, session, subscription, mode, item, field, key, command, update, snapshot, and synthetic replay.

**Core Value:** Developers can understand and reproduce Lightstreamer COMMAND subscription behavior in the browser without needing backend access or waiting for production event sequences.

### Constraints

- **Runtime target**: Chrome extension with a DevTools panel - debugging should live next to the inspected page's runtime state.
- **Lightstreamer target**: Official Lightstreamer Web Client only for v1 - client API instrumentation is more reliable than generic WebSocket inference.
- **Injection boundary**: Backend-free local reinjection only - no real server, test Data Adapter, or external harness is required.
- **Storage**: In-memory session state for v1 - keeps the first build small and avoids IndexedDB/export complexity until capture and reinjection are validated.
- **Domain model**: Lightstreamer-native primitives first - app-specific adapters must not constrain the generic core.
- **Security posture**: Developer-controlled tool for inspected pages - synthetic events must be marked, but v1 does not require an explicit replay-mode safety toggle.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Chrome Extension Manifest V3 | Current Chrome platform | Extension runtime, permissions, DevTools integration | Required platform for modern Chrome extensions and DevTools panel registration |
| Chrome DevTools Panel API | Current Chrome platform | Primary UI surface inside inspected tab DevTools | The workflow is page-runtime debugging, so DevTools is the natural surface |
| Chrome content scripts with MAIN-world injection | Current Chrome platform | Patch page-owned Lightstreamer constructors/listeners before app code uses them | Official content script isolated worlds cannot directly patch page globals unless a MAIN-world script is injected |
| TypeScript | Current stable at implementation | Strongly typed event envelope, Lightstreamer adapters, state reconstruction | The product depends on precise protocol and object-shape handling |
| Official Lightstreamer Web Client API instrumentation | Lightstreamer Web Client 9.x docs verified | Capture clients, subscriptions, item updates, listener callbacks, snapshot status, and COMMAND values | Higher signal than raw WebSocket capture because it exposes subscription semantics directly |
| In-memory event store | v1 internal module | Current-tab event capture and query | Matches the v1 decision to avoid persistence/export complexity |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vite or equivalent extension build tooling | Resolve during implementation | Bundle TypeScript for extension contexts | Use if the repo starts from source modules rather than hand-authored JS |
| A small virtual list implementation | Resolve during implementation | Render high-volume event logs | Add when timeline performance needs it; avoid early UI framework lock-in |
| JSON path / object editor utility | Resolve during implementation | Mutate captured event payload fields | Useful for reinjection editing once the envelope format is stable |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| Chrome extension unpacked loading | Manual verification | Required for DevTools panel and content script behavior |
| Browser/Playwright verification | UI smoke checks | Can verify extension pages, but manual Chrome DevTools checks may still be needed |
| Lightstreamer demo or fixture page | Capture/reinjection test target | Needed to validate against the official Web Client without app-specific dependencies |
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Web Client API instrumentation | Raw WebSocket/TLCP parsing first | Use raw capture as fallback diagnostics after listener-level capture is proven |
| DevTools panel first | Popup/sidebar first | Use popup only for status/session shortcuts after the primary workflow exists |
| In-memory store | IndexedDB | Use IndexedDB after current-tab capture, search, and reinjection workflows are validated |
| Local listener-path reinjection | Real server/Data Adapter injection | Only use real server injection in a separate product requiring backend cooperation; it is out of scope here |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| App-specific domain models in the core | Would make the tool a single-app debugger rather than Lightstreamer developer tooling | Generic Lightstreamer event envelope and optional adapters |
| Raw frame capture as the only source of truth | Loses high-level concepts such as subscription mode, snapshot status, changed fields, key, and command | Capture through Lightstreamer Web Client APIs and listener callbacks |
| Persistent storage in v1 | Adds privacy, export, pruning, and schema migration concerns before core value is validated | Current-tab in-memory capture |
| Implying real inbound server injection | Browser extensions cannot inject arbitrary inbound Lightstreamer data into the actual server stream | Backend-free local reinjection and virtual stream harness |
## Sources
- https://lightstreamer.com/ls-server/latest/docs/General%20Concepts.pdf - subscription modes, COMMAND-mode semantics, snapshot behavior
- https://sdk.lightstreamer.com/ls-web-client/9.0.0/api/index.html - Web Client, Subscription, SubscriptionListener, and ItemUpdate surfaces
- https://developer.chrome.com/docs/extensions/reference/api/devtools/panels - DevTools panel integration
- https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts - content script execution worlds and page injection constraints
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
