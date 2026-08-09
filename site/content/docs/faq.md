## Is this a generic WebSocket inspector?

No. Workbench targets the official Lightstreamer Web Client and models Lightstreamer-native clients, Sessions, Subscriptions, items, fields, COMMAND keys, snapshots, updates, and delivery boundaries.

## Does Workbench connect or subscribe for my application?

No. It observes page-owned clients and Subscriptions. It does not call `connect()` or `subscribe()` on the application's behalf.

## Does Local Injection reach the Lightstreamer Server?

No. Local Injection delivers through the inspected page. Planned Server Injection will send a Client Message through the page-owned client's normal `sendMessage` path; it will not manufacture an inbound server update.

## Is reconstructed COMMAND state authoritative?

No. Observed Server COMMAND State and Local Effective COMMAND State are evidence-backed projections with explicit coverage limits.

## Is captured data uploaded?

No. Version 2 contains no analytics or maintainer-operated upload path. Deliberate exports remain local downloads. Application traffic produced by the inspected page still belongs to that application.

## How long is Evidence retained?

Only for the current DevTools/tab session. Temporary IndexedDB-backed history is reset on startup and cleared on normal teardown, with an in-memory fallback when needed.

## Is Workbench open source?

Yes. The core product is available under Apache-2.0 in the [public GitHub repository]({{github}}).

## Is this an official Lightstreamer product?

No. Lightstreamer Workbench supports applications using the official Lightstreamer Web Client, but the project is independent and not affiliated with Lightstreamer.
