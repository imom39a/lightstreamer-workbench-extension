# Usage analytics

Configured Chrome production builds enable GA4 usage analytics by default. Firefox starts Off and requires its optional `technicalAndInteraction` permission plus the Workbench preference. More actions → Help & resources → Usage analytics contains the disclosure and control. Captured Lightstreamer data and typed text are excluded from analytics.

## Setup

| Purpose | Property | Stream |
| --- | --- | --- |
| Listing visits and installs | Store-managed `541917230`, account `397908666` | Store-managed; cannot add extension instrumentation here |
| Product engagement | Lightstreamer Event Workbench Usage `547418482`, account `402536926` | Chrome extension usage `15339538535`; `G-SHFQ6R7KZK` |
| Documentation website visits | Lightstreamer Workbench Documentation `556788190`, account `402536926` | Documentation website — GitHub Pages `15887962376`; `G-SFDTHQK6C4` |

### Website stream (separate site change)

The [documentation website stream](https://analytics.google.com/analytics/web/#/a402536926p556788190/admin/streams/table/15887962376) is configured for `https://imom39a.github.io/lightstreamer-workbench-extension/`. Enhanced Measurement was verified Off in the Google Analytics UI, so it does not add scroll, click, or form events. The site sends one explicit `page_view` per loaded page with `app_surface=website`; GA4 can also collect its standard session and engagement information. The website uses the site's public JavaScript tag, not the extension's Measurement Protocol stream or secret. This configuration takes effect after site deployment; live receipt in the new property is not yet verified.

The Lightstreamer Event Workbench account `402536926` is the main project account. Documentation appears as its own property in the Properties & Apps picker; the site is a Web stream, rather than an Android or iOS app. The previous website stream `15864929658` (`G-SY4DYL8WH5`) remains in Workbench Usage for historical data. This change sends future visits to the documentation property after deployment; it does not move historical events. The repository publishes to GitHub Pages.

### Extension stream

Use the [Workbench usage property](https://analytics.google.com/analytics/web/#/a402536926p547418482/reports/reportinghub) for feature and journey reports. Store visits, installs, and listing engagement are separate measurements; their user identities are not joined.

Copy `.env.analytics.example` to ignored `.env.local` and supply the stream's Measurement Protocol API secret. `npm run build` and `npm run build:firefox` embed configuration only in the background context. A distributed ingestion key is extractable, as in Chrome's direct Measurement Protocol example. Do not commit it, log collection URLs, or substitute a general account credential. Forks should use their own stream. The AMO reviewer source archive includes only this same extractable ingestion configuration so the submitted build can be reproduced; publisher and account credentials are excluded.

Missing configuration makes collection unavailable. Local development does not collect. Use `LSEW_ANALYTICS_DISABLED=1 npm run build` for an unpacked verification build. The loaded-extension smoke test, official-client fixture tests, and production-build unit test apply that override automatically. The scenario browser suite uses a fake collector. Normal release builds use the configured stream.

`npm run analytics:validate` sends synthetic examples of every event type to `/debug/mp/collect` with strict validation. These requests do not enter reports or DebugView. Google requires `client_id` in `number.number` form and reserves `user_engagement`; Workbench therefore uses `panel_engagement` with the standard engagement parameter. Validation does not check the secret or prove live ingestion.

For deliberate live verification, `npm run analytics:validate -- --collect-debug` additionally sends three synthetic events with `debug_mode=1` and `extension_version=analytics-qa`. Confirm them in the property's DebugView. Exclude that version from adoption analysis. `VITE_LSEW_GA_DEBUG=true` similarly marks events from a deliberate QA build; normal release builds keep it false.

## Events

Every event includes `session_id`, `engagement_time_msec`, `extension_version`, `analytics_schema=1`, and `app_surface=extension`. A random installation identifier supports returning-use analysis. Analytics sessions expire after thirty minutes without reported activity and are unrelated to Lightstreamer Sessions or Panel Sessions.

| Event | Meaning | Additional parameters |
| --- | --- | --- |
| `panel_opened` | Mounted Workbench begins measurement | None |
| `panel_closed` | Best-effort controlled close | None |
| `panel_engagement` | Foreground activity, periodically or on leaving | None |
| `page_view` | Enter the workspace or a document | `screen`, fixed `page_title`, synthetic `page_location` |
| `capture_ready` | First captured activity is available | `coverage`, `storage_mode` |
| `feature_used` | Deliberate feature action | `feature`, `action` |
| `extension_problem` | Coarse operational trouble | `problem` |
| `injection_started` | Open a separate Injection Draft | `injection_type`, `source_kind` |
| `injection_attempted` | Request execution | `injection_type` |
| `injection_result` | Published delivery-boundary outcome | `injection_type`, `outcome` |
| `scenario_action` | Scenario creation, review, control, or membership action | `action` |
| `scenario_result` | Run completes or stops | `outcome` |
| `filter_result` | Applied, empty, invalid, stale, or failed Filter | `outcome` |
| `find_result` | No, one, or multiple Find matches | `result` |
| `export_result` | Preparation, download initiation, or clipboard result | `format`, `outcome` |

`src/extension/analytics/events.ts` is the authoritative closed vocabulary. Features cover Scope, Evidence, Find, Filter, Context, raw Evidence, Activity, Notifications, history, export, clipboard, Injection tools, theme, and help links. Equivalent feature actions are limited to one per second; Find waits 800 ms after typing and reports its result only when the query completes. Neither records text. Query failures are not counted as empty results.

Problem categories distinguish no activity after thirty seconds, bridge disconnection, limited/unavailable Coverage, memory fallback, query failure, history-clear failure, panel errors, and unhandled rejections. Each category is reported once per measurement period. Raw errors and application diagnostic text are excluded.

Injection outcomes retain their domain meaning: Local delivery or Server Client Message processing does not prove a downstream business effect. A download success means the browser download was initiated, not that the file was saved or opened. Export format `scope` denotes preparation before a download format is chosen.

## Reports

The saved [Workbench journeys exploration](https://analytics.google.com/analytics/web/#/analysis/a402536926p547418482/edit/9OTtOBMoTVGF8k77D9m2uQ) starts with a **Capture to investigation** funnel: open Workbench → receive captured activity → use a Workbench feature. It uses indirect steps so ordinary actions between milestones do not break the journey, shows elapsed time, and excludes the synthetic `analytics-qa` version. The recipes below provide narrower engagement, injection and friction analyses as production data arrives.

The usage property has event-scoped custom dimensions registered for `feature`, `action`, `screen`, `injection_type`, `source_kind`, `outcome`, `problem`, `format`, `result`, `coverage`, `storage_mode`, `extension_version`, `app_surface`, and `analytics_schema`. Thirteen were added for this candidate; the existing Extension version definition was reused. Older v1 definitions were preserved. Register the same parameters when configuring another property. Registration makes parameters available in reports and Explorations after processing and is not retroactive.

| Question | Report or exploration |
| --- | --- |
| Where is engagement? | Pages and screens by page title and views; `feature_used` by Feature and Action with active users; total foreground engagement for Workbench |
| Do users reach useful Capture? | Funnel: `panel_opened` → `capture_ready` → `feature_used` where Feature = evidence and Action = select |
| Where do Injection journeys stop? | Funnel: `injection_started` → `injection_attempted` → `injection_result`, split by Injection type and Source kind; inspect Outcome |
| Where is trouble? | `extension_problem` by Problem and Extension version; Injection results by Outcome; empty/invalid/stale Filters and Find with no matches |
| What paths are common? | Path exploration starting at `panel_opened`, using event names or page titles |
| Do users return? | Retention/cohort exploration using this product property's active users |

Use user counts for adoption and event counts for repeated use. Foreground duration is a panel-level metric; this schema does not promise per-feature or per-screen dwell time. Missing completion is not confirmed abandonment: opt-out, offline operation, and panel termination can also omit events. The installation identifier is pseudonymous and does not identify a person.

## Boundaries

Only fixed product labels, coarse states, foreground duration, version, event time, and random identity are sent. No Evidence, Client Message, Draft, inspected URL, server address, runtime identifier, field, key, query, raw error, stack, account detail, clipboard content, or export content is sent. Synthetic page URLs use `lightstreamer-workbench.invalid`.

The background accepts only its own panel's messages and denies advertising consent. Preference reads allocate no identifier. Opt-out blocks sending synchronously, aborts an active request, invalidates queued work, and erases the identifier and session. Re-enabling observes current/future use without a stored backlog.

Firefox DevTools cannot directly request optional permissions. The checkbox opens one transient extension consent window; its direct user click requests Firefox's native permission. Cancellation and Deny save Off. Reopening Workbench preserves Allow/On and Deny/Off without another prompt. A new request requires explicitly turning analytics on while native permission is missing. Removing native permission immediately blocks/aborts sends and erases analytics identities while preserving an explicit Workbench opt-out. Native permission alone cannot enable analytics after that opt-out. Real-browser consent checks are described in [Firefox verification](firefox-testing.md).

There is no persistent event queue or retry. Bounds are 64 pending requests, 120 events per minute, and five seconds per network request. Engagement excludes hidden/unfocused time and stops one minute after the last foreground interaction. Passive Capture does not keep users engaged. Multiple panels share an analytics session, while browser focus determines foreground time.

The [privacy policy](../PRIVACY.md) and [ADR 0015](adr/0015-measure-extension-usage-with-a-closed-analytics-vocabulary.md) define the extension release boundary. The published website has a separate GA4 web stream for page visits. Offline exports remain free of analytics scripts.

## Verification record

The internal review record is **analytics-01 — Add default-on GA4 usage analytics** in [Project #2](https://github.com/users/imom39a/projects/2), marked Done after verification. This is a Material UI change inside the existing More actions surface. The acceptance criteria are a default-on, clearly disclosed, keyboard-operable preference; persistent opt-out; no captured data in transport; accurate engagement and coarse outcomes; and continued Capture/Injection when analytics is unavailable.

The analytics UI checks cover 563×700 Dark, 900×700 Light, 900×320 Dark and forced colors, and 1440×900 Light with high-volume Evidence. Empty, unavailable and failure states use 1280×800 Light. Physical Enter/Tab/Space, mouse-wheel scrolling, focus retention/restoration, saved Off after reopening, shell overflow, and axe serious/critical checks pass. All 210 checks in `CI=1 npm run test:ui` pass. The three changed screenshot pairs—compact Help resources, shallow Help resources and compact Clear confirmation—were deliberately updated using `npm run test:ui:update`; the pinned Playwright Linux image passed all three subsequent read-only comparisons.

An independent reviewer inspected 22 analytics-specific images plus nine accepted-prototype reference/current/diff images. The shallow status-readability evidence gap was resolved with physical-scroll and forced-colors captures. A stale generated packet description was corrected. The final review has no open findings and approves the intended baseline changes. Local review artifacts are in `test-results/analytics-qa/` and `test-results/workbench-visual-qa/`; neither includes private production Capture.

The initial analytics QA package retained the then-current `2.0.2` workspace version and was never a distribution candidate. The current `2.0.3` package verification and Chrome Web Store state are recorded in [RELEASE.md](../RELEASE.md); use that record for release decisions.

`npm run test:ui:extension` passed authentic two-panel Capture and isolated disposal. `npm run fixture:test:browser` passed the Local Injection transport proof and nine official-client browser checks, including Server Injection and Scenario delivery. At the time of this review, `npm run site:check` passed static-page isolation and no executable site tracking; `npm run docs:check` passed. The website now has its own page-visit script.

All 15 event types passed strict Google validation. Three deliberately collected synthetic events appeared in the usage property's DebugView: `panel_opened`, `page_view`, and `feature_used`. The received feature event showed `feature=evidence`, `action=select`, and `extension_version=analytics-qa`. This proves receipt with the configured stream and key; it is not production-user engagement data. The Store-managed property is unchanged.

## References

- [Chrome GA4 integration](https://developer.chrome.com/docs/extensions/how-to/integrate/google-analytics-4)
- [Chrome Web Store listing metrics](https://developer.chrome.com/docs/webstore/metrics)
- [Measurement Protocol reference](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference)
- [Measurement Protocol validation](https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events)
