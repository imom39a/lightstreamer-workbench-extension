# Security Policy

Lightstreamer Workbench is a developer tool that observes inspected-page runtime data. Security and privacy reports are taken seriously because captured Lightstreamer payloads can contain proprietary or user-sensitive application data.

Canonical policy URL: https://imom39a.github.io/lightstreamer-workbench-extension/security/

## Supported versions

Security fixes target the current Chrome Web Store release and the current `main` branch. During the 2.0 prelaunch, that means:

| Version | Status |
| --- | --- |
| `2.0.x` | Release candidate; fixes land before public release |
| `0.1.x` | Current public release |

After 2.0 reaches the Chrome Web Store, 2.0 becomes the supported public line and 0.1.x receives no routine fixes.

## Report a vulnerability

Do not open a public issue with exploit details, production payloads, tokens, cookies, account identifiers, or private URLs.

1. Use [GitHub private vulnerability reporting](https://github.com/imom39a/lightstreamer-workbench-extension/security/advisories/new).
2. If that private flow is unavailable, open a [minimal public support issue](https://github.com/imom39a/lightstreamer-workbench-extension/issues/new?template=03-question.yml) asking for maintainer security contact. Omit all exploit details and sensitive data.
3. Include a concise impact summary, affected version or commit, browser version, reproduction outline, and a sanitized proof of concept only in the private report.

The maintainers triage reports based on exploitability, user impact, captured-data exposure, and extension-store release risk.

## Use the private security path for

- Captured Evidence leaving the local browser unexpectedly.
- Tokens, cookies, credentials, private URLs, or page secrets exposed by extension behavior.
- Remote code execution, unsafe dynamic script loading, or dependency supply-chain risks.
- Extension permission expansion beyond the documented debugging need.
- Local Injection escaping its local listener or inspected-page delivery boundary.
- Captured Evidence persisting beyond the documented DevTools session boundary without clear user control.
- Chrome Web Store release credentials, private keys, or service account material.

## Use public support for

- UI bugs that contain no sensitive data.
- Incorrect COMMAND state reconstruction with sanitized payloads.
- Documentation gaps or product-boundary questions.
- Feature requests.
- Fixture or local build failures.

Review the [Support page](https://imom39a.github.io/lightstreamer-workbench-extension/support/) to choose the right public template.

## Data-handling reminder

Workbench is designed to process Lightstreamer Evidence locally in the inspected browser session. Do not attach raw production event streams, exports, or screenshots containing sensitive application data to public issues or pull requests.
