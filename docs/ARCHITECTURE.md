# Architecture

Lightstreamer Workbench is a Chrome Manifest V3 DevTools extension that instruments the inspected page, captures Lightstreamer Web Client activity, normalizes it into internal event envelopes, stores it for the current DevTools session, reconstructs client/session/subscription topology and COMMAND-mode state, and lets developers locally replay synthetic updates through captured listener callbacks or captured Lightstreamer WebSocket paths.

The architecture is event-driven and split across Chrome extension execution contexts. Page-owned code is observed in the page `MAIN` world, capture messages cross the isolated content-script boundary, the service worker routes captures by inspected tab, and the DevTools panel owns storage, filtering, UI state, COMMAND reduction, and local synthetic event display. Reinjection prefers a versioned MAIN-world capability invoked directly with `chrome.devtools.inspectedWindow.eval`. If that global capability is absent after an extension refresh, the panel reuses the page's request-scoped message handler directly; version-skewed or otherwise unavailable page contexts retain the compatibility runtime relay.

## Contents

- [System Goals](#system-goals)
- [Runtime Contexts](#runtime-contexts)
- [Repository Layout](#repository-layout)
- [Build Outputs](#build-outputs)
- [Capture Architecture](#capture-architecture)
- [Message Contracts](#message-contracts)
- [Event Model](#event-model)
- [Storage Architecture](#storage-architecture)
- [Topology State Architecture](#topology-state-architecture)
- [COMMAND State Architecture](#command-state-architecture)
- [Synthetic Reinjection Architecture](#synthetic-reinjection-architecture)
- [Panel UI Architecture](#panel-ui-architecture)
- [Optional Usage Analytics](#optional-usage-analytics)
- [Lightstreamer Fixture](#lightstreamer-fixture)
- [Testing Architecture](#testing-architecture)
- [Extension Points](#extension-points)
- [Operational Notes](#operational-notes)

## System Goals

The project is designed around these concrete implementation goals:

- Capture official Lightstreamer Web Client primitives rather than app-specific business objects.
- Run entirely inside a Chrome DevTools extension for the inspected tab.
- Install instrumentation at `document_start` so clients, subscriptions, and listeners can be wrapped before application code uses them.
- Preserve application behavior while observing constructor calls, lifecycle methods, listener callbacks, and selected wire-level fallback frames.
- Keep capture data local to the browser extension session; optional analytics may receive only a separate typed coarse-event allowlist after explicit consent.
- Support backend-free local reinjection through captured listener callbacks and local TLCP replay on captured page WebSockets.
- Mark synthetic updates in the normalized event stream and UI.

## Runtime Contexts

The extension runs in four active JavaScript contexts plus optional test fixtures:

| Context | Source | Built Output | Main Responsibility |
| --- | --- | --- | --- |
| Page `MAIN` world instrumentation | `src/injected/lightstreamer-instrumentation.ts` | `dist/injected/lightstreamer-instrumentation.js` | Wrap Lightstreamer constructors, client/subscription methods, subscription listeners, WebSocket fallback, and page-side reinjection handling. |
| Isolated content bridge | `src/content/content-script.ts` | `dist/content/content-script.js` | Forward page `postMessage` capture events to the extension runtime and retain a compatibility reinjection relay for older DevTools environments. |
| Extension service worker | `src/extension/background.ts` | `dist/extension/background.js` | Register DevTools panel ports by tab and route capture messages from content scripts to the right panel; retain compatibility routing for reinjection when direct inspected-page evaluation is unavailable. |
| DevTools page loader | `src/extension/devtools.ts` | `dist/extension/devtools.js` | Register the `Lightstreamer Workbench` DevTools panel. |
| DevTools panel UI | `src/extension/panel/main.ts`, `src/extension/panel/bridge-client.ts`, `src/extension/panel/panel.css`, `src/extension/panel/index.html` | `dist/extension/panel/index.js`, `dist/assets/index.css`, `dist/extension/panel/index.html` | Render Timeline, Topology, and COMMAND views, own event storage, build state indexes, edit drafts, call the bridge for reinjection, and gate optional coarse analytics behind in-product consent. |

```mermaid
flowchart LR
  subgraph Page["Inspected page"]
    App["Application code"]
    LS["Official Lightstreamer Web Client"]
    Injected["MAIN-world instrumentation"]
  end

  subgraph Extension["Chrome extension"]
    Content["Isolated content script"]
    Background["MV3 service worker"]
    Devtools["DevTools page"]
    Panel["DevTools panel UI"]
  end

  App --> LS
  Injected -. wraps .-> LS
  Injected -- "window.postMessage(CaptureMessage)" --> Content
  Content -- "chrome.runtime.sendMessage" --> Background
  Devtools -- "chrome.devtools.panels.create" --> Panel
  Panel -- "runtime Port: lsew-panel" --> Background
  Background -- "PanelCaptureMessage" --> Panel
  Panel -- "inspectedWindow.eval(versioned reinjection bridge)" --> Injected
```

## Repository Layout

```text
.
|-- public/
|   |-- manifest.json
|   |-- devtools.html
|   `-- icons/
|-- src/
|   |-- bridge/
|   |-- content/
|   |-- core/
|   |   `-- indexeddb/
|   |-- extension/
|   |   `-- panel/
|   `-- injected/
|-- tests/
|-- fixtures/
|   `-- lightstreamer/
|-- scripts/
|-- docs/
|-- store-listing/
|-- release/
`-- dist/
```

### Source Boundaries

| Directory | Purpose |
| --- | --- |
| `src/bridge/` | Shared message constants, TypeScript contracts, and runtime validators used by all extension contexts. |
| `src/injected/` | Code that must run in the inspected page `MAIN` world so it can patch page-owned Lightstreamer constructors and listener objects. |
| `src/content/` | Isolated content-script bridge between `window.postMessage` in the page and Chrome extension messaging APIs. |
| `src/extension/` | Extension runtime code: MV3 service worker and DevTools panel registration. |
| `src/extension/analytics.ts` | Consent persistence, strict coarse-event serialization, and direct CORS-safe GA4 Measurement Protocol transport. It has no capture-envelope input. |
| `src/extension/panel/` | DOM-rendered DevTools panel UI, bridge client, HTML entry, and CSS. |
| `src/core/` | Runtime-independent domain logic: event envelopes, normalization, filtering, storage, COMMAND state reduction, reinjection drafts, synthetic events, and Lightstreamer-like structural types. |
| `src/core/indexeddb/` | IndexedDB schema/open/delete helpers for event storage. |
| `tests/` | Vitest unit and jsdom integration tests for bridge, instrumentation, core reducers, panel UI, CSS, storage, and reinjection. |
| `fixtures/lightstreamer/` | Deterministic Lightstreamer fixture server assets, Java adapters, and browser fixture page. |
| `scripts/` | Build, extension packaging, Chrome Web Store, store asset, and Lightstreamer fixture helper scripts. |
| `public/` | Static extension manifest, DevTools loader HTML, and icons copied into `dist/`. |
| `dist/` | Generated extension output loaded by Chrome as an unpacked extension. |
| `docs/` | GitHub Pages product site assets and project documentation. |
| `store-listing/` | Chrome Web Store listing copy and media assets. |
| `release/` | Packaged release artifacts. |

## Build Outputs

The package is TypeScript ESM with Vite and Vitest configuration in `vite.config.ts`. The build command in `package.json` is:

```bash
npm run build
```

That script expands to:

```bash
vite build && node scripts/build-content-scripts.mjs && node scripts/verify-extension-build.mjs
```

### Build Pipeline

```mermaid
flowchart TD
  Source["src/ and public/"]
  Vite["vite build"]
  Esbuild["scripts/build-content-scripts.mjs"]
  Verify["scripts/verify-extension-build.mjs"]
  Dist["dist/ unpacked extension"]

  Source --> Vite
  Vite --> Dist
  Source --> Esbuild
  Esbuild --> Dist
  Dist --> Verify
```

Vite uses `src/` as its root and writes to `dist/`. Its Rollup entry points are:

- `src/extension/background.ts` to `dist/extension/background.js`
- `src/extension/devtools.ts` to `dist/extension/devtools.js`
- `src/extension/panel/index.html` to `dist/extension/panel/index.html` and bundled panel assets

The two content scripts are rebuilt separately by `scripts/build-content-scripts.mjs` with esbuild:

- `src/content/content-script.ts` to `dist/content/content-script.js`
- `src/injected/lightstreamer-instrumentation.ts` to `dist/injected/lightstreamer-instrumentation.js`

Those scripts are bundled as browser IIFEs because Chrome content scripts listed in `manifest.json` must not depend on Vite runtime chunks. `scripts/verify-extension-build.mjs` reads `dist/manifest.json`, opens every manifest-listed content script, and fails the build if a content script still contains top-level ESM import/export syntax or relative chunk references.

`public/manifest.json` declares:

- Manifest V3
- `devtools_page: "devtools.html"`
- background service worker `extension/background.js`
- MAIN-world instrumentation script at `document_start`
- isolated content bridge at `document_start`

## Capture Architecture

Capture starts in the inspected page, where the instrumentation script installs constructor hooks and callback proxies.

### Primary API Instrumentation

`installLightstreamerInstrumentation()` in `src/injected/lightstreamer-instrumentation.ts` creates an `InstrumentationState` with:

- Stable ID allocators for clients, subscriptions, and listeners.
- WeakSets for already-wrapped clients, subscriptions, and client listeners.
- WeakMaps from subscriptions to listener proxies.
- A WeakMap from subscriptions to clients, used to attach client IDs to subscription callback events.
- A map of reinjection listener targets keyed by `subscriptionId:listenerId`.
- A map of active wire reinjection targets keyed by normalized subscription ID, retaining the captured socket and TLCP subscription schema.
- A WeakSet of synthetic WebSocket `MessageEvent` objects, used to prevent local replay from being recaptured as server traffic.
- A WeakMap of original `onItemUpdate` callbacks used for synthetic local reinjection.
- An `emit()` function that posts validated capture messages to the page.

It hooks all of these Lightstreamer constructor locations:

- `window.LightstreamerClient`
- `window.Subscription`
- `window.Lightstreamer.LightstreamerClient`
- `window.Lightstreamer.Subscription`
- late assignments to `window.Lightstreamer`

Constructor hooks preserve prototype chains by using `Reflect.construct`, copying the original prototype, and setting the wrapper constructor prototype to the original constructor.

Wrapped client methods:

| Method | Captured Effect |
| --- | --- |
| `connect()` | Emits `client-status`. |
| `disconnect()` | Emits `client-status`. |
| `subscribe(subscription)` | Wraps the subscription, records subscription-to-client ownership, emits `subscription-started`. |
| `unsubscribe(subscription)` | Emits `subscription-ended`. |
| `addListener(listener)` | Wraps client listener callbacks and emits `listener-added`. |
| `removeListener(listener)` | Emits `listener-removed`. |

Wrapped subscription behavior:

- `addListener(listener)` replaces the listener with a proxy that captures selected callback invocations.
- `removeListener(listener)` removes the matching proxy and unregisters reinjection target state.
- The original listener object remains the public identity used for stable listener IDs.

Captured subscription callbacks are listed in `CALLBACKS_TO_CAPTURE`:

- `onEndOfSnapshot`
- `onItemLostUpdates`
- `onClearSnapshot`
- `onItemUpdate`
- `onRealMaxFrequency`
- `onSubscription`
- `onUnsubscription`
- `onSubscriptionError`

Callback names are mapped to capture kinds by `callbackToKind()`. For `onItemUpdate`, `readItemUpdatePayload()` extracts:

- `item.name` from `getItemName()`
- `item.position` from `getItemPos()`
- `update.isSnapshot` from `isSnapshot()`
- full field values from `forEachField()`
- changed field values from `forEachChangedField()`
- JSON patches from `getValueAsJSONPatchIfAvailable(fieldName)`
- COMMAND `command` and `key` from explicit update fields
- raw extraction diagnostics, field counts, callback name, and callback args summary

### WebSocket/TLCP Fallback

The same injected module installs a fallback wrapper around `window.WebSocket` when available. It only performs fallback capture when:

- `host.__LSEW_WS_FALLBACK__` has not already been set.
- the URL contains `/lightstreamer`.
- primary API instrumentation has not marked `host.__LSEW_PRIMARY_ACTIVE__`.

The fallback emits events derived from Lightstreamer TLCP-like text frames:

| Frame or Request | Captured Kind |
| --- | --- |
| WebSocket constructor URL | `client-created` |
| outbound `LS_op=add` | `subscription-created` |
| outbound `LS_op=delete` | `subscription-ended` |
| inbound `CONOK` | `client-status` |
| inbound `SUBOK` or `SUBCMD` | `subscription-started` |
| inbound `UNSUB` | `subscription-ended` |
| inbound `EOS` | `end-of-snapshot` |
| inbound `CS` | `clear-snapshot` |
| inbound `OV` | `lost-updates` |
| inbound `U` | `item-update` |

The fallback maintains per-socket `WireConnectionState`, per-subscription `WireSubscriptionState`, and per-item field snapshots so updates can carry current fields and changed fields. For COMMAND subscriptions, `SUBCMD` supplies key and command field positions; `applyCommandFieldAliases()` renames generated positional fields to `key` and `command` when possible.

Fallback raw diagnostics include `captureSource: "websocket-tlcp"` so normalization marks the event as `captureSource: "wire"`.

### Capture Flow

```mermaid
sequenceDiagram
  participant App as Page app
  participant LS as Lightstreamer Web Client
  participant Inj as MAIN-world instrumentation
  participant CS as Content script
  participant BG as Service worker
  participant UI as DevTools panel

  App->>LS: new LightstreamerClient(...)
  Inj-->>Inj: wrapper allocates client ID
  Inj-->>CS: window.postMessage(CaptureMessage: client-created)
  CS-->>BG: chrome.runtime.sendMessage(RuntimeCaptureMessage)
  BG-->>UI: PanelCaptureMessage over lsew-panel port
  UI-->>UI: normalize to LightstreamerEventEnvelope
  UI-->>UI: append to EventStore
  UI-->>UI: update timeline and COMMAND index

  App->>LS: subscription listener receives onItemUpdate(update)
  Inj-->>Inj: proxy extracts item, fields, snapshot, command, key, raw diagnostics
  Inj-->>CS: CaptureMessage: item-update
  CS-->>BG: RuntimeCaptureMessage
  BG-->>UI: PanelCaptureMessage
```

## Message Contracts

All shared message types and validators live in `src/bridge/messages.ts`. They are intentionally used at every boundary where untrusted runtime data crosses contexts.

### Capture Message

Every capture message has:

| Field | Meaning |
| --- | --- |
| `namespace` | Must be `__LSEW_CAPTURE__`. |
| `version` | Must be `1`. |
| `kind` | One of the known `CAPTURE_KINDS`. |
| `timestamp` | Finite number. |
| `payload` | JSON object, recursively validated as finite JSON data with no cycles. |

Known capture kinds are:

```text
client-created
client-status
subscription-created
subscription-started
subscription-snapshot
subscription-frequency
subscription-ended
subscription-error
listener-added
listener-removed
item-update
end-of-snapshot
lost-updates
clear-snapshot
```

`createCaptureMessage()` builds capture messages, and `isCaptureMessage()` validates inbound values before forwarding.

### Extension Routing Messages

| Message | Direction | Purpose |
| --- | --- | --- |
| `RUNTIME_CAPTURE_MESSAGE` | content script to service worker | Wrap a page capture message for Chrome runtime messaging. |
| `PANEL_REGISTER_MESSAGE` | panel to service worker | Register the panel port for `chrome.devtools.inspectedWindow.tabId`. |
| `PANEL_STATUS_MESSAGE` | service worker to panel | Report bridge lifecycle status. |
| `PANEL_CAPTURE_MESSAGE` | service worker to panel | Deliver a capture message to the matching inspected tab panel. |
| `PANEL_REINJECT_REQUEST` | panel to service worker | Ask to reinject a serialized draft. |
| `CONTENT_REINJECT_REQUEST` | service worker to content script | Forward panel reinjection request to the inspected tab. |
| `PAGE_REINJECT_REQUEST` | content script to page | Ask MAIN-world instrumentation to use the selected captured listener or wire target. |
| `RUNTIME_REINJECT_RESULT` | page to content script | Return page-side reinjection result. |
| `CONTENT_REINJECT_RESULT` | content script to service worker | Relay a compatibility-path page result independently of the original response channel. |
| `PANEL_REINJECT_RESULT` | service worker to panel | Return reinjection result to the panel. |

The `PANEL_REINJECT_REQUEST` → `CONTENT_REINJECT_REQUEST` → `PAGE_REINJECT_REQUEST` message chain remains a compatibility fallback. Current Chrome DevTools reinjection first calls the versioned `__LSEW_REINJECTION_BRIDGE__` MAIN-world capability directly. When that global is missing but the already-loaded page still has an earlier message handler, the panel creates a request-scoped result slot and `MessageChannel` in the inspected page, sends `PAGE_REINJECT_REQUEST` there, and polls only for the correlated result. This avoids depending on an orphaned content-script acknowledgement and does not retry an already-started request. If the page capability is version-skewed or the direct page mechanism cannot start, the panel sends the same validated request through the compatibility runtime chain. The content script also transfers a request-scoped `MessagePort` with its page request. The page validates the serialized draft before touching a listener or WebSocket, and the panel validates the returned result before updating Workbench state.

The MAIN-world handler also publishes `RUNTIME_REINJECT_RESULT` on `window` for compatibility with older content scripts. For extension-reload compatibility, the content script returns the first valid result from either page channel through both the open `sendResponse` channel and `CONTENT_REINJECT_RESULT`. The service worker accepts either protocol, correlates the result by inspected tab and request ID to the panel port that originated it, and removes the pending request on first delivery so redundant feedback cannot produce duplicate panel results.

### Reinjection Draft Payload

`isReinjectionDraftPayload()` requires:

- non-empty `sourceEventId`
- `executionTarget` set to `captured-listener` or `captured-wire`
- non-empty `target.subscriptionId`
- non-empty `target.listenerId` for listener replay; nullable for wire replay
- an item name or an integer item position
- non-empty `command`
- non-empty `key`
- at least one field in `fields`
- JSON-compatible `provenance`
- finite string, number, boolean, or null field values

Reinjection results use one of these statuses:

- `success`
- `stale-target`
- `listener-error`
- `wire-error`
- `bridge-error`

## Event Model

The normalized event shape is defined by `LightstreamerEventEnvelope` in `src/core/event-envelope.ts`.

```mermaid
classDiagram
  class LightstreamerEventEnvelope {
    string id
    number timestamp
    EventDirection direction
    EventSource source
    EventCaptureSource captureSource
    boolean synthetic
    CaptureKind kind
    EventClient client
    EventSubscription subscription
    EventListener listener
    EventItem item
    EventUpdate update
    JsonObject raw
  }

  class EventClient {
    string id
    string status
    string serverAddress
    string adapterSet
  }

  class EventSubscription {
    string id
    string mode
    string[] items
    string itemGroup
    string[] fields
    string fieldSchema
    string dataAdapter
    string requestedSnapshot
    number keyPosition
    number commandPosition
  }

  class EventUpdate {
    boolean isSnapshot
    object fields
    object changedFields
    object jsonPatches
    string command
    string key
  }

  LightstreamerEventEnvelope --> EventClient
  LightstreamerEventEnvelope --> EventSubscription
  LightstreamerEventEnvelope --> EventListener
  LightstreamerEventEnvelope --> EventItem
  LightstreamerEventEnvelope --> EventUpdate
```

`src/core/event-normalizer.ts` converts raw capture messages into this envelope:

- IDs are assigned as `event-1`, `event-2`, and so on by `createEventNormalizer()`.
- Direction is currently normalized to `inbound`.
- Source is normalized to `server` for captured runtime messages.
- `synthetic` is `false` for captured runtime messages.
- `captureSource` is `wire` when raw diagnostics include `captureSource: "websocket-tlcp"`, otherwise `listener`.
- Client, subscription, listener, item, update, and raw data are copied only when they match expected JSON shapes.
- `update.command` and `update.key` can come from explicit update values or from normalized field records.

Synthetic events are created separately by `createSyntheticEventFromDraft()` in `src/core/synthetic-event.ts` and are marked with:

- `id: synthetic-{requestId}`
- `source: "synthetic"`
- `synthetic: true`
- `kind: "item-update"`
- `subscription.mode: "COMMAND"`
- raw provenance including source event ID, target subscription/listener IDs, request ID, result status, edited fields, and draft provenance

## Storage Architecture

The panel depends on the `EventStore` interface from `src/core/event-store.ts`:

```text
append(event)
queryEvents(query)
getEventById(id)
list(filters)
count()
stats()
clear()
subscribe(listener)
close?()
```

There are two concrete storage paths:

| Store | Factory | Backing Storage | Notes |
| --- | --- | --- | --- |
| In-memory store | `createEventStore()` | Array in panel runtime memory | Synchronous, test-friendly, returns immutable list snapshots; burst notifications are bounded. |
| IndexedDB store | `createIndexedDbEventStore()` | IndexedDB via `EventRepository` | Async, stores event envelopes plus derived metadata and search tokens in ordered batches. |

Both stores retain accepted events in capture order and coalesce burst work into bounded batches. IndexedDB commits one transaction per batch, while retained counts are maintained from successful batch completions instead of issuing a count request for every event. Subscriber append notifications carry either one event or an `append-batch`; `clear()` waits behind accepted writes, and `close()` drains accepted writes before closing the backend. This keeps one-off events observable while allowing sustained capture to continue while persistence drains.

The panel overlays a bounded 60-event live tail on the latest durable page so current activity remains visible while an IndexedDB batch is committing. Latest-page reconciliation is single-flight: activity during an active query marks it dirty and causes one follow-up query, rather than invalidating every completed query. The overlay is presentation-only; every accepted event still follows the ordered durable history path.

`bootPanel()` calls `createPanelEventStore()`, which attempts:

```ts
createIndexedDbEventStore({
  sessionId: chrome.devtools?.inspectedWindow?.tabId ?? Date.now(),
  reset: true,
  clearOnClose: true
})
```

If IndexedDB open/reset fails, the panel logs the error and falls back to `createEventStore()`. The panel also closes the event store on `dispose`, `pagehide`, and `beforeunload`; IndexedDB-backed stores created with `clearOnClose` clear their current session before closing. Startup reset remains the backstop if Chrome or DevTools exits before teardown completes.

### IndexedDB Schema

`src/core/indexeddb/event-db.ts` uses schema version `1` and default database name `lsew-events-session`. Session-scoped names are generated as `lsew-events-{sanitizedSessionId}`.

Object stores:

| Store | Key | Purpose |
| --- | --- | --- |
| `events` | auto-increment `seq` | Stores `{ id, envelope }`; has unique `id` index. |
| `eventMeta` | `seq` | Stores denormalized filter fields such as kind, subscription ID, mode, item, command key, command value, snapshot, and synthetic marker. |
| `eventSearchTokens` | `[token, seq]` | Stores tokenized text search metadata for future query acceleration; has `token` and `seq` indexes. |

`src/core/event-repository.ts` handles IndexedDB queries by:

1. Fast-pathing unfiltered limited queries through a cursor so the timeline does not read every metadata row for the common latest-events view.
2. Selecting one indexed structured filter when possible.
3. Applying residual structured filters through metadata.
4. Loading full envelopes and using `matchesEventFilters()` when free-text search is active so IndexedDB-backed search keeps the same substring semantics as the in-memory store.
5. Sorting by sequence and paging.

### Event Store Stats

Both store implementations track:

- retained event count
- total appended event count
- warning threshold
- warning active flag

`DEFAULT_EVENT_WARNING_THRESHOLD` is `10_000`. The panel does not prune retained events when the warning is active. It shows a high-volume notice with `Keep events` and `Clear events` actions.

## Topology State Architecture

`src/core/topology-state.ts` incrementally reduces normalized events into the current inspected-page hierarchy:

```text
page
  client
    session
      subscription
        item
          listener
```

The reducer keeps constructor-only subscriptions visible until client ownership is observed. A Lightstreamer session ID is the authoritative session identity: recovery with the same ID creates a new connection epoch on the same session, while a different ID freezes the prior session and creates a new one. After session loss, locally active subscriptions move to the client-level **Waiting for session** group and attach to the replacement session only after a server-confirmed subscription callback. The extension never creates a Lightstreamer client or session and never calls `connect()` or `subscribe()`; it observes constructors, methods, listeners, and WebSockets owned by the inspected page.

Each client retains at most five compact, immutable historical session snapshots. History keeps topology, configuration, item identities, final observed lifecycle phases, counters, timestamps, and the last observed transport, but not captured payload values or listener objects. Every historical session, subscription, and item is presented as **Frozen**, so a value such as `ws-streaming` cannot be mistaken for a connection maintained by the extension. Historical nodes are read-only reference data and are never reinjection targets.

Logical updates and callback deliveries are separate counters. Primary instrumentation gives every observed `ItemUpdate` object a stable weakly held logical ID; delivery callbacks share that ID, and one callback is marked as the metric owner when object identity is unavailable. Synthetic updates have independent counts and never change server/logical update, snapshot, lost-update, or error totals.

Snapshot phase follows the observed protocol: requested snapshots can move through waiting, snapshot, complete, and live; no-snapshot subscriptions become live after server establishment; clear produces cleared; a new session resets the phase; and fallback wire capture reports unknown when it cannot prove the state. COMMAND subscriptions expose only aggregate generation/key summaries in the structural Topology tree. Raw generation evidence starts as a bounded 25-entry detail collection, expands incrementally, can be copied completely without rendering every identity, and links to full key lifecycle in COMMAND State.

Exact duplicate diagnostics compare mode, item and field descriptors, snapshot, requested frequency, requested buffer size, and second-level COMMAND settings. Partially overlapping active subscriptions remain separate and receive an overlap diagnostic. Only captured errors and lost updates are warning health states; duplicate and overlap findings remain informational diagnostics.

Primary API instrumentation reads documented `connectionDetails` and `connectionOptions` values synchronously from client callbacks. Passwords and HTTP headers are never read. When Lightstreamer exposes a client IP, page-world instrumentation irreversibly masks it before constructing any capture message; the exact address never crosses the inspected-page boundary, and the panel has no exact/masked presentation toggle. Public API clients are marked as full coverage, while WebSocket/TLCP fallback clients are marked as limited coverage so missing options or listener nodes are not mistaken for actual absence. Semantic values retain their evidence state, allowing the panel to distinguish **Unknown**, **Unavailable**, **Redacted**, and **Not applicable** instead of conflating valueless facts.

The panel owns one `TopologyStateIndex` beside the COMMAND index. It rebuilds both indexes from storage on initialization, ingests appended events incrementally, and snapshots only on a scheduled render. **Reset current** clears topology observations only; it preserves captured events, COMMAND state, replay drafts, selections, and the independent live-target registry. **Clear history** removes only frozen session snapshots. The existing **Clear events** action remains the destructive current-session reset.

The live-target registry tracks listener and wire targets independently from topology history. Listener targets can remain valid across a session change, with a warning, if the page bridge confirms the original listener is still registered. Wire targets must still belong to the same session and connection epoch. The panel disables stale replay controls proactively, and the page bridge remains authoritative at execution time.

## COMMAND State Architecture

COMMAND state logic lives in `src/core/command-state.ts`. It is independent of the DOM and can run as a full reducer or incremental index:

- `reduceCommandState(events)` folds an array into a `CommandState`.
- `createCommandStateIndex()` exposes `apply(event)`, `clear()`, and `snapshot()`.

The panel uses the incremental index. On store initialization it replays all existing events into the index. On append it applies the new event.

### COMMAND Reduction Rules

Only events with `kind: "item-update"` and a resolved subscription mode of `COMMAND` affect COMMAND state.

Subscription metadata is carried forward by `knownSubscriptions`. This lets later item-update events with id-only subscription payloads reuse previously captured mode, items, fields, item group, key position, command position, and adapter metadata.

Item identity is resolved by `resolveCommandItemIdentity()`:

| Available Data | Item ID Strategy |
| --- | --- |
| Explicit item name | `name:{itemName}` |
| Subscription `items[]` plus item position | `name:{items[position - 1]}` |
| Item group plus item position | `group:{itemGroup}:position:{position}` |
| Position only | `position:{position}` |
| Nothing usable | `unknown-item` |

COMMAND lifecycle commands are normalized to uppercase and only `ADD`, `UPDATE`, and `DELETE` are supported.

```mermaid
flowchart TD
  Event["LightstreamerEventEnvelope"]
  IsCommand{"item-update and COMMAND?"}
  Metadata["Merge subscription metadata"]
  Item["Resolve item identity"]
  Fields["Read command, key, fields, changedFields"]
  Validate["Create diagnostics"]
  Blocking{"Blocking error?"}
  Existing{"Key active?"}
  Command{"Command"}
  Active["Update activeRows"]
  Deleted["Move key to deletedKeys"]
  Drop["Record diagnostics only"]
  Lifecycle["Append lifecycle entry"]

  Event --> IsCommand
  IsCommand -- "no" --> Drop
  IsCommand -- "yes" --> Metadata --> Item --> Fields --> Validate
  Validate --> Blocking
  Blocking -- "yes" --> Drop
  Blocking -- "no" --> Existing --> Command
  Command -- "ADD" --> Lifecycle --> Active
  Command -- "UPDATE with existing key" --> Lifecycle --> Active
  Command -- "UPDATE missing key" --> Lifecycle --> Active
  Command -- "DELETE existing key" --> Lifecycle --> Deleted
  Command -- "DELETE missing key" --> Drop
```

### Diagnostics

Diagnostics have severity `error` or `warning`, a code, optional server-like message, explanation, and suggestion.

| Code | Severity | Meaning |
| --- | --- | --- |
| `missing-command` | error | COMMAND event has no command value. |
| `missing-key` | error | COMMAND event has no key value. |
| `unsupported-command` | error | Command is not `ADD`, `UPDATE`, or `DELETE`. |
| `unknown-key-delete` | warning | DELETE references a key that is not active, so no row is removed. |
| `unknown-key-update` | warning | UPDATE references a missing key and is treated as effective ADD. |
| `snapshot-update` | warning | Snapshot event used UPDATE. |
| `snapshot-delete` | warning | Snapshot event used DELETE. |

### State Shape

```mermaid
classDiagram
  class CommandState {
    CommandSubscriptionGroup[] subscriptions
    CommandDiagnostic[] diagnostics
  }
  class CommandSubscriptionGroup {
    string subscriptionId
    string mode
    EventSubscription subscription
    CommandItemGroup[] items
    CommandDiagnostic[] diagnostics
  }
  class CommandItemGroup {
    string subscriptionId
    string itemId
    string itemName
    number itemPosition
    CommandRow[] activeRows
    DeletedCommandKey[] deletedKeys
    CommandLifecycleEntry[] lifecycle
    CommandDiagnostic[] diagnostics
  }
  class CommandRow {
    string key
    string status
    object fields
    CommandProvenance origin
    CommandProvenance latest
    CommandLifecycleEntry[] lifecycle
  }
  class DeletedCommandKey {
    string key
    string status
    CommandProvenance deletedAt
    CommandLifecycleEntry[] lifecycle
  }

  CommandState --> CommandSubscriptionGroup
  CommandSubscriptionGroup --> CommandItemGroup
  CommandItemGroup --> CommandRow
  CommandItemGroup --> DeletedCommandKey
```

Provenance labels are:

- `snapshot`
- `live`
- `synthetic-live`
- `synthetic-snapshot`

Each active row keeps origin provenance and latest provenance separately. Deleted keys keep a tombstone with delete provenance and lifecycle history.

## Synthetic Reinjection Architecture

The project does not inject data into a real Lightstreamer server stream. Page reinjection is local and has two explicit delivery paths:

1. The injected script captures original `onItemUpdate` callbacks and active Lightstreamer WebSocket subscription schemas.
2. The panel creates a `ReinjectionDraft`.
3. The panel derives the only valid page target from the capture: `captured-listener` for listener captures or `captured-wire` for wire captures. The action stays disabled if that target is unavailable.
4. The panel invokes the versioned MAIN-world reinjection capability through `chrome.devtools.inspectedWindow.eval`. If a refreshed extension finds the global missing, it first reuses the already-loaded page's request-scoped message handler directly. A version-skewed or unavailable page context falls back to the panel → service worker → content script compatibility relay.
5. For listener replay, the injected script calls the captured callback with a synthetic `ItemUpdate`-like object. For wire replay, it builds a complete schema-ordered TLCP `U` frame and dispatches a local `MessageEvent` on the captured page WebSocket.
6. The page returns a validated `ReinjectionResult` either synchronously to the DevTools evaluation callback or through the correlated compatibility relay.
7. On success, the panel appends a local synthetic event envelope to its store.

There is no panel-only injection path. A page-target failure returns an error and does not append a synthetic event.

```mermaid
sequenceDiagram
  participant UI as DevTools panel
  participant PBC as Panel bridge client
  participant BG as Service worker
  participant CS as Content script
  participant Inj as MAIN-world instrumentation
  participant Listener as Original onItemUpdate
  participant WS as Captured page WebSocket
  participant Store as Panel EventStore

  UI->>UI: create or edit ReinjectionDraft
  UI->>PBC: reinjectDraft(draft, executionTarget)
  alt direct capability available
    PBC->>Inj: inspectedWindow.eval(versioned bridge.reinject)
  else global capability missing, page handler available
    PBC->>Inj: PAGE_REINJECT_REQUEST + response port
    loop until correlated result or timeout
      PBC->>Inj: inspectedWindow.eval(result slot)
    end
  else capability version-skewed or page handler unavailable
    PBC->>BG: PANEL_REINJECT_REQUEST
    BG->>CS: CONTENT_REINJECT_REQUEST
    CS->>CS: create request-scoped MessageChannel
    CS->>Inj: PAGE_REINJECT_REQUEST + response port
  end
  alt captured-listener
    Inj->>Inj: lookup subscriptionId:listenerId target
    Inj->>Listener: callback(createSyntheticItemUpdate(draft))
    Listener-->>Inj: return or throw
  else captured-wire
    Inj->>Inj: lookup active subscription and encode TLCP U frame
    Inj->>WS: dispatchEvent(synthetic MessageEvent)
    WS-->>Inj: dispatch result
  end
  alt direct result
    Inj-->>PBC: ReinjectionResult
  else compatibility result
    Inj-->>CS: RUNTIME_REINJECT_RESULT via response port
    Inj-->>CS: RUNTIME_REINJECT_RESULT via window (legacy fallback)
    CS-->>BG: ReinjectionResult via sendResponse
    CS-->>BG: CONTENT_REINJECT_RESULT (independent fallback)
    BG->>BG: correlate request and accept first result
    BG-->>PBC: PANEL_REINJECT_RESULT
  end
  PBC-->>UI: ReinjectionResult
  UI->>Store: append(createSyntheticEventFromDraft)
```

### Synthetic ItemUpdate Shape

The page-side synthetic update implements:

- `forEachField(iterator)`
- `forEachChangedField(iterator)`
- `getItemName()`
- `getItemPos()`
- `getValue(fieldName)`
- `getValueAsJSONPatchIfAvailable(fieldName)`, currently returns `null`
- `isSnapshot()`
- `isValueChanged(fieldName)`

`createSyntheticItemUpdate()` copies draft fields and ensures `command` and `key` are present in the synthetic field set.

### Draft Workflows

`src/core/reinjection-draft.ts` supports two draft sources:

| Workflow | Function | UI Location | Notes |
| --- | --- | --- | --- |
| Replay captured event | `createDraftFromEvent(event)` | Timeline event detail | **Re-inject** executes the captured values directly; **Mutate & re-inject** opens an editable draft. Requires a captured `item-update` and internally copies fields, changed fields, item, target subscription, and listener. |
| New COMMAND update | `createNewCommandDraftFromContext(context)` | COMMAND detail pane | Requires captured COMMAND subscription, item, listener target, and field schema including `command` and `key`. |

Draft mutation helpers:

- `updateDraftField()`
- `updateDraftCommand()`
- `updateDraftKey()`
- `updateDraftSnapshot()`
- `setManualChangedFieldsOverride()`
- `deriveChangedFields()`

Draft validation:

- `validateEditableDraft()` checks source, subscription target, item context, fields, and field names.
- `validateDraftForExecutionTarget()` checks target-specific listener or wire context plus COMMAND command/key requirements.
- `validateNewCommandDraft()` checks captured COMMAND context, schema membership, the selected execution target, and semantic COMMAND validity against current state.

## Panel UI Architecture

The panel is written as direct DOM construction in `src/extension/panel/main.ts`, with CSS in `src/extension/panel/panel.css`. It does not use React, Vue, or another UI component framework.

`renderPanel(root, state, options)` creates and returns a `PanelController`:

```text
setStatus(status)
appendCaptureMessage(message)
clearEvents()
setBridge(bridge)
dispose()
```

### Panel State Ownership

The panel owns these major state categories:

- bridge status badge
- selected timeline event and pin state
- current timeline query version and render limit
- event store stats and high-volume notice state
- active reinjection draft and reinjection status message
- active view: `timeline`, `topology`, or `command`
- timeline detail pane open/width state
- COMMAND detail pane open state
- COMMAND context events and incremental COMMAND index
- incremental topology index and selected topology node
- selected COMMAND subscription item, key, and update event
- resizable COMMAND pane widths
- timeline filters and COMMAND filters
- render scheduling/defer state during pointer and keyboard interactions

### Timeline View

The Timeline view renders:

- toolbar with product label, status, event count, filtered count, retention notice, and clear button
- search input backed by `EventFilterState.query`
- event rows with time, kind, client, subscription, mode, item, command/key, and source marker
- collapsible detail pane with envelope, subscription, listener, item, raw diagnostics, update, synthetic provenance, and reinjection draft sections

`renderFeed()` queries the store with:

```ts
store.queryEvents({
  filters: filterState,
  order: "asc",
  limit: TIMELINE_WINDOW_SIZE,
  offset: timelineWindowOffset
})
```

`TIMELINE_WINDOW_SIZE` is `60`. The Timeline keeps that fixed DOM bound while all matching events remain retained in the store. **Live** follows the bounded current tail independently from Capture status. Scrolling away from current activity or choosing **Freeze view** anchors the visible matching window, counts newer matching events, and leaves Capture running. **Older** and **Newer** browse the frozen history; **Follow live** returns to the newest window. Event detail selection is independently pinned and never changes Live/Frozen state.

### Topology View

The Topology view renders:

- overview counts for clients, active sessions, active/server-established subscriptions, items, listeners, and capture coverage
- a page → client → session → subscription → item → listener tree with per-branch collapse controls and bounded, lazy item/listener expansion
- at most five compact historical sessions per client, waiting subscriptions, and constructor-only unassigned subscriptions
- requested client/subscription settings beside server-observed bandwidth and real max frequency
- separate logical-update, callback-delivery, synthetic, snapshot-phase, loss, error, listener, exact-duplicate, and overlap metrics
- explicit full, mixed, or limited capture coverage
- current listener/wire replay-target availability and provenance
- bounded COMMAND generation summaries with complete copy access and a route to COMMAND State
- a privacy-review export menu for a deterministic v1 JSON snapshot and a self-contained offline HTML report

Selection and collapsed branches are keyed by stable captured IDs plus current/historical session context and survive passive append renders. Tree and detail scroll positions are restored around live updates. High-volume renders retain the existing tree DOM when its structure is unchanged, update only mutable text/status fields, and use one delegated tree interaction handler.

`topology-export.ts` maps one immutable `TopologyState` snapshot into the shared versioned export schema. Compact evidence collections declare total, included, omitted, truncation, and latest-sampling metadata; complete evidence is opt-in. Server addresses, client IPs, item names, COMMAND keys, configured fields/schemas, and captured identifiers are independently redactable, while credential-like fields and URL credentials are always excluded. `topology-html-report.ts` renders the approved structured snapshot into offline HTML with inline CSS/search only, escaped application-controlled values, collapsible hierarchy, and the same bounded evidence metadata.

### COMMAND State View

The COMMAND view renders four panes:

1. Subscriptions and items.
2. Keys for the selected item, including active and deleted keys.
3. Updates for the selected key.
4. Detail pane for selected key, selected update, diagnostics, and new COMMAND update editor.

Pane widths are stored in CSS custom properties:

- `--command-subscriptions-width`
- `--command-keys-width`
- `--command-updates-width`

Resize handles are accessible separators with keyboard support for left/right arrow adjustments.

### Render Scheduling

The panel avoids rerendering aggressively during high-volume append bursts:

- The first `IMMEDIATE_APPEND_RENDER_BUDGET` appends render immediately.
- Later appends are scheduled with `requestAnimationFrame` when available, or a 16 ms timeout fallback.
- Pointer and keyboard activation defer store-triggered renders until the interaction completes.
- Detail panes can preserve scroll position, focus selector, text selection, and open/closed `details` section state across rerenders.

## Optional Usage Analytics

`src/extension/analytics.ts` is a deliberately separate boundary from capture normalization and storage. Its public `track()` input is a closed TypeScript union of coarse product actions; it never accepts a `CaptureMessage`, `LightstreamerEventEnvelope`, reinjection draft, search string, URL, or raw error.

```mermaid
flowchart LR
  User["User presses Allow analytics"] --> Consent["Persist granted consent + random installation ID"]
  Panel["Panel coarse actions"] --> Allowlist["Typed runtime allowlist"]
  Consent --> Allowlist
  Allowlist --> MP["Bundled GA4 Measurement Protocol transport"]
  MP --> GA["Dedicated GA4 property"]
  Capture["Captured Lightstreamer envelopes"] -. "no analytics API path" .-> Allowlist
  OptOut["User turns analytics off"] --> Stop["Delete ID + block future requests"]
```

The transport sends one event per HTTPS request with advertising consent denied, credentials omitted, no referrer, and no retry path. Failures are swallowed so analytics cannot change capture, storage, rendering, or reinjection behavior. The random client ID is created only after consent. Session summaries use broad count buckets rather than exact high-volume totals.

The transport uses a simple CORS content type accepted by the GA4 Measurement Protocol endpoint, so analytics adds no Chrome permission. Opt-out persists `denied`, deletes the local client ID, and prevents all later transport calls.

Vite reads the dedicated stream's measurement ID and Measurement Protocol secret from `VITE_LSEW_GA_MEASUREMENT_ID` and `VITE_LSEW_GA_API_SECRET`. If either is absent or invalid, the integration reports itself unavailable and the panel renders no analytics UI or transport. No remote script is loaded.

## Lightstreamer Fixture

The fixture under `fixtures/lightstreamer/` provides deterministic scenarios for local and CI-style verification.

| File | Purpose |
| --- | --- |
| `fixtures/lightstreamer/pages/index.html` | Browser fixture page served by the Lightstreamer fixture scripts. |
| `fixtures/lightstreamer/pages/fixture-client.js` | Creates Lightstreamer COMMAND subscriptions and exposes expected deterministic event counts. |
| `fixtures/lightstreamer/pages/mutate-reinject.html` | Application UI used to prove that a mutated update reaches an official Lightstreamer client listener and changes rendered state. |
| `fixtures/lightstreamer/client/mutate-reinject-client.ts` | Module-bundled official client fixture; keeping constructors off `window` forces the production WebSocket/TLCP capture and replay path. |
| `fixtures/lightstreamer/adapter/src/main/java/dev/lightstreamer/workbench/FixtureDataAdapter.java` | Emits deterministic snapshot/live COMMAND rows through a Lightstreamer `SmartDataProvider`. |
| `fixtures/lightstreamer/adapter/src/main/java/dev/lightstreamer/workbench/FixtureMetadataAdapter.java` | Expands the `salesActivity.STORE_NYC_001` item group into invoice and expense items. |
| `fixtures/lightstreamer/adapters/LSEW_FIXTURE/adapters.xml` | Registers fixture data and metadata adapter classes under adapter set `LSEW_FIXTURE`. |
| `scripts/lightstreamer/*` | Helper scripts for building, starting, waiting on, stopping, and testing the fixture. |

Fixture scenarios include:

- `scenario.snapshot-basic`
- `scenario.add-update-delete`
- `scenario.mutate-reinject`, whose `key, command, modelId, modelValues` schema mirrors the reported listenerless COMMAND capture
- high-volume issue-style subscriptions totaling 1,692 expected events across 17 item groups in `fixture-client.js`

The fixture page creates a `LightstreamerClient` for `http://localhost:8080` with adapter set `LSEW_FIXTURE`, adds subscription listeners, connects, and subscribes.

## Testing Architecture

Tests run with:

```bash
npm test
```

Vitest is configured in `vite.config.ts` with:

- environment: `jsdom`
- globals enabled
- include pattern: `tests/**/*.test.ts`

The default `npm test` command runs the Vitest files ending in `.test.ts`. The Lightstreamer fixture smoke check is separate and runs through:

```bash
npm run fixture:test
```

Run `npm run fixture:browser:install` once to install Chrome for Testing into the ignored project cache. `fixture:test` includes the static fixture assertions and `tests/lightstreamer-mutate-reinject.browser.spec.ts`. The browser proof loads the built extension, opens the shipped Workbench panel in a real DevTools session, selects a listenerless `websocket-tlcp` capture, opens **Mutate & re-inject**, edits `modelValues`, and invokes the real panel action. It verifies both direct evaluation and missing-capability fallback, panel success/error rendering, and exact official-client application UI update counts.

All fixture lifecycle and test entry points route through `scripts/lightstreamer/fixture.mjs`; the browser installer uses Puppeteer's cross-platform CLI. The Node runner keeps process arguments and filesystem paths cross-platform, uses built-in HTTP readiness polling instead of `curl`, and invokes Docker and Maven consistently from Windows, macOS, and Linux. The extensionless Bash files remain thin compatibility wrappers for existing Unix workflows.

Coverage is organized by architectural boundary:

| Test File | Boundary Covered |
| --- | --- |
| `tests/bridge-message-validation.test.ts` | Capture and reinjection message validators plus stable ID allocation. |
| `tests/instrumentation-lifecycle.test.ts` | Constructor hooks, namespace hooks, lifecycle wrappers, stable logical update IDs, listener registration/delivery metadata, connection details, WebSocket fallback, and page-side reinjection result behavior. |
| `tests/event-normalizer.test.ts` | Capture-to-envelope normalization, COMMAND key/command preservation, current vs changed fields, snapshot status, and wire source mapping. |
| `tests/event-filter.test.ts` | Event search text and structured filters. |
| `tests/event-store.test.ts` | In-memory store behavior, high-volume stats, IndexedDB-backed queries, substring search parity, cursor paging, reset, and close cleanup behavior. |
| `tests/command-state.test.ts` | Full and incremental COMMAND reduction, grouping, metadata carry-forward, item identity, lifecycle, provenance, diagnostics, and draft validation against state. |
| `tests/topology-state.test.ts` | Session authority and recovery epochs, waiting ownership, logical/delivery/synthetic counters, snapshots, compact five-session history, duplicate/overlap diagnostics, reset semantics, and unassigned subscriptions. |
| `tests/reinjection-draft.test.ts` | Draft cloning, editing, changed-field derivation, validation, and JSON compatibility. |
| `tests/command-draft.test.ts` | Context-bound new COMMAND drafts, schema validation, and synthetic event conversion. |
| `tests/synthetic-event.test.ts` | Synthetic envelope creation from successful reinjection results. |
| `tests/panel-bridge-client.test.ts` | Panel port registration, reconnect, direct reinjection, request-scoped missing-global recovery, version-skew relay fallback, and timeout/error behavior. |
| `tests/panel-shell.test.ts` | Timeline shell rendering, event detail, filtering, high-volume scroll paging, live-history anchoring, Promise/IndexedDB window races, bounded DOM rendering, and direct replay UI. |
| `tests/panel-command-state.test.ts` | COMMAND State workbench rendering, selection, filtering, panes, draft editor, and synthetic append behavior. |
| `tests/panel-topology.test.ts` | Topology tree/detail rendering, sensitive IP presentation, bounded expansion, DOM retention, historical filtering/clearing, non-destructive reset, duplicate/overlap diagnostics, and proactive listener/wire target validity. |
| `tests/panel-css.test.ts` | CSS constraints for the panel. |
| `tests/fixture-runner.test.ts` | Cross-platform fixture npm entry points, runner loading, and argument-safe Docker command construction. |
| `tests/lightstreamer-fixture-capture.spec.ts` | Fixture smoke assertions against served fixture page and Java adapter source; run by `npm run fixture:test`. |
| `tests/lightstreamer-mutate-reinject.browser.spec.ts` | Real Chrome extension + shipped Workbench panel interaction + direct/fallback delivery + listenerless TLCP + official Lightstreamer client + exact rendered application UI update proof. |

Other quality commands:

```bash
npm run typecheck
npm run build
```

Topology performance is a manual merge gate rather than part of every CI run:

```bash
npm run benchmark:topology
```

`.github/workflows/topology-performance.yml` exposes the same gate only through `workflow_dispatch`. It drives the real panel in Chrome for 60 seconds at 1,000 logical updates per second across 20 subscriptions × 50 items with three listener deliveries per update. The run covers collapsed and fully expanded item states, opens a lazy listener branch, and fails on incorrect logical/delivery totals, more than 500 ms of ingestion backlog or UI lag, p95 render time above 16 ms, any task longer than 50 ms, or interaction latency above 100 ms.

Release packaging uses `scripts/package-extension.mjs`, which by default runs typecheck, tests, build verification, extension build validation, and deterministic ZIP creation.

## Extension Points

### Adding a Capture Kind

1. Add the kind to `CAPTURE_KINDS` in `src/bridge/messages.ts`.
2. Emit it from instrumentation or fallback code.
3. Update `LightstreamerEventEnvelope` only if the normalized model needs new top-level fields.
4. Update `event-normalizer.ts` conversion logic.
5. Update `event-filter.ts` or IndexedDB metadata if the kind needs search/filter support.
6. Add tests for validator acceptance, normalization, storage/filtering, and panel rendering.

### Adding Normalized Event Fields

1. Extend the relevant type in `src/core/event-envelope.ts`.
2. Convert only validated JSON data in `src/core/event-normalizer.ts`.
3. Include search text in `createEventSearchText()` if users should find it.
4. Add IndexedDB metadata/index support only when the field needs efficient structured filtering.
5. Render it in panel detail or tables where useful.

### Changing COMMAND Semantics

1. Update `src/core/command-state.ts`.
2. Add or adjust diagnostics with server-like messages, explanations, and suggestions.
3. Update `validateCommandDraftAgainstState()` and `validateNewCommandDraft()` when drafts should follow the same semantic rules.
4. Add tests in `tests/command-state.test.ts` and, if UI behavior changes, `tests/panel-command-state.test.ts`.

### Adding UI Features

The panel is DOM-first. Follow the existing pattern:

1. Add state in the `renderPanel()` closure.
2. Build controls with helper functions such as `createTextElement()` and `createFilterInput()`.
3. Preserve detail pane state when rerendering around user input.
4. Use `resolveMaybe()` when code must work with both sync in-memory stores and async IndexedDB stores.
5. Add jsdom tests in `tests/panel-shell.test.ts` or `tests/panel-command-state.test.ts`.

## Operational Notes

- The source of truth for shared cross-context payloads is `src/bridge/messages.ts`; both the direct page capability and compatibility message path validate drafts and results at runtime boundaries.
- The injected script must remain self-contained after esbuild bundling because it runs as a manifest content script in the page `MAIN` world.
- The content bridge validates both capture messages and reinjection result messages before forwarding.
- The service worker routes panel ports by inspected tab ID; capture messages without a sender tab ID are ignored.
- The panel may use temporary IndexedDB storage, but it resets the inspected-tab session on startup, clears on normal panel teardown, and still has a memory fallback.
- Active wire fallback subscriptions can be replayed locally through their captured page WebSocket even when no listener target was captured. Closed, deleted, unsubscribed, or handed-off targets return `stale-target` without dispatch.
- Synthetic events are appended to panel history only after page-side delivery reports success. Unavailable, stale, rejected, or timed-out page targets never create a synthetic event.
- `dist/` is generated output. Architecture changes should be made in `src/`, `public/`, or `scripts/`, then rebuilt.
