# Security Policy

Lightstreamer Event Workbench is a developer tool that observes inspected-page runtime data. Security and privacy reports are taken seriously because captured Lightstreamer payloads can contain proprietary or user-sensitive application data.

## Supported Versions

Security fixes target the current released version and the current `main` branch.

| Version | Supported |
| --- | --- |
| `0.1.x` | Yes |

## Report A Vulnerability

Do not open a public issue with exploit details, production payloads, tokens, cookies, account identifiers, or private URLs.

Preferred reporting path:

1. Use GitHub's private vulnerability reporting flow if it is enabled for this repository.
2. If private vulnerability reporting is not available, open a minimal public issue asking for maintainer security contact and omit technical exploit details.
3. Include a concise impact summary, affected version or commit, browser version, reproduction outline, and any sanitized proof of concept.

The maintainers will triage reports based on exploitability, user impact, and extension-store release risk.

## Security-Sensitive Examples

Please use the security path for reports involving:

- Captured event data leaving the local browser unexpectedly.
- Tokens, cookies, credentials, or page secrets exposed by extension behavior.
- Remote code execution, unsafe dynamic script loading, or dependency supply-chain risks.
- Extension permission expansion beyond the documented debugging need.
- Synthetic reinjection escaping the local listener-path boundary.
- Persistent storage of captured event data without clear user control.
- Chrome Web Store release credentials, private keys, or service account material.

## Public Issue Examples

Use normal public issue templates for:

- UI bugs without sensitive data.
- Incorrect COMMAND state reconstruction with sanitized payloads.
- Documentation gaps.
- Feature requests.
- Fixture or local build failures.

## Data Handling Reminder

The extension is designed to process Lightstreamer event data locally in the inspected browser session. Do not attach raw production event streams or screenshots containing sensitive application data to GitHub issues or pull requests.
