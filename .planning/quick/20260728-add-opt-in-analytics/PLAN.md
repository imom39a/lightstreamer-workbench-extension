# Quick Task: Add privacy-first opt-in usage analytics

Status: complete

## Objective

Create a dedicated GA4 property and web data stream for Lightstreamer Event Workbench, then add optional coarse product analytics to the Chrome DevTools extension without transmitting inspected-page data.

## Scope

- Use GA4 Measurement Protocol from bundled extension code; do not load remote scripts.
- Require an explicit in-panel opt-in before any identifier is created or request is sent.
- Use a CORS-safe direct HTTPS request that requires no new Chrome permission; opt-out deletes the identifier and blocks all future analytics requests.
- Send only allowlisted feature events: panel visibility, Lightstreamer detection, view/search usage, replay attempt/result categories, and a bucketed session summary.
- Never send inspected URLs, server addresses, client/subscription/listener/item/field/key identifiers, captured values, search text, raw errors, stack traces, or replay drafts.
- Deny advertising consent and do not use analytics for advertising.
- Update privacy, release, contribution, and Chrome Web Store disclosure documentation.
- Cover the consent gate, payload allowlist, opt-out, failure isolation, UI controls, and analytics hooks with automated tests.

## Verification

- `npm run typecheck`
- `npm test`
- `npm run build`
- Validate the configured stream with GA4 Measurement Protocol debug/realtime tools after property creation.

## External setup

- Create a separate Analytics account/property instead of reusing the Chrome Web Store-managed listing property.
- Create a web stream and dedicated Measurement Protocol secret.
- Keep Google signals and advertising uses disabled.
- Register only the coarse custom dimensions needed for internal product reports.

## Current external state

- Dedicated account and property created: `Lightstreamer Event Workbench` / `Lightstreamer Event Workbench Usage`.
- Dedicated web stream created with enhanced measurement off.
- Account data-sharing options, Google signals, user-provided data, granular location/device reporting, and ads personalization are off.
- Event and user data retention are both set to two months; activity-based retention reset is off.
- Seven coarse event-scoped custom dimensions are registered.
- The public measurement ID and dedicated `Chrome extension v1` Measurement Protocol secret are configured in ignored `.env.local` after the maintainer completed Google's User Data Collection Acknowledgement.
- The exact production payload passed the Measurement Protocol debug endpoint with zero validation messages.
- A production smoke request returned HTTP 204 and GA4 DebugView reported one received event.
- TypeScript typechecking, all 248 automated tests, and the production extension build pass with the configured stream.
