# Security Policy

Lightstreamer Workbench observes inspected-page runtime data. Captured Lightstreamer payloads can contain proprietary or private application data. Use the private report process for a security or privacy problem.

Canonical policy URL: https://imom39a.github.io/lightstreamer-workbench-extension/security/

## Supported versions

Security fixes apply to the current Chrome Web Store release and the current `main` branch:

| Version | Status |
| --- | --- |
| `2.0.x` | Current public release; supported |

Older releases do not get routine fixes. Install the latest Chrome Web Store version before you report a vulnerability. Do not upgrade if the vulnerability is in the upgrade process.

## Report a vulnerability

Do not open a public issue with exploit details, production payloads, tokens, cookies, account identifiers, or private URLs.

1. Use [GitHub private vulnerability reporting](https://github.com/imom39a/lightstreamer-workbench-extension/security/advisories/new).
2. If the private report page is not available, open a [public support issue](https://github.com/imom39a/lightstreamer-workbench-extension/issues/new?template=03-question.yml). Ask for a maintainer security contact. Do not include vulnerability details or private data.
3. Put the impact, affected version, browser version, reproduction steps, and a safe proof of concept only in the private report.

The maintainers assess exploitability, user impact, captured-data exposure, and Chrome Web Store release risk.

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

Use the [Support page](https://imom39a.github.io/lightstreamer-workbench-extension/support/) to select a public report template.

## Data-handling reminder

Optional Agent access deliberately transfers requested data to a local MCP
client and potentially its model provider. It starts off per Panel Session,
uses explicit read or Local Injection grants, exact runtime targets, bounded
messages, a private per-user Unix socket and a native-host origin allowlist.
It is not a security boundary against other processes running as the same OS
user. Captured application text is untrusted data, never tool instructions.
Credential-name omission is defense in depth, not a guarantee that arbitrary
application fields contain no secrets. Agents cannot call arbitrary page code,
clear History or perform Server Injection through this interface.

Loss of a native connection or a reply does not prove an Injection was not
delivered. Request ids deduplicate within the surviving Panel Session only;
inspect the original operation and Scenario trace before further dispatch.

Workbench processes Lightstreamer Evidence in one Panel Session. The Panel Session owns one temporary Event History. A controlled Close tries to erase this History. An abnormal stop can prevent erasure. Residual data can remain until Chrome runs the extension again. A new Panel Session does not load this data. Do not attach private production events, exports, or screenshots to public issues or pull requests.
