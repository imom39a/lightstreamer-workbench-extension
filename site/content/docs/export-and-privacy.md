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

Configured Chrome production builds enable usage analytics by default. Firefox analytics starts Off and sends only when both Firefox's optional technical-and-interaction permission and Workbench's analytics preference allow it. Turning it On opens a short consent window; select **Request Firefox permission**, then choose **Allow** in Firefox's native prompt. Cancel or Deny leaves analytics Off and the panel usable.

Analytics sends fixed feature names, foreground engagement, coarse outcomes, version, time, and a random installation identifier to Google Analytics.

Use **More actions → Help & resources → Usage analytics** to turn this off. Turning it off, or removing Firefox's optional permission, removes the saved identifier and analytics session. Granting native permission later does not override an explicit Workbench opt-out.

Extension analytics excludes captured Evidence, payloads, inspected URLs, search text, Drafts, and raw errors. Agent access is separate from analytics. The published website uses a separate Google Analytics stream for page visits. It can set first-party analytics cookies. The website does not send Workbench Evidence to Analytics. Use the [website control]({{site}}privacy/#website-analytics) to turn off website analytics in this browser.

Read the [Privacy policy]({{site}}privacy/) for the complete data policy.
