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

`release:package` runs `npm run typecheck`, runs the serialized `npm run test:release`, runs the extension build, validates the built manifest, and writes:

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

## MCP Candidate Bundle

The companion workflow prepares one downloadable bundle after the same npm tarball passes its Windows, macOS, and Linux checks. The local command expects the matching extension ZIP, npm tarball, and `release/agent-release.json` to exist:

```bash
npm run release:zip -- --skip-typecheck --skip-tests
node scripts/prepare-agent-release.mjs
npm run agent:pack
git restore -- agent/package.json
npm run release:mcp-bundle
```

The planner writes `release/agent-release.json` and stamps `agent/package.json` with the selected version and current commit before packing. The restore command returns only that generated metadata to the committed source state; run this sequence from a clean checkout. The bundle is `release/lightstreamer-workbench-mcp-v<extension-version>.zip`. It contains the extension ZIP, companion tarball, `release-manifest.json`, `SHA256SUMS`, and a short `README.txt`. The manifest records each embedded relative path, byte size, SHA-256 digest, version, and full source commit. Packaging reads the ZIP-root extension manifest and npm tarball metadata and fails if their versions or `gitHead` disagree with the plan and checked-out source, or if tracked files are modified. The `workbench-mcp-release-bundle` CI artifact is available beside the existing `workbench-agent-npm` artifact after all three platform checks pass.

The bundle state is `prepared-unpublished` at assembly time. It records whether guarded npm publication is planned; if planned, the publish job waits for all three platform checks and successful bundle assembly. Bundle assembly itself does not publish, and this workflow does not publish the extension to the Chrome Web Store. The first companion package, `lightstreamer-workbench-agent@0.1.0`, was published to npm on September 28, 2026.

## npm companion publication

`.github/workflows/agent-companion.yml` builds one npm tarball and checks that exact artifact on Windows, macOS, and Linux. Pull requests and other branches only test. A matching push to `main` publishes through the `npm` environment and npm trusted publishing with provenance when repository variable `AGENT_NPM_PUBLISH_ENABLED` is `true`. Keep it `false` outside a planned release. The environment permits only `main`; no npm token is stored in GitHub.

The source `agent/package.json` version is the minimum release version. On a publishing run, `scripts/prepare-agent-release.mjs` selects the next unused patch version from npm unless source declares a higher version. CI stamps that version and the source commit into the artifact without a version-only source commit. A retry of an already published commit skips publication; a registry lookup failure stops version selection. Workflow runs are serialized per branch. A manual workflow dispatch on `main` can retry a failed release when the repository variable remains enabled.

An npm unpublish tombstone still reserves every former version; the release planner counts those versions when selecting a new patch. After a full unpublish, keep publication disabled during npm's 24-hour package-name hold. Never attempt to reuse a former version; see the [npm unpublish policy](https://docs.npmjs.com/policies/unpublish/).

Before a planned npm release, review the package README, confirm that the extension compatibility guidance is current, enable the variable, and land the reviewed change on `main`. Wait for package, all three platform checks, release-bundle assembly, publish, and registry verification. Confirm the package's README and dist-tag on npm, then restore the variable to `false`. The Chrome Web Store release has its own gates and authority above. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for publisher configuration.

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

## Version 2.0.5 Preparation Record

The public Chrome Web Store listing showed 2.0.4 on 2026-09-29, so 2.0.5 is the next extension update. This preparation uses product source revision `c8dd5c6ee56dd4746864c4785b3d0c3aaeec6fd3` plus documentation and site-copy changes that do not enter the extension ZIP. The extension includes automatic Panel Session Agent access through a local MCP companion, scoped and byte-bounded Evidence tools, and reviewed Local Injection. Its Manifest V3 removes the 2.0.4 `nativeMessaging` permission; `storage` and the Google Analytics host permission remain.

The local preparation gate completed on 2026-09-29 on Darwin arm64 with Node.js `v25.9.0` and npm `11.12.1`:

- `npm ci` completed. `npm audit --omit=dev` reported zero production dependency advisories; the full development dependency audit reported two high and three moderate advisories in browser/test tooling and an MCP SDK transitive dependency. `npm run release:package` passed type checking, 1,872 unit tests with one skipped, the configured production build, and the extension audit.
- `npm run agent:test:extension` passed the installed companion proof, same-tab dual-panel isolation, panel disposal, and portable Chrome connection/revocation proof. `npm run agent:test:browser` passed the real MCP-to-official-client app proof and 13 headed fixture scenarios with one intentional skip.
- `npm run store:assets` regenerated all five Store screenshots, icon, promo tiles, and site images; every generated image was pixel-identical to its checked-in counterpart, so timestamp-only PNG differences were omitted. The five Store screenshots were visually reviewed.
- The public homepage now explains Agent/MCP access and its data-sharing boundary. `npm run docs:check` and `npm run test:site` passed; the latter verified site routes, website analytics, desktop and mobile layout, and accessibility.
- The configured Store ZIP is `release/lightstreamer-workbench-v2.0.5.zip`, 506,533 bytes, SHA-256 `5f9e6b17a913256d3f4fbfe891dcf80e18177e4029ae97dfef21c12de8b18328`. ZIP integrity passed. All 26 entries are release assets; the ZIP-root, `dist/`, and `public/` manifests agree on version 2.0.5.

The [verified main-branch companion bundle](https://github.com/imom39a/lightstreamer-workbench-extension/actions/runs/36547823118) contains `lightstreamer-workbench-agent-0.1.2.tgz` and an analytics-disabled extension ZIP from the same product source. The configured Store ZIP differs only in `extension/background.js`; use the configured ZIP for Store review. The npm publish job was skipped and the npm registry returned 404 after the September 29 unpublish. The exact tested tarball is now also in the [public MCP companion 0.1.2 release](https://github.com/imom39a/lightstreamer-workbench-extension/releases/tag/agent-v0.1.2), tagged at source commit `c8dd5c6ee56dd4746864c4785b3d0c3aaeec6fd3`. An anonymous download matched SHA-256 `6a7a30a0def5838743aa40d732142849673e8977a85cd6eaa5a39688fca84ae1`; installing that tarball and printing a local MCP configuration succeeded. The Store package was uploaded successfully on September 29, 2026 as a 2.0.5 draft; 2.0.4 remains published. The public companion installation path is verified. Reviewer instructions with the public release and setup guide were saved in the dashboard, and the matching public guide deployed from merge `c616c1feed2d81187bd4879b7f52e233f59ed835`.

The draft listing has the 2.0.5 Agent/MCP description and a short release note. Its fourth screenshot now shows the connected Agent access control and setup pane, replacing the Notifications image; the other four screenshots, icon, and promo tiles remain unchanged. The Store confirmed the listing save. The matching Agent setup guide image is live on the public website.

The 2.0.5 revision was submitted through Chrome Web Store API v2 with `DEFAULT_PUBLISH` on September 29, 2026. The API reported `PENDING_REVIEW` at 100% distribution, and the dashboard independently showed “This draft is pending review.” Google has not yet approved or published 2.0.5; the public version remains 2.0.4.

## Version 2.0.6 Preparation Record

Version 2.0.6 is a Non-UI MCP maintenance release based on verified product source `6feda64a28f3d0253f1c48f26f51370a48cd8646`. It removes cached Evidence from operational status, enforces serialized response budgets for every MCP tool, and pages large discovery and diagnostic lists. Companion 0.1.3 supplies the matching response guard and global pagination fixes. Extension permissions, Capture, Local Injection semantics, and the configured analytics boundary are unchanged.

On September 29, 2026 the Store API confirmed 2.0.4 published and 2.0.5 pending review. At the maintainer's request, the pending 2.0.5 submission was canceled before preparing this replacement. npm publication remains disabled during the post-unpublish package-name hold.

The release source is `3d2fed499d6c097eef3a360a033cd40ab77785a0`. `npm run release:package` passed type checking, 1,891 tests with one skipped, the configured production build, and the extension audit. `npm run test:site` passed all eight browser tests and the site/analytics checks; `npm run docs:check` passed.

The configured Store ZIP is `release/lightstreamer-workbench-v2.0.6.zip`, 509,102 bytes, SHA-256 `64928ae2dc4ea543272213180e17a6c7e2d644daceb56276e04aa4ab0815c2b3`. All 26 archive entries passed integrity checking; the ZIP-root, built, and public manifests agree on 2.0.6. The manifest differs from 2.0.5 only by version. The packaged background contains the configured analytics values. The Store API accepted this exact ZIP with `uploadState: SUCCEEDED` and `crxVersion: 2.0.6`.

Companion 0.1.3 passed the [release workflow](https://github.com/imom39a/lightstreamer-workbench-extension/actions/runs/36630718715), including installed-artifact and response-budget checks on Windows, macOS, and Linux and bundle assembly. A version-specific release-test fixture initially prevented assembly; the final source derives its integration fixtures from package metadata and passes all 12 packaging/preparation tests. Rebuilding from that final source produced the byte-identical Store ZIP above.

The exact tested tarball is published in [MCP companion 0.1.3](https://github.com/imom39a/lightstreamer-workbench-extension/releases/tag/agent-v0.1.3), tagged at the release source commit. Its `gitHead` matches that commit and its SHA-256 is `9d99c852f876399284101c200555ba1260b6144ce9124a75c9985c40a22d31e9`. An anonymous download matched the digest, and installation plus local MCP setup succeeded. The public release also includes the matching bundle, release plan, and `SHA256SUMS`. The bundle SHA-256 is `0f5ce8c1435ed0acb6a200d2f95c114a94156278e9ded5d814c347cc891c899c`. Its extension ZIP has analytics disabled and differs from the configured Store ZIP only in `extension/background.js`.

Version 2.0.6 was submitted on September 29, 2026 through Chrome Web Store API v2 with `DEFAULT_PUBLISH`, blocking on warnings and requesting 100% distribution. A subsequent status read confirmed 2.0.6 `PENDING_REVIEW` and 2.0.4 `PUBLISHED`. Google has not yet approved 2.0.6.

The Mac was locked, so the Store dashboard description and reviewer fields could not be refreshed. The submission retains the existing 2.0.5 feature description and 0.1.2 reviewer link; the public setup guide now identifies 0.1.3, and that older GitHub release starts with a notice directing current setup and Store review to 0.1.3. The maintained 2.0.6 text in [`store-listing/LISTING.md`](store-listing/LISTING.md) is ready for a later dashboard update; it was not saved to the Store during this submission.

## npm companion 0.1.4 Publication Record

Companion 0.1.4 was published to npm on September 30, 2026 after the full-unpublish package-name hold. It contains the same runtime as 0.1.3 and updates the package README with version-pinned npm setup instructions. Source commit `fcdff7d7ba696054484f8d668116abb70ce31a72` passed the [companion workflow](https://github.com/imom39a/lightstreamer-workbench-extension/actions/runs/36682448324): one tarball, installed-artifact and response-budget checks on Windows, macOS, and Linux, and matching bundle assembly.

The exact tested tarball was published through the authenticated maintainer CLI to recreate the deleted npm package. The first authenticated upload returned an npm processing conflict; retrying the same bytes succeeded. This bootstrap publication has npm registry signatures but no CI provenance attestation. Its SHA-256 is `6f43a9a5564a349d7f6dc0586733445cd5aec303509166c2818aeeda3d4a591b`, size 180,224 bytes. The public registry reports version and `latest` tag 0.1.4 and the matching source `gitHead`. An anonymous tarball download was byte-identical to the CI artifact; installing from npm and running the version-pinned `npx` setup command succeeded.

The GitHub Actions trusted publisher was restored for repository `imom39a/lightstreamer-workbench-extension`, workflow `agent-companion.yml`, and environment `npm`. The repository publication variable remains `false` outside planned releases. A Store API status read on September 30 confirmed extension 2.0.6 `PENDING_REVIEW` and 2.0.4 `PUBLISHED`; npm publication does not change the Store release state.

## Extension 2.0.7 and npm companion 0.1.5 Release Record

Product source is `c0f250cba93d5399553f201d9995cd284be1bd26`, pushed to `main` on September 30, 2026. Extension 2.0.7 and companion 0.1.5 fix COMMAND Clear/replay and exact whitespace-key handling, bound historical bookkeeping and retained runtime ownership, preserve encoded JSON during credential redaction, propagate read cancellation, and validate companion identity before reuse. The new exact-key `query_command_state` and existing-receipt `wait_for_operation` tools return bounded results with certainty and provenance. Server Injection preserves accepted correlation receipts and refuses new sends when that receipt capacity is reached. Capture, Local/Server Injection boundaries, extension permissions, and analytics disclosures retain their existing contract. Active COMMAND state and retained Evidence remain proportional to workload; total Chrome heap attribution remains a measurement gap.

Local verification on Darwin arm64 with Node.js `v25.9.0` and npm `11.12.1`:

- `npm ci`, type checking, and the configured production build passed. The serialized package gate passed 185 files with 1,980 tests and one existing opt-in workload skipped. The complete panel browser suite passed 338 checks without baseline changes; nine affected media checks and independent visual review passed.
- The actual versioned companion-to-Chrome-to-official-Lightstreamer proof passed the new key-state/read-point/provenance/receipt assertions, Local Injection transports, duplicate suppression, ordered Scenario, and revocation. The official extension suite passed 13 checks with one existing opt-in 100k-capacity check skipped. An initial Scenario source-selection timeout was followed by three unchanged isolated passes and a full passing rerun; its cause was not established as a production defect.
- Store assets were regenerated. Ten changed screenshot/site exports passed independent comparison; timestamp-only icon and promo changes were omitted. Site verification passed eight browser checks and four analytics unit checks. Documentation and 17 packaging/version/publication-tooling checks passed.
- The configured Store ZIP, `release/lightstreamer-workbench-v2.0.7.zip`, is 516,955 bytes with SHA-256 `4b88e4ec863fb0881e20925fbbd43bd7fa4a0068b639d5e1b91fbd27a871068d`. All 26 DEFLATE entries passed integrity checking; the root, built, and public manifests agree on 2.0.7. Permissions remain `storage` and the existing Google Analytics host permission. The final configured rebuild produced the same digest.

The same companion tarball passed installed-package and response-budget checks on Windows, macOS, and Linux in [release run 36741764070](https://github.com/imom39a/lightstreamer-workbench-extension/actions/runs/36741764070). npm trusted publication with signed provenance succeeded at version 0.1.5. The immediate registry-check step returned 404 before the new version became visible, leaving that workflow marked failed. A later registry read independently confirmed `latest: 0.1.5`, the exact source `gitHead`, and SHA-512 integrity against the tested tarball. Publication was not repeated. Future verification retries only temporary 404 visibility within a fixed budget and rejects wrong name, version, source, or digest. The publication guard was restored to `false`.

The [public 0.1.5 release](https://github.com/imom39a/lightstreamer-workbench-extension/releases/tag/agent-v0.1.5) includes the exact 184,037-byte npm tarball, SHA-256 `6f0b546793d2ae4a659b04166215285b94486e50c34394b41cdec5cd0629d430`, and a matching extension bundle, SHA-256 `4840cfeeeeabbe7e479499f200d955136cd60b1c01d5db483815ba8ce84f5fdb`. The 701,712-byte bundle records the clean product source, artifact sizes/digests, and preparation state. Anonymous download matched the bundle digest; the inner companion matches the tested tarball. Its analytics-disabled extension differs from the configured Store ZIP only in `extension/background.js`. Published npm setup succeeded for both Store and unpacked extension IDs with a pinned version, authentication off, and no extra environment configuration.

The broader [fixture run 36741764139](https://github.com/imom39a/lightstreamer-workbench-extension/actions/runs/36741764139) passed its official-client/MCP proof but exposed a test-runner classification error on Ubuntu and Windows: the new 4,200-update churn regression exceeded the ordinary five-second budget. That regression now uses the existing serialized heavy-work lane. Its workload, assertions, runtime limits, and skips are unchanged; the runner-plan contract verifies all 185 files remain classified exactly once. Follow-up commits change release verification, test classification, and public documentation; they do not change the published companion or configured Store artifact.

Chrome Web Store API accepted the configured 2.0.7 ZIP with `uploadState: SUCCEEDED`. After the maintainer resumed publishing on September 30, 2026, the current description and npm 0.1.5 reviewer instructions were saved and verified. Listing and public-policy wording now distinguish normal Retention Advance from acceptance failure and disclose the existing bounded journal recovery to memory; runtime behavior, permissions, and analytics are unchanged. Existing privacy answers, permission justifications, homepage/support/privacy URLs, and free public distribution were confirmed. The maintainer chose to keep all five current Store screenshots; none was removed or uploaded.

The Store accepted the review submission with `DEFAULT_PUBLISH`, warning blocking, review required, and 100% distribution. A separate API status read and refreshed dashboard confirm 2.0.7 `PENDING_REVIEW`; 2.0.6 remains `PUBLISHED` at 100%. Version 2.0.7 will publish automatically after approval. Approval and actual public availability are still pending. The public site directs 0.1.5 users to the ready-built 2.0.7 download while Google reviews the Store update. The maintained checklist is in [`store-listing/LISTING.md`](store-listing/LISTING.md).

## npm companion 0.1.6 Publication Record

Companion 0.1.6 was published on October 1, 2026 from `d857640c2e54908fe740b464a6e0de83260de239`. This documentation patch replaces the long npm README with a concise overview, direct Chrome Web Store link, version-pinned MCP setup, brief data guidance, and links to the public user guides and GitHub. Package description and homepage now address end users. The runtime is unchanged from 0.1.5 and still pairs with extension 2.0.7; no extension package was uploaded or submitted for this change.

The exact 182,585-byte tarball passed Windows, macOS, and Linux installed-artifact and response-budget checks and bundle assembly in [publication run 36866207287](https://github.com/imom39a/lightstreamer-workbench-extension/actions/runs/36866207287). npm trusted publication succeeded with signed provenance. Its SHA-256 is `70d3e0775c69c3ede8d5c28b96679b93eba858a08adaa892236e160dfd3032ab`. Comparison with published 0.1.5 confirms that only README and package metadata changed; the CLI's embedded package metadata explains its byte difference, and its executable code is identical.

The workflow's final registry check exhausted its two-minute visibility window, leaving the run failed solely at that step. npm [scans publications before making them available](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/), typically for about five minutes and sometimes fifteen or longer. Publication was not repeated. Subsequent public registry verification confirmed version and `latest` 0.1.6, the exact source and integrity, the reviewed README, and an anonymous tarball download matching the tested artifact. The published `npx` setup command also passed. The verifier now allows fifteen minutes between bounded requests while still retrying only 404 and rejecting mismatched artifacts or other errors immediately; its delayed-visibility regression and existing tooling tests passed. The repository publication guard is `false`.

The site guide uses 0.1.6 for new setup while retaining the existing matching 2.0.7 extension download during Store review. User-facing site checks and documentation checks passed. The complete work and evidence are tracked under ignored `.scratch/npm-readme-cleanup/`.

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
