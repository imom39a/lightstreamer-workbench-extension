Server Injection sends one reviewed Client Message through the page-owned Lightstreamer client. It uses the current Session and the client's normal `sendMessage` API. It does not create an inbound Server Update.

With extension 2.0.9 and companion 0.1.8, an MCP agent can prepare a Draft. A person must review and approve the exact Client Message and send arguments in the open panel before the agent can send once. Approval does not itself send. Repeated requests retrieve the existing receipt; an Unknown outcome must never be retried automatically.

## Send a message

1. Select a captured Client Message or a live public-API client.
2. Select **Create Server Injection Draft** or **Author Client Message**.
3. Check the page, client, and Session.
4. Edit the message body, sequence, timeout, and disconnected-send choice.
5. Correct validation errors.
6. Select **Review Client Message**.
7. Check every send argument.
8. Select **Send Client Message once**.
9. Read the outcome.

The message format belongs to the application. Use a captured Client Message or the application's documented message contract. An Item Update is not a Client Message template.

A Local Draft or Scenario can block Server Injection until you close it.

## Read the outcome

| Outcome | Meaning |
| --- | --- |
| **Processed** | Lightstreamer handled the message. This does not prove a business result. |
| **Denied** | The server rejected the message. |
| **Discarded** | The message did not reach the Metadata Adapter. |
| **Aborted** | The message was aborted before network transmission. |
| **Unknown** | Workbench cannot prove whether server-side effects occurred. |

Workbench does not retry automatically. **Prepare separate Repeat…** creates a new call and can duplicate effects.

## Application Message Recipes

An application can provide optional recipes for message bodies and arguments. Selecting a recipe fills a Draft. You must still review the message before sending it.

For the adapter contract, see [Server Injection architecture on GitHub](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/docs/ARCHITECTURE.md#server-injection-delivery-architecture).

## Data handling

Server Injection sends data to the application's configured server. Structural exports and bulk copies redact Client Message bodies. A raw copy of one event can contain private data.

Read [Export and privacy]({{site}}docs/export-and-privacy/) before sharing Evidence.
