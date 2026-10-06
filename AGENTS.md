# Lightstreamer Workbench

Lightstreamer Workbench is a Chrome and desktop Firefox DevTools extension for debugging applications that use the official Lightstreamer Web Client. It captures clients, Sessions, Subscriptions, Item Updates, snapshots, COMMAND key lifecycles, and outbound Client Messages. Developers inspect Evidence, reproduce Item Updates through backend-free Local Injection, and send reviewed Client Messages through Server Injection.

## Product boundaries

- **Runtime:** debugging lives beside the inspected page in its DevTools panel. Chrome and Firefox share Workbench behavior and the same extension version, with separate generated manifests and store packages. Firefox supports regular desktop browsing; follow [ADR 0017](docs/adr/0017-support-firefox-with-shared-workbench-behavior.md) when changing browser integration, native data consent, or shared MCP access.
- **Official client:** v2 targets only the official Lightstreamer Web Client and instruments its API. Listener-level Capture is the semantic basis; wire Capture supports diagnostics and fallback rather than replacing the client model.
- **Domain:** keep the generic core Lightstreamer-native: client, session, subscription, mode, item, field, key, command, update, snapshot, client message, injection, and delivery. Application-specific interpretation may be optional; it must not constrain the core.
- **Capture:** observation never alters or suppresses the application's original Item Update or Client Message. Captured Evidence is immutable; mutation applies to a separate Injection Draft.
- **Injection:** Local Injection delivers Item Updates locally without a backend change. Reviewed Server Injection sends a Client Message through the inspected client's normal `sendMessage` path in its current Session; it does not create an inbound server-stream update.
- **COMMAND:** Observed Server COMMAND State uses captured Server Updates only. Local Effective COMMAND State additionally applies successful Local Injected Updates for the Subscription.
- **History:** one Panel Session owns one temporary rolling Event History; each new Panel Session starts fresh. Normal retention is 100,000 records or 256 MiB of canonical accounted bytes; memory-backed retention is 25,000 records or 128 MiB. Retention advances remove the oldest accepted prefix without stopping Capture. Bounded commit recovery and explicit Evidence Gaps keep storage failure separate from Observation Coverage. Controlled Close attempts erasure and reports the outcome; abnormal cleanup may leave residual data until an ownership-safe guarded sweep. Versioned Topology exports are deliberate, privacy-reviewed user downloads, not persistent application state.
- **Security:** the developer controls the inspected-page tool. Mark Local Injected Updates; v2 needs no explicit injection-mode safety toggle. Attribute Server Updates to Workbench only when the application supports attribution metadata.

## Context to read for the task

- **Architecture:** before changing execution contexts, module boundaries, message routing, Capture, storage, or delivery, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Domain:** before exploring or naming domain behavior, read [CONTEXT.md](CONTEXT.md), relevant [ADRs](docs/adr/), and the [domain documentation procedure](docs/agents/domain.md).
- **Development:** for setup and verification, use [CONTRIBUTING.md](CONTRIBUTING.md) and the current scripts in [package.json](package.json). For installed Firefox verification, read [docs/firefox-testing.md](docs/firefox-testing.md).
- **Release:** before preparing artifacts or changing publication tooling, read [RELEASE.md](RELEASE.md). It owns matching browser versions, source provenance, store-specific packages, review states, and credential handling.
- **Connected Workbench:** when investigating a Panel Session, reproducing Item Updates through the agent interface, or verifying the inspected application's response, use the [lightstreamer-workbench skill](.agents/skills/lightstreamer-workbench/SKILL.md).

## UI work

Classify every change as Non-UI, Bounded UI, or Material UI before implementation. All panel UI work follows [docs/WORKBENCH_UI_STANDARD.md](docs/WORKBENCH_UI_STANDARD.md), including its linked accepted design contracts and proportional browser and visual-QA evidence. Permanent surfaces, shared components, semantic exceptions, and visual-baseline changes must satisfy their explicit gates.

For browser verification, read [docs/agents/ui-verification.md](docs/agents/ui-verification.md). For independent visual review, read [docs/agents/ui-visual-qa.md](docs/agents/ui-visual-qa.md).

## Work tracking

Internal tickets, PRDs, and agent findings live as draft items in [Lightstreamer Workbench Project #2](https://github.com/users/imom39a/projects/2). Before reading the frontier or updating work, follow [docs/agents/ticket-tracker.md](docs/agents/ticket-tracker.md). Create repository Issues or convert internal drafts only when the user explicitly requests that for the ticket.

GitHub Issues and pull requests are the intake and triage surface for repository-facing reports. For those operations, read [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) and [docs/agents/triage-labels.md](docs/agents/triage-labels.md). Triage labels apply to repository Issues and pull requests, not draft Project items.
