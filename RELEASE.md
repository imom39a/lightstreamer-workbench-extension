# Release Process

This is the local prerelease pipeline for packaging and uploading Lightstreamer Event Workbench. The Chrome Web Store upload artifact is a ZIP file with `manifest.json` at the archive root. CRX output is optional and intended for local/internal distribution, not normal Web Store submission.

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
release/lightstreamer-event-workbench-v<version>.zip
```

Useful variants:

```bash
npm run release:zip
npm run release:package -- --skip-typecheck
npm run release:package -- --skip-tests
npm run release:package -- --skip-build
```

The package step fails if `package.json` and `public/manifest.json` do not use the same version. Before every store update, bump both versions and rebuild.

## Store Listing Assets

Source-controlled listing copy, screenshots, icon assets, promo tiles, privacy notes, reviewer instructions, and the dashboard checklist live in:

```text
store-listing/
```

Regenerate the screenshots after UI changes and before each Chrome Web Store release. This also refreshes derived GitHub Pages real-app preview images under `docs/assets/`, while keeping the stable brand artwork in place:

```bash
npm run store:assets
```

## GitHub Pages

The public GitHub Pages site lives in `docs/`. Publishing a GitHub release runs `.github/workflows/pages.yml`, compares the release tag with the previous reachable tag, and deploys through GitHub Pages only when `docs/**` changed.

Repository Settings > Pages must use `GitHub Actions` as the build and deployment source. Manual workflow dispatch uses the same `docs/**` change detection gate.

## Optional CRX

ZIP is the Web Store package. Use CRX only when you need a locally packed extension artifact:

```bash
npm run release:crx
```

Chrome creates a private key the first time it packs a CRX without `--crx-key`. Keep that key private and reuse it, otherwise the CRX extension ID changes:

```bash
mkdir -p private
mv release/lightstreamer-event-workbench-v<version>.pem private/lightstreamer-event-workbench.pem
CRX_KEY_PATH=private/lightstreamer-event-workbench.pem npm run release:crx
```

Set `CHROME_PATH` if Chrome is not at a standard macOS/Linux path.

## Manual Web Store Upload

For the first item creation or a manual update:

1. Build the ZIP with `npm run release:package`.
2. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. Choose the generated `release/lightstreamer-event-workbench-v<version>.zip`.
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
npm run release:upload -- --zip release/lightstreamer-event-workbench-v<version>.zip
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
