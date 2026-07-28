# Usage Analytics

Lightstreamer Event Workbench uses an optional, consent-based GA4 stream to answer coarse product questions without transmitting inspected-page data. This document is the analytics data dictionary and reporting guide. [PRIVACY.md](../PRIVACY.md) is the user-facing policy and remains authoritative for data handling.

## Product Questions

The analytics design is intentionally limited to these questions:

1. Do users open the panel and detect Lightstreamer activity?
2. Are Timeline, COMMAND State, and search useful?
3. Which local replay surfaces and listener/wire targets are used?
4. Which coarse replay outcomes need product attention?
5. Are behavior or reliability patterns changing by extension version or broad session volume?

It cannot answer which sites, servers, subscriptions, items, fields, keys, values, queries, or exact errors users work with. Adding any of those would violate the analytics boundary.

## Event Dictionary

All events include `extension_version`, numeric `session_id`, and `engagement_time_msec`. GA receives a random installation-scoped `client_id`; no user ID is set.

| Event | When sent | Custom parameters |
| --- | --- | --- |
| `analytics_enabled` | The user explicitly enables analytics. | None |
| `panel_view` | A consented panel session starts or the panel becomes visible. | None |
| `lightstreamer_detected` | The first captured Lightstreamer event after consent in the current panel session. | None |
| `view_changed` | The user switches between Timeline and COMMAND State. | `workbench_view` |
| `search_used` | The first non-empty search in each view during the current consented session. Search text is never passed to analytics. | `workbench_view` |
| `replay_attempt` | A locally valid replay is submitted to the listener or wire bridge. | `replay_surface`, `replay_target`, `replay_edited` |
| `replay_result` | The inspected page returns a replay result. | `replay_surface`, `replay_target`, `replay_edited`, `replay_outcome` |
| `session_summary` | Normal panel teardown after consent. | `event_count_bucket`, `command_view_used`, `search_used`, `replay_used` |

Allowed values are closed enums:

- `workbench_view`: `timeline`, `command_state`
- `replay_surface`: `timeline`, `command_state`, `new_command`
- `replay_target`: `listener`, `wire`
- `replay_outcome`: `success`, `stale_target`, `listener_error`, `wire_error`, `bridge_error`
- `event_count_bucket`: `0`, `1_10`, `11_100`, `101_1000`, `1001_plus`
- Boolean flags are encoded as `0` or `1`.

## GA4 Custom Definitions

Register these event-scoped custom dimensions in the dedicated property:

| Display name | Event parameter |
| --- | --- |
| Extension version | `extension_version` |
| Workbench view | `workbench_view` |
| Replay surface | `replay_surface` |
| Replay target | `replay_target` |
| Replay edited | `replay_edited` |
| Replay outcome | `replay_outcome` |
| Event count bucket | `event_count_bucket` |

The three session-summary flags do not need custom definitions because the corresponding `view_changed`, `search_used`, and `replay_attempt` events provide less ambiguous usage counts.

## Recommended Reports

### Activation funnel

Build a funnel exploration with:

1. `panel_view`
2. `lightstreamer_detected`
3. Any of `view_changed` or `search_used`
4. `replay_attempt`
5. Successful `replay_result`

Use this to distinguish capture/detection friction from feature discovery and replay friction. Because analytics is opt-in, treat funnel percentages as directional rather than a census of all installs.

### Replay reliability

Filter to `replay_result`, break down by `replay_target`, `replay_surface`, and `replay_outcome`, then compare `extension_version`. A rise in `bridge_error` suggests connectivity/version-skew work; `stale_target` suggests the UI may need clearer freshness guidance; listener/wire errors warrant targeted fixture and bridge tests. No raw error detail is available by design.

### Feature adoption

Plot `view_changed`, `search_used`, and `replay_attempt` event counts by `extension_version`. Use the unique-user metric only as an approximate opt-in installation count; the random client ID is deleted on opt-out and may be regenerated after storage clearing.

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
