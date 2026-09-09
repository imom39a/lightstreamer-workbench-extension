# Release Process

This is the local prerelease pipeline for packaging and uploading Lightstreamer Workbench. The Chrome Web Store upload artifact is a ZIP file with `manifest.json` at the archive root. CRX output is optional and intended for local/internal distribution, not normal Web Store submission.

## Release Authority

The GitHub repository is open source under Apache-2.0. The official Chrome Web Store item is controlled by the project maintainers.

- Only release managers or publisher admins listed in [MAINTAINERS.md](MAINTAINERS.md) may upload, submit, stage, publish, cancel, or roll out official Chrome Web Store packages.
- Merging a pull request does not authorize a contributor to publish to the official store item.
- Forks must publish under their own publisher account, extension ID, support channel, screenshots, and listing identity unless the maintainers explicitly approve otherwise.
- Release credentials, service account access, publisher membership, CRX private keys, and Chrome Web Store API tokens must never be committed.

Permission, privacy, host-access, remote-communication, or data-retention changes require release-note coverage and maintainer sign-off before publication.

## Local Package

Run the full local gate and create the Web Store ZIP:

```bash
npm ci
npm run release:package
```

`release:package` runs `npm run typecheck`, runs `npm test`, runs the extension build, validates the built manifest, and writes:

```text
release/lightstreamer-workbench-v<version>.zip
```

Useful variants:

```bash
npm run release:zip
npm run release:package -- --skip-typecheck
npm run release:package -- --skip-tests
npm run release:package -- --skip-build
```

The package step fails if `package.json` and `public/manifest.json` do not use the same version. Before every store update, bump both versions and rebuild.

The local packager also enforces the Workbench release budget: the stored ZIP must remain below 1 MiB. Inspect the ZIP root, run its integrity check, and record the final byte count with the release evidence.

## Version 2.0.1 Preparation Record

Version 2.0.1 is a Non-UI maintenance release of the verified 2.0.0 extension. It changes the package version metadata only; it does not change extension runtime behavior, permissions, data handling, UI, Capture, Event History, or Local Injection semantics. The post-2.0.0 product-source delta is empty. The only intervening repository change updates the internal feature-opportunity assessment and does not ship in the extension package.

The preparation gate completed on 2026-08-12 from base revision `4022f4a130c219567785ca9a99f57625e2b92862` on Darwin arm64 with Node.js `v25.9.0` and npm `11.12.1`:

- `npm ci` completed with zero reported vulnerabilities.
- `npm run store:assets` completed. All three Store screenshots remained byte-identical; the other generated images remained visually identical and their timestamp-only PNG metadata changes were omitted from the release diff.
- `npm run release:package` passed type checking, the serialized `899/899` test suite, the production build, and the release extension audit.
- `release/lightstreamer-workbench-v2.0.1.zip` is 1,041,359 bytes, 7,217 bytes below the strict 1 MiB budget, with SHA-256 `47de573877f632e1cc2291febce14e7fa4efcd9f4fbb1ab37a862a1c657c7678`.
- Compared with the verified 2.0.0 ZIP, `15/16` archive entries are byte-identical. The only changed entry is root `manifest.json`, and its only change is the version from `2.0.0` to `2.0.1`.
- ZIP integrity passed with `manifest.json` at the archive root. The archive and `dist/` manifests are byte-identical, declare version `2.0.1` and Manifest V3, and add neither a `permissions` key nor `unlimitedStorage`.
- `npm run docs:check` passed, and `npm run test:site` passed the isolated site audit and `4/4` browser tests.

The artifact was uploaded on 2026-08-12 to Chrome Web Store item `kfpgbhfphbhkebglopimjhfnnmbifocf` and saved as the version 2.0.1 draft. The dashboard continues to show version 2.0.0 as the published package. The draft Store listing was updated from the maintained `store-listing/` sources with the current description, first-party homepage and support URLs, icon, three screenshots in the prescribed order, small promo tile, and marquee promo tile. No review submission, rollout, publication, Git tag, commit, or push was performed.

## Version 2.0.2 Preparation Record

Version 2.0.2 packages the current Workbench workspace, including Local Injection Scenarios, the Notifications document, the retained Event-order rail, two-line Scope rows, and the selected-update Fields layout. It keeps the existing Manifest V3 permissions, local-only data handling, temporary Event History, and Local Injection server boundary.

The preparation gate completed on 2026-08-30 from base revision `f3e1c0b3606b07bcd31b240a3a5b66e576e92ede` on Darwin arm64 with Node.js `v25.9.0` and npm `11.12.1`:

- `npm run store:assets` regenerated the maintained Store and documentation images.
- `npm run release:package` passed type checking, `1592` tests with `1` skipped, the production build, and the release extension audit.
- `release/lightstreamer-workbench-v2.0.2.zip` is 442,514 bytes with SHA-256 `fead74c24c766d6eaeed985d90e2eb305d5c87dd225a40fd03fc0a4a008f5c5a`.
- ZIP integrity passed with `manifest.json` at the archive root. The archive, `dist/`, and `public/` manifests are byte-identical, declare version `2.0.2` and Manifest V3, and declare neither `permissions` nor `host_permissions`.
- The package was uploaded to Chrome Web Store item `kfpgbhfphbhkebglopimjhfnnmbifocf`; the dashboard showed draft version `2.0.2` and published version `2.0.1`.
- The publisher manually submitted version 2.0.2 for Chrome Web Store review on 2026-08-30. Review and publication remain Chrome Web Store states; no Git tag, commit, or push was performed by this preparation task.

## Version 2.0.3 Preparation Record

Version 2.0.3 is the next candidate above the published 2.0.2 package. It adds Client Message capture, reviewed Server Injection through the inspected client's current Session, Message Recipes, and limited privacy-controlled usage analytics. The Store copy and public site now distinguish Local Injection from Server Injection, describe rolling Event History accurately, and disclose the analytics boundary and persistent off switch.

The local preparation gate completed on 2026-09-09 from base revision `b0b0c85f358f270632acb598e655c9f4e3da644b` on Darwin arm64 with Node.js `v25.9.0` and npm `11.12.1`:

- `npm run analytics:validate` covered all 15 allowed event types. The collection-debug run sent three synthetic events, and GA4 DebugView showed `panel_opened`, `page_view`, and `feature_used` in the dedicated property.
- `npm run store:assets` generated five 1280 x 800 screenshots plus the icon and promo tiles. The complete Store set and its matching website images were visually inspected, including the Server Injection review state.
- `npm run typecheck`, `npm run docs:check`, and `npm run test:site` passed. The full serialized unit gate passed 136 test files with 1,638 tests passed and 1 skipped.
- `CI=1 npm run test:ui` passed `210/210`. Analytics-specific independent review recorded no open visual, responsive, forced-colors, accessibility, or browser-diagnostic findings; four Darwin Local Injection baselines were normalized for the current deterministic scrollbar reservation.
- `npm run test:ui:extension` passed the shipped unpacked-extension smoke, dual-panel isolation, and panel-disposal cleanup. `npm run fixture:test:browser` passed `9/9` official-client scenarios, including one-send Server Injection and Message Recipes.
- `release/lightstreamer-workbench-v2.0.3.zip` is 461,676 bytes with SHA-256 `a4c83c580a1d7c91bc87bbe235dccba83c4a2957920c858e92cb8b21e425fd3b`, below the strict 1 MiB budget. ZIP integrity passed, and the archive, `dist/`, and `public/` manifests are byte-identical.
- The Manifest V3 package declares version `2.0.3`, `storage` for the analytics preference and random installation identifier, and `https://www.google-analytics.com/*` for fixed service-worker Measurement Protocol events. It does not request `unlimitedStorage`, ship a remote analytics SDK, or expose captured Evidence to analytics.

The Chrome Web Store dashboard was audited and updated from `store-listing/LISTING.md` on 2026-09-09. The verified 2.0.3 ZIP is the unpublished draft, and the listing now has the current description, privacy disclosures, reviewer instructions, icon, five screenshots, and both promo tiles. The dashboard still shows 2.0.2 as the published package. The candidate was not submitted for review or published, and no Git tag or rollout was created.

## Usage analytics release contract

[ADR 0015](docs/adr/0015-measure-extension-usage-with-a-closed-analytics-vocabulary.md) records the maintainer-requested replacement of the earlier no-analytics invariant. The candidate enables limited GA4 usage analytics by default with a persistent off switch. Captured Evidence, payloads, inspected URLs, search text, credentials, and raw errors remain outside analytics. This is a Material UI and data-boundary change, not a statement that an existing Store package has changed.

Configure the dedicated stream through ignored `.env.local`, as described in [Usage analytics](docs/USAGE_ANALYTICS.md). Run `npm run analytics:validate` to validate every event type without collecting report data. Automated loaded-extension and fixture verification disable collection themselves. Before publication, build with actual release configuration, verify the control and live ingestion, update Store privacy fields from `store-listing/LISTING.md`, publish the matching policy, and obtain normal release-manager approval. A missing key leaves collection unavailable; validation alone does not prove live ingestion.

The build audit permits Measurement Protocol only in the service worker, rejects remote analytics SDKs, and keeps product analytics out of content scripts. The `storage` and Google Analytics host permissions serve this feature. Earlier preparation records describe their original artifacts and are not rewritten as analytics releases.

## Event History release contract

The delivered Event History implementation has one temporary, Panel Session-owned rolling journal. The normal IndexedDB tier retains up to 100,000 Evidence records or 256 MiB of canonical replay-complete journal bytes; the startup memory tier retains up to 5,000 records or 32 MiB. Reaching either limit advances retention by removing the oldest accepted prefix while Capture continues, and the selected adapter never changes during a Panel Session. Capacity messaging states both dimensions and does not promise 100,000 arbitrary-size payloads.

Complete History means committed Evidence through the current History Interval's Committed Evidence Boundary. Clear is an exact interval cut. Bounded commit recovery and explicit Evidence Gaps keep storage failure separate from Observation Coverage; refused or failed candidates do not silently become Evidence or advance projections. Capture Operation, Observation Coverage, History Capacity, and Live/Frozen state are separate, so startup memory fallback alone does not imply limited Coverage.

Controlled Close attempts erasure and reports the confirmed result. Abnormal termination relies on a later ownership-safe sweep; residual temporary data may remain until Chrome next runs the extension. A new Panel Session starts empty and never replays stale Evidence. Deliberate user exports are the only Capture-derived artifacts intended to outlive the session.

The final frozen release record is for clean product revision `658489b2b1f2d613334b4937b5de41852f1294a3` on Darwin arm64 with headed Chrome for Testing `151.0.7922.71`; the subsequent commit is a documentation record only. The Event History real-Chrome artifact is `REVIEW`, not `PASS`, with zero absolute failures and 16 relative-only findings accepted for cutover under the maintainer/user instruction to use the recommended approach: the JSON report (`/Users/vinothshanmugam/code/history-impl-13-artifacts/final-658489b/event-history-performance.json`, SHA-256 `a559b52d90ea092b47076873c15f5bc9502ce7964a9d39f4cd23d65a6a70dc78`) and Markdown summary (`/Users/vinothshanmugam/code/history-impl-13-artifacts/final-658489b/event-history-performance.md`, SHA-256 `a5bc77dc70f8eb0442309ca70ea1aff5fc0825cc95234111a31da08e5cf5d55d`). The report covers 36/36 cells, 4/4 terminal scenarios, and 4/4 checkpoint scenarios; this is `ACCEPTED REVIEW`, not `PASS`, and any `FAIL` remains a release blocker. The production panel measurement passed (SHA-256 `5eafc968651b48d087f64ae13f827e949c1abd3e55bd4c6434a1144d5d3fc821`): 180 captured events, zero Long Tasks, maximum visible refresh gap 14.4 ms, p95 refresh gap 14.2 ms, 30 recorded lifecycle cycles, non-monotonic lifecycle growth, and 134,068 bytes net retained-heap growth. The final Material UI packet manifest (`test-results/workbench-visual-qa/manifest.json`, SHA-256 `f133bb50a452bce0981a606f733d77eacd95205517ab09c9d3db89fe3dfc285d`) is independently accepted: `17/17` visual scenarios, zero browser diagnostics, and zero serious/critical accessibility findings; the final shipped UI proof is `62/62`, and the final two tracked Darwin baselines are intentionally recorded. The headed official-client fixture passed `3/3`, the shipped unpacked-extension proof passed, and the fresh package remains `release/lightstreamer-workbench-v2.0.0.zip` (SHA-256 `72544b818e2e53851086076532984903a86dcef8e38eceffb4c2c28152de6211`, 1,041,359 bytes). The default `npm test` run passed three consecutive times at `899/899`; the serialized `npm run test:release` run passed `899/899`. All release-record gates are complete for this frozen product revision; no current-HEAD rerun is pending.

The packaged manifest must remain Manifest V3 without `unlimitedStorage`. The analytics candidate's `storage` permission serves analytics preferences and identity, not persistent captured Evidence. Before publication, inspect both `dist/manifest.json` and the ZIP-root `manifest.json`, confirm the package audit passes, and verify that the Store privacy answers, [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and `store-listing/LISTING.md` describe the same data boundaries.

## Store Listing Assets

Source-controlled listing copy, screenshots, icon assets, promo tiles, privacy notes, reviewer instructions, and the dashboard checklist live in:

```text
store-listing/
```

Regenerate the screenshots after UI changes and before each Chrome Web Store release. This also refreshes the real-app images under `docs/assets/` that the static site build copies into its isolated artifact:

```bash
npm run store:assets
```

## GitHub Pages

The public GitHub Pages source lives in `site/`, with policy content sourced from `PRIVACY.md` and `SECURITY.md`. `npm run site:build` writes the isolated, ignored `site-dist/` artifact; `npm run site:check` verifies all stable routes, internal links, local assets, canonical URLs, and the absence of executable tracking code.

Pull requests that change the site run the validation job. A push to `main` affecting site inputs builds and deploys only `site-dist/` through `.github/workflows/pages.yml`; repository documents and source files are never uploaded as public site routes. Manual workflow dispatch uses the same build and check path.

Repository Settings > Pages must use `GitHub Actions` as the build and deployment source. Keep the existing `https://imom39a.github.io/lightstreamer-workbench-extension/` URL; 2.0 does not introduce a custom domain.

## Optional CRX

ZIP is the Web Store package. Use CRX only when you need a locally packed extension artifact:

```bash
npm run release:crx
```

Chrome creates a private key the first time it packs a CRX without `--crx-key`. Keep that key private and reuse it, otherwise the CRX extension ID changes:

```bash
mkdir -p private
mv release/lightstreamer-workbench-v<version>.pem private/lightstreamer-workbench.pem
CRX_KEY_PATH=private/lightstreamer-workbench.pem npm run release:crx
```

Set `CHROME_PATH` if Chrome is not at a standard macOS/Linux path.

## Manual Web Store Upload

For the first item creation or a manual update:

1. Build the ZIP with `npm run release:package`.
2. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. Choose the generated `release/lightstreamer-workbench-v<version>.zip`.
4. Complete listing, privacy, distribution, and test-instructions fields before submission.

The Chrome Web Store docs call for selecting a ZIP package from the dashboard, and their package size limit is 2 GB.

Before submission, verify that [PRIVACY.md](PRIVACY.md), the Chrome Web Store privacy fields, permission justifications, and store listing copy all describe the same behavior.

## API Setup

The local upload CLI targets Chrome Web Store API v2.

Use `.env.release.example` as the template for `.env.release`, then fill:

```bash
CWS_PUBLISHER_ID=...
CWS_EXTENSION_ID=...
CWS_SERVICE_ACCOUNT=...
GOOGLE_CLOUD_PROJECT=...
```

The service account must be added to the Chrome Web Store Developer Dashboard account settings, and the Chrome Web Store API must be enabled in the Google Cloud project.

Generate a short-lived access token:

```bash
set -a
source .env.release
set +a

gcloud auth login --impersonate-service-account="$CWS_SERVICE_ACCOUNT"
gcloud config set project "$GOOGLE_CLOUD_PROJECT"
export CWS_ACCESS_TOKEN="$(gcloud auth print-access-token --impersonate-service-account="$CWS_SERVICE_ACCOUNT" --scopes=https://www.googleapis.com/auth/chromewebstore)"
```

## API Upload And Submission

Upload a selected ZIP:

```bash
npm run release:upload -- --zip release/lightstreamer-workbench-v<version>.zip
```

If `--zip` is omitted, the CLI uses the latest `release/*.zip` matching `package.json` version.

Check status:

```bash
npm run release:status
```

Submit for review with staged publishing. This is the default local publish behavior so an approved release waits for a deliberate publish step:

```bash
npm run release:publish -- --deploy-percent 5
```

Publish automatically after approval, or publish an already approved staged submission:

```bash
npm run release:publish -- --default-publish
```

Increase rollout after publication:

```bash
npm run release:rollout -- --deploy-percent 100
```

Chrome only allows deploy percentage increases for eligible items. If a pending submission needs to be replaced:

```bash
npm run release:cancel
```

## Future CI/CD Shape

The local flow maps directly to CI:

```bash
npm ci
npm run release:package
export CWS_ACCESS_TOKEN="$(gcloud auth print-access-token --impersonate-service-account="$CWS_SERVICE_ACCOUNT" --scopes=https://www.googleapis.com/auth/chromewebstore)"
npm run release:upload
npm run release:publish -- --deploy-percent 5
npm run release:status
```

For GitHub Actions, prefer Workload Identity or another short-lived credential path over committed service account keys. Store `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`, `CWS_SERVICE_ACCOUNT`, and `GOOGLE_CLOUD_PROJECT` as repository/environment secrets.

## References

- [Chrome Web Store API v2 reference](https://developer.chrome.com/docs/webstore/api/reference/rest)
- [Chrome Web Store media upload API](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload)
- [Chrome Web Store publish API](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish)
- [Service accounts for Chrome Web Store API](https://developer.chrome.com/docs/webstore/service-accounts)
- [Manual Chrome Web Store publishing](https://developer.chrome.com/docs/webstore/publish)
