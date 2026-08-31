Server Injection sends one reviewed Client Message through the official Lightstreamer Web Client already owned by the inspected page. It uses that client's current Session and public `sendMessage` API.

## Start a protected Draft

Use either entry path:

- Select outbound Client Message Evidence and choose **Create Server Injection Draft**. Workbench keeps the captured Source immutable and copies its send arguments into a separate Draft.
- Select a live official public-API client and choose **Author Client Message**. Workbench creates an empty Draft for that exact client, Session, and page.

Only one protected Local or Server Injection Draft, or one Local Injection Scenario, can own the action boundary at a time.

## Edit and review

Edit the message body, sequence, optional delay timeout, and enqueue-while-disconnected choice. The target page, client, and Session are protected. Workbench blocks review when the body or sequence is empty, the timeout is invalid, the bridge is unavailable, or the target is no longer current.

Select **Review Client Message**. The Review phase shows the exact arguments that will cross `LightstreamerClient.sendMessage`. Select **Send Client Message once** only after they are correct.

## Read the outcome

- **Processed**: Lightstreamer handled the Client Message. This is not proof of a downstream business effect.
- **Denied**: the server rejected the message.
- **Discarded**: the message did not reach the Metadata Adapter.
- **Aborted**: the message was confirmed aborted before network transmission.
- **Unknown**: Workbench cannot prove whether server-side effects occurred.

Workbench does not retry. **Prepare separate Repeat…** creates a new call and may duplicate server-side effects. Later Server Updates are ordinary inbound Evidence unless the application supplies explicit attribution metadata.

## Privacy boundary

Client Message bodies are arbitrary application data and remain local to the browser extension context. Structural exports exclude them. Bulk retained-Evidence copies always redact message bodies, processed responses, and denial text. Opening or copying one complete raw event is a deliberate per-event action.

Server Injection is a real inspected-page network action. It does not upload data to a Workbench maintainer service, but the page-owned Lightstreamer client sends the reviewed message to its configured server.
