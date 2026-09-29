# Public site source

The first-party Lightstreamer Workbench site is a static GitHub Pages artifact. Markdown content lives in `site/content/`; shared policy content comes from root `PRIVACY.md` and `SECURITY.md`; current product screenshots come from `docs/assets/`.

The only site JavaScript is `site/assets/site-analytics.js`. It loads the dedicated GA4 website stream (`G-SY4DYL8WH5`) only at the official HTTPS GitHub Pages origin and base path. The website stream has Enhanced Measurement off. Local preview, forks, and offline exports do not load the Google tag. The script sends one `page_view` per document with URL query and fragment removed, no referrer, and `app_surface=website`; GA4 can also collect standard session and engagement information. The privacy page has a browser-local opt-out control. The extension uses a separate stream.

```bash
npm run site:build
npm run site:check
npm run test:site
```

The build writes only public routes and required local assets to ignored `site-dist/`. `.github/workflows/pages.yml` uploads that isolated directory rather than the repository or `docs/` tree.

## Social card

`site/assets/og.png` is the release-current social card copied into the public artifact. `npm run store:assets` composes it from the maintained brand artwork, project logo, and latest generated Workbench screenshot.

The final card remains exactly `1280x640`; `npm run site:check` enforces that dimension.

## Writing style

Use [ASD-STE100-style Simplified Technical English](https://www.asd-ste100.org/) for all public copy. Use short, active sentences. Give one action in each numbered step. Use the same word for the same action or object. Do not use idioms or promotional slogans. Keep official Lightstreamer and Workbench terms exact when a simpler word would change the technical meaning.

Keep each procedure in one guide. The home page and Developer guide link to those procedures instead of repeating them. Keep setup steps in the public MCP guide, not in the panel. Link advanced contracts and source-build instructions to the corresponding GitHub document. Keep safety and data warnings beside the relevant action. Describe published npm packages separately from Chrome Web Store releases.
