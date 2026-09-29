## Export Evidence

1. Select the Scope you want to export.
2. Open **More actions → Export current Scope**.
3. Select JSON or offline HTML.
4. Review the redaction options.
5. Create the export.

An export is a local download. Workbench excludes credentials and Client Message bodies from structural exports. Full Evidence requires an explicit choice and can contain private application data.

**Copy retained scoped Evidence** also redacts Client Message bodies, processed responses, and denial text. A complete raw copy of one event can contain application data.

## Agent access

Requested Evidence can pass to your local MCP client and its model provider. Local access has no authentication. Read [MCP setup]({{site}}docs/agent-access/#access-and-data) before connecting an agent.

## Temporary storage

Each Panel Session owns its Event History. A new panel starts empty. A controlled Close attempts erasure. An abnormal stop can leave residual data until the extension runs again.

See [retained history]({{site}}docs/evidence/#retained-history) for capacity, rolling retention, and storage failure behavior.

## Usage analytics

Configured production builds enable usage analytics by default. They send fixed feature names, foreground engagement, coarse outcomes, version, time, and a random installation identifier to Google Analytics.

Use **More actions → Help & resources → Usage analytics** to turn this off. Turning it off removes the saved identifier and analytics session.

Analytics excludes captured Evidence, payloads, inspected URLs, search text, Drafts, and raw errors. Agent access is separate from analytics. This website has no analytics, cookies, or tracking scripts.

Read the [Privacy policy]({{site}}privacy/) for the complete data policy.
