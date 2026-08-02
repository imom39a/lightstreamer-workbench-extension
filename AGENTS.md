## Project

**Lightstreamer Workbench**

Lightstreamer Workbench is a Chrome DevTools extension for debugging web applications that use the official Lightstreamer Web Client. It currently captures Lightstreamer clients, sessions, subscriptions, item updates, snapshots, and COMMAND-mode key lifecycles, then lets developers inspect, search, and create deliberate Local Injections. Planned Server Injection adds capture and deliberate submission of Client Messages through the inspected client's normal message path.

The tool is generic developer infrastructure, not an application-specific debugger. Application teams can later add optional interpretation rules, but the core product models Lightstreamer primitives: client, session, subscription, mode, item, field, key, command, update, snapshot, client message, injection, and delivery.

**Core Value:** Developers can understand and reproduce Lightstreamer COMMAND subscription behavior without waiting for production event sequences, using backend-free Local Injection today and the application's normal client-to-server message flow for planned Server Injection.

### Constraints

- **Runtime target**: Chrome extension with a DevTools panel - debugging should live next to the inspected page's runtime state.
- **Lightstreamer target**: Official Lightstreamer Web Client only for v1 - client API instrumentation is more reliable than generic WebSocket inference.
- **Injection boundary**: v1 supports backend-free Local Injection. Planned Server Injection sends a Client Message through the inspected Lightstreamer client's normal `sendMessage` path in the context of its current Session; it does not directly introduce an inbound update into the server stream.
- **Capture semantics**: Capture is observational - Workbench never alters or suppresses the application's original Item Update or Client Message. Mutation applies to a separate Injection Draft.
- **COMMAND state projections**: Observed Server COMMAND State uses captured Server Updates only. Local Effective COMMAND State additionally applies successful Local Injected Updates for the Subscription.
- **Storage**: Current-DevTools-session history uses ordered IndexedDB batches with an in-memory fallback and is cleared on session teardown. Versioned Topology exports are deliberate user downloads, not persistent application state.
- **Domain model**: Lightstreamer-native primitives first - app-specific adapters must not constrain the generic core.
- **Security posture**: Developer-controlled tool for inspected pages - Local Injected Updates must be marked, but v1 does not require an explicit injection-mode safety toggle. Server Updates can be attributed to Workbench only when the application supports attribution metadata.

## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Chrome Extension Manifest V3 | Current Chrome platform | Extension runtime, permissions, DevTools integration | Required platform for modern Chrome extensions and DevTools panel registration |
| Chrome DevTools Panel API | Current Chrome platform | Primary UI surface inside inspected tab DevTools | The workflow is page-runtime debugging, so DevTools is the natural surface |
| Chrome content scripts with MAIN-world injection | Current Chrome platform | Patch page-owned Lightstreamer constructors/listeners before app code uses them | Official content script isolated worlds cannot directly patch page globals unless a MAIN-world script is injected |
| TypeScript | Current stable at implementation | Strongly typed event envelope, Lightstreamer adapters, state reconstruction | The product depends on precise protocol and object-shape handling |
| Official Lightstreamer Web Client API instrumentation | Lightstreamer Web Client 9.x docs verified | Capture clients, subscriptions, item updates, client messages, listener callbacks, snapshot status, and COMMAND values | Higher signal than raw WebSocket capture because it exposes subscription semantics directly |
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
| Subscription-scoped Local Injection for Item Updates; normal client-message path for future Server Injection | Direct Data Adapter or inbound server-stream injection | Use direct server-stream injection only in a separate backend-coordinated product; Workbench's Server Injection remains a normal Client Message |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| App-specific domain models in the core | Would make the tool a single-app debugger rather than Lightstreamer developer tooling | Generic Lightstreamer event envelope and optional adapters |
| Raw frame capture as the only source of truth | Loses high-level concepts such as subscription mode, snapshot status, changed fields, key, and command | Capture through Lightstreamer Web Client APIs and listener callbacks |
| Cross-session persistent capture | Adds privacy, pruning, retention, and schema-migration concerns beyond the current debugging session | Session-scoped IndexedDB with in-memory fallback; explicit privacy-reviewed exports |
| Implying that Server Injection directly creates inbound updates | A browser extension can send a real Client Message, but it cannot inject an arbitrary Item Update into the server stream | Local Injection for Item Updates; normal client `sendMessage` flow for Server Injection |
## Sources
- https://lightstreamer.com/ls-server/latest/docs/General%20Concepts.pdf - subscription modes, COMMAND-mode semantics, snapshot behavior
- https://sdk.lightstreamer.com/ls-web-client/9.0.0/api/index.html - Web Client, Subscription, SubscriptionListener, and ItemUpdate surfaces
- https://developer.chrome.com/docs/extensions/reference/api/devtools/panels - DevTools panel integration
- https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts - content script execution worlds and page injection constraints

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.

## Agent skills

### Work tracking

Internal tickets, PRDs, and agent findings live as draft items in [Lightstreamer Workbench Project #2](https://github.com/users/imom39a/projects/2); do not create repository issues for them. See `docs/agents/ticket-tracker.md`.

GitHub Issues and pull requests remain the intake and triage surface for repository-facing reports. See `docs/agents/issue-tracker.md`.

### Triage labels

For repository issues and pull requests, use the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. These labels do not apply to draft Project items. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
