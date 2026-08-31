Server Injection sends one reviewed Client Message through the official Lightstreamer Web Client already owned by the inspected page. It uses that client's current Session and public `sendMessage` API.

## Start a protected Draft

Use either entry path:

- Select outbound Client Message Evidence and choose **Create Server Injection Draft**. Workbench keeps the captured Source immutable and copies its send arguments into a separate Draft.
- Select a live official public-API client and choose **Author Client Message**. Workbench creates an empty Draft for that exact client, Session, and page.

An inbound Item Update is context, not a Client Message template. The message body is application-defined and must be accepted by that application's Metadata Adapter. Workbench cannot generically infer how `qty: 20` should be encoded as an upstream request.

If the inspected application exposes a compatible Message Recipe, Workbench shows it above the empty editor. Choosing **Use …** copies that recipe's exact body and send arguments into the Draft; the developer can still edit and review them. Without a recipe, capture an outbound Client Message and clone it, or author the body from the application's documented message contract.

Only one protected Local or Server Injection Draft, or one Local Injection Scenario, can own the action boundary at a time.

## Edit and review

Edit the message body, sequence, optional delay timeout, and enqueue-while-disconnected choice. The target page, client, and Session are protected. Workbench blocks review when the body or sequence is empty, the timeout is invalid, the bridge is unavailable, or the target is no longer current.

Select **Review Client Message**. The Review phase shows the exact arguments that will cross `LightstreamerClient.sendMessage`. Select **Send Client Message once** only after they are correct.

## Add application Message Recipes

Message Recipes are an optional page-owned adapter, not a Workbench message schema. Install a synchronous version-1 adapter before opening the Draft:

```js
globalThis.__LSEW_CLIENT_MESSAGE_RECIPE_ADAPTER__ = {
  version: 1,
  list(context) {
    if (context.item.name !== "scenario.snapshot-basic" || context.update?.key !== "beta") {
      return [];
    }
    return [{
      id: "inventory.update-fields.v1",
      label: "Update fields for beta",
      description: "Uses the selected COMMAND key and current version.",
      message: JSON.stringify({
        type: "update-fields",
        item: context.item.name,
        key: context.update.key,
        expectedVersion: context.update.fields.version,
        fields: { qty: context.update.fields.qty }
      }, null, 2),
      sequence: "INVENTORY_FIELD_UPDATES",
      delayTimeout: null,
      enqueueWhileDisconnected: false
    }];
  }
};
```

The context contains bounded source, target, client adapter-set, Subscription, item, and update facts. Return at most 12 recipes. Each recipe must provide a unique `id`, visible `label` and `description`, non-empty exact `message` and `sequence`, a null or non-negative integer `delayTimeout`, and an explicit `enqueueWhileDisconnected` boolean. The adapter must return synchronously; Workbench validates its untrusted result and never applies a recipe without a deliberate click.

For the example shown in Workbench, changing `"qty": "20"` to `"qty": "25"` sends the edited JSON through `sendMessage`. Only the application's Metadata Adapter can interpret that request and ask its Data Adapter or other backend component to publish a later Server Update.

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
