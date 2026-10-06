---
status: accepted
---

# Support Firefox with shared Workbench behavior and separate browser packages

The first Firefox release will provide the approved Chrome product's functionality, including MCP, from shared Workbench source. Browser manifests and packages remain separate, and the first public Mozilla Add-ons submission is a guided manual step independent of Chrome Web Store submission; later automation can distribute both packages from one approved source version.

One Panel Session continues to own temporary Evidence and Injection operations. One companion supports Chrome and Firefox concurrently while distinguishing permanent add-on identity, actual extension Origin, and inspected-tab identity, preserving exact-origin checks and existing Chrome compatibility. Firefox's own profile UUID mapping bootstraps the actual Origin as described in ADR 0016; the release gate exercises this with a real installed extension.

Firefox begins with regular desktop browsing on Windows, macOS, and Linux and a Firefox 140 minimum for built-in data consent. Usage analytics requires its optional Firefox grant and Workbench preference. MCP preserves automatic access after required installation consent and retains its off control; an audit determines the transmitted-data categories. This requires Firefox-specific amendments to [ADR 0015](0015-measure-extension-usage-with-a-closed-analytics-vocabulary.md) and [ADR 0016](0016-panel-owned-agent-access.md) before implementation.

This direction trades browser integration and separate store review for reuse of the generic Lightstreamer model and accepted runtime contracts. The user confirmed this plan on October 6, 2026. Publisher account readiness, permanent ID approval, and personal policy review are complete. The user called out the ready Chrome source and requested publication to both stores with the same version, after landing completed work on main. That approved source was committed and pushed as `637e20c`; both browser packages target version `2.0.9`. The [GitHub Project execution plan](https://github.com/users/imom39a/projects/2?pane=issue&itemId=263786391) records the dependency-ordered work.
