# Contributing

Thank you for helping improve Lightstreamer Event Workbench. This project is a Chrome DevTools extension for developers who need to inspect and locally replay Lightstreamer Web Client behavior, especially COMMAND subscription lifecycles.

## Ground Rules

- Keep the core model Lightstreamer-native. Do not add app-specific business objects to core capture, normalization, or COMMAND state modules.
- Preserve the local-only privacy posture. Do not add analytics, remote logging, account sign-in, or off-device event upload without an explicit design discussion.
- Treat synthetic reinjection as local listener-path replay. Do not imply that the extension can inject inbound data into the real Lightstreamer server stream.
- Prefer focused pull requests with clear user impact and test coverage.
- Redact proprietary event payloads, tokens, cookies, customer data, account IDs, and internal URLs before posting issues or PR artifacts.

## Reporting Issues

Before opening a new issue:

1. Search existing issues and pull requests.
2. Confirm you are using a current build or describe the exact commit/version.
3. Try to reproduce on a minimal Lightstreamer page or the local fixture when possible.
4. Use the matching issue template.

Useful bug reports include:

- Chrome or Chromium version.
- Operating system.
- Extension version or commit SHA.
- Lightstreamer Web Client version, if known.
- Whether the page loads Lightstreamer before DevTools opens.
- Subscription mode and field schema, especially for COMMAND subscriptions.
- Expected behavior, actual behavior, and repro steps.
- Sanitized screenshots, console errors, captured envelope snippets, or fixture changes.

Do not include secrets or production payloads that you are not allowed to share.

## Asking Questions

Usage questions are welcome as GitHub issues when they may help future users. Include the workflow you are trying to debug and what you already tried. If the question contains private page data, redact it first.

## Suggesting Features

Feature requests should describe the debugging workflow, not just the UI control. For example, explain what Lightstreamer behavior is hard to inspect, what evidence you need from the extension, and how you would verify the result.

Good feature proposals usually answer:

- Which user is affected: developer, QA engineer, maintainer, or release owner.
- Which Lightstreamer primitive is involved: client, subscription, item, field, key, command, update, snapshot, or synthetic replay.
- Whether the feature needs page instrumentation, panel UI, state reconstruction, release tooling, or documentation.
- What should stay local-only.

## Development Setup

Install dependencies:

```bash
npm ci
```

Run checks:

```bash
npm run typecheck
npm test
npm run build
```

Package for local Chrome loading:

```bash
npm run release:package
```

Then load `dist/` in `chrome://extensions` with Developer mode enabled.

## Lightstreamer Fixture

The fixture smoke path requires Docker:

```bash
npm run fixture:test
```

This command builds the extension, builds the fixture adapter, starts a local Lightstreamer container, waits for it to become ready, and runs the capture smoke test.

Use the fixture for instrumentation, capture, normalization, and reinjection changes whenever a unit test alone does not prove browser/runtime behavior.

## Project Architecture

- `src/injected/` runs in the inspected page's MAIN world and instruments official Lightstreamer constructors, listeners, and WebSocket/TLCP fallback diagnostics.
- `src/content/` bridges page messages into extension messaging.
- `src/extension/background.ts` routes messages between the inspected tab and panel.
- `src/extension/panel/` renders the DevTools panel and user workflows.
- `src/core/` contains event envelopes, normalization, filtering, COMMAND state, draft validation, and synthetic event creation.
- `src/bridge/` defines cross-context message contracts.
- `tests/` covers core behavior, instrumentation, panel rendering, bridge validation, and the fixture path.

## Pull Request Process

1. Create a topic branch.
2. Keep the branch focused on one behavior or documentation goal.
3. Add or update tests for user-visible behavior and cross-context message changes.
4. Run the relevant checks before opening the PR.
5. Fill out the pull request template.
6. Link related issues with `Fixes #123` or `Refs #123` when applicable.

For documentation-only changes, run at least a local review of links, commands, and claims. For source changes, run `npm run typecheck`, `npm test`, and `npm run build` unless the PR explains why a check is not applicable.

## Review Expectations

Reviewers should look for:

- Correctness of Lightstreamer semantics, especially COMMAND ADD/UPDATE/DELETE and snapshot handling.
- Extension-context boundaries across injected script, content script, background service worker, and DevTools panel.
- Privacy regressions, expanded permissions, remote calls, or persistence changes.
- Clear synthetic event labeling and local-only behavior.
- Tests that cover the changed behavior at the right layer.

## Release Changes

Chrome Web Store publishing is maintainer-only. Release packaging and upload details live in [RELEASE.md](RELEASE.md). Store listing copy and generated assets live in `store-listing/`.

Do not commit private release credentials, `.env.release`, CRX private keys, service account keys, or generated private artifacts.
