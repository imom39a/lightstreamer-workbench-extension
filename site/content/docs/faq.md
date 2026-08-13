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

Only for the current Panel Session. One Panel Session owns one temporary Event History: the normal IndexedDB tier supports up to 100,000 retained Evidence records or 256 MiB of canonical replay-complete journal bytes, while the startup memory fallback supports up to 5,000 records or 32 MiB. The first independent limit reached controls admission; 100,000 arbitrary-size payloads are not promised.

Complete History means committed Evidence through the current History Interval's Committed Evidence Boundary; the rendered Evidence window is only a bounded view. Clear makes an exact History Interval cut and does not restart Capture after a terminal stop. Controlled Close attempts erasure and reports what was confirmed. If Chrome, DevTools, or the renderer ends abnormally, a later ownership-safe cleanup sweep may be needed, so residual temporary data can remain until Chrome next runs the extension. A new Panel Session starts empty and never replays stale Evidence from an earlier session.

Capture Operation, Observation Coverage, History Capacity, and Live/Frozen view state are independent. An in-memory fallback lowers History Capacity but does not by itself make Coverage limited; the selected history adapter is not switched during a Panel Session.

## Is Workbench open source?

Yes. The core product is available under Apache-2.0 in the [public GitHub repository]({{github}}).

## Is this an official Lightstreamer product?

No. Lightstreamer Workbench supports applications using the official Lightstreamer Web Client, but the project is independent and not affiliated with Lightstreamer.
