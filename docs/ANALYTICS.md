# Usage Analytics

Lightstreamer Workbench uses an optional, consent-based GA4 stream to answer coarse product questions without transmitting inspected-page data. This document is the analytics data dictionary and reporting guide. [PRIVACY.md](../PRIVACY.md) is the user-facing policy and remains authoritative for data handling.

## Product Questions

The analytics design is intentionally limited to these questions:

1. Do users open the panel and detect Lightstreamer activity?
2. Is Ordered Evidence search useful?
3. Which Local Injection entry categories and listener/wire targets are used?
4. Which coarse Local Injection outcomes need product attention?
5. Are behavior or reliability patterns changing by extension version or broad session volume?

It cannot answer which sites, servers, subscriptions, items, fields, keys, values, queries, or exact errors users work with. Adding any of those would violate the analytics boundary.

## Event Dictionary

All events include `extension_version`, numeric `session_id`, and `engagement_time_msec`. GA receives a random installation-scoped `client_id`; no user ID is set.

The Slice 3 cutover migrated the telemetry schema to current product language. New events use `local_injection_*`; the former Replay and peer-view event names are not emitted by the accepted Scoped Evidence Workspace. Historical GA4 data may still contain the retired names, so reports should segment by `extension_version` when comparing releases across the cutover.

| Event | When sent | Custom parameters |
| --- | --- | --- |
| `analytics_enabled` | The user explicitly enables analytics. | None |
| `panel_view` | A consented panel session starts or the panel becomes visible. | None |
| `lightstreamer_detected` | The first captured Lightstreamer event after consent in the current panel session. | None |
| `search_used` | The first non-empty Ordered Evidence search during the current consented session. Search text is never passed to analytics. | None |
| `local_injection_attempt` | A locally valid Injection Draft is submitted to the listener or wire bridge. | `local_injection_surface`, `local_injection_target`, `local_injection_edited` |
| `local_injection_result` | The inspected page returns a Local Injection delivery result. | `local_injection_surface`, `local_injection_target`, `local_injection_edited`, `local_injection_outcome` |
| `session_summary` | Normal panel teardown after consent. | `event_count_bucket`, `search_used`, `local_injection_used` |

Allowed values are closed enums:

- `local_injection_surface`: `selected_evidence`, `command_scope`
- `local_injection_target`: `listener`, `wire`
- `local_injection_outcome`: `success`, `stale_target`, `listener_error`, `wire_error`, `bridge_error`, `acknowledgement_unknown`, `partial`
- `event_count_bucket`: `0`, `1_10`, `11_100`, `101_1000`, `1001_plus`
- Boolean flags are encoded as `0` or `1`.

## GA4 Custom Definitions

Register these event-scoped custom dimensions in the dedicated property:

| Display name | Event parameter |
| --- | --- |
| Extension version | `extension_version` |
| Local Injection entry category | `local_injection_surface` |
| Local Injection target | `local_injection_target` |
| Injection Draft edited | `local_injection_edited` |
| Local Injection outcome | `local_injection_outcome` |
| Event count bucket | `event_count_bucket` |

The session-summary flags do not need custom definitions because `search_used` and `local_injection_attempt` provide less ambiguous usage counts.

## Recommended Reports

### Activation funnel

Build a funnel exploration with:

1. `panel_view`
2. `lightstreamer_detected`
3. `search_used`
4. `local_injection_attempt`
5. Successful `local_injection_result`

Use this to distinguish Capture/detection friction from Evidence-search and Local Injection friction. Because analytics is opt-in, treat funnel percentages as directional rather than a census of all installs.

### Local Injection reliability

Filter to `local_injection_result`, break down by `local_injection_target`, `local_injection_surface`, and `local_injection_outcome`, then compare `extension_version`. A rise in `bridge_error` suggests connectivity/version-skew work; `stale_target` suggests the UI may need clearer target-freshness guidance; `acknowledgement_unknown` identifies cases where Workbench cannot prove delivery; `partial` identifies mixed listener outcomes. Listener/wire errors warrant targeted fixture and bridge tests. No raw error detail is available by design.

### Feature adoption

Plot `search_used` and `local_injection_attempt` event counts by `extension_version`, then break Local Injection down by `local_injection_surface`. Use the unique-user metric only as an approximate opt-in installation count; the random client ID is deleted on opt-out and may be regenerated after storage clearing.

### Session volume

Break down `session_summary` by `event_count_bucket`. This is suitable for deciding whether high-volume rendering deserves more investment, but it must not be converted back into exact captured-event counts.

## Property Settings

- Use a separate GA4 property and web stream dedicated to this extension.
- Keep account data-sharing options, Google signals, advertising personalization, and unnecessary product links disabled.
- Use the shortest practical event-data retention (two months where available).
- Do not enable User-ID, URL/page collection, enhanced measurement, or automatic web page events for this Measurement Protocol-only stream.
- Monitor for spam because a Measurement Protocol secret shipped in client code is extractable; rotate the dedicated secret if needed.

## Release Configuration

Set the two Vite variables only in the official release environment:

```text
VITE_LSEW_GA_MEASUREMENT_ID=G-...
VITE_LSEW_GA_API_SECRET=...
```

Without both values, analytics is unavailable: no disclosure is displayed, no identifier is created, and no analytics request is sent. Never commit populated values.
