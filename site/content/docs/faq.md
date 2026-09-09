## Is this a generic WebSocket inspector?

No. Workbench supports the official Lightstreamer Web Client. It shows Lightstreamer clients, Sessions, Subscriptions, items, fields, COMMAND keys, snapshots, updates, and delivery boundaries.

## Does Workbench connect or subscribe for my application?

No. It observes clients and Subscriptions that the page owns. It does not call `connect()` or `subscribe()` for the application.

## Does Local Injection reach the Lightstreamer Server?

No. Local Injection delivers an Item Update in the inspected page.

## What does Server Injection send?

Server Injection makes one reviewed call through the page-owned client's normal `sendMessage` path. It sends a Client Message; it does not create an inbound Server Update or contact a Data Adapter directly. Processed does not prove a downstream business effect. Workbench never retries an Unknown outcome automatically.

## Does Workbench show the server COMMAND state?

No. Workbench shows captured `ADD`, `UPDATE`, and `DELETE` Evidence and related diagnostics. Derived state supports validation, Scenarios, and Checkpoints. It is not direct access to server state.

## Is captured data uploaded?

No. Captured Evidence, payloads, inspected URLs, search text, Drafts, and raw errors stay in the browser extension context. An export is a local download that you request. The inspected application controls its own network traffic.

Configured production builds separately send fixed feature names, foreground engagement, coarse outcomes, and a random installation identifier to Google Analytics. Turn this off under **More actions → Help & resources → Usage analytics**. Workbench has no maintainer-operated upload service.

## How long is Evidence retained?

Workbench retains Evidence only for the current Panel Session. One Panel Session owns one temporary Event History. IndexedDB can retain 100,000 Evidence records or 256 MiB. The memory fallback can retain 5,000 records or 32 MiB. Reaching either limit removes the oldest accepted prefix while later valid Capture continues. A candidate that cannot enter any canonical segment creates an explicit Evidence Gap; later valid activity remains eligible.

Complete History ends at the current History Interval's Committed Evidence Boundary. The visible Evidence window shows only part of the retained Evidence. Clear ends the current History Interval. Clear does not restart Capture after a terminal stop. A controlled Close tries to erase the Event History. An abnormal stop can leave residual data until Chrome runs the extension again. A new Panel Session starts empty and does not load earlier Evidence.

Capture, Coverage, History Capacity, and Live or Frozen are independent. The memory fallback reduces History Capacity. It does not reduce Coverage by itself. Workbench does not change the storage type during the Panel Session.

## Is Workbench open source?

Yes. The [public GitHub repository]({{github}}) uses the Apache-2.0 license.

## Is this an official Lightstreamer product?

No. Lightstreamer Workbench supports the official Lightstreamer Web Client. This project is independent and is not affiliated with Lightstreamer.
