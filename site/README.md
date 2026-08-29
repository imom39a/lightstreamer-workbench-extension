# Public site source

The first-party Lightstreamer Workbench site is a static, zero-JavaScript GitHub Pages artifact. Markdown content lives in `site/content/`; shared policy content comes from root `PRIVACY.md` and `SECURITY.md`; current product screenshots come from `docs/assets/`.

```bash
npm run site:build
npm run site:check
npm run test:site
```

The build writes only public routes and required local assets to ignored `site-dist/`. `.github/workflows/pages.yml` uploads that isolated directory rather than the repository or `docs/` tree.

## Social card

`site/assets/og.png` is the release-current social card copied into the public artifact. `npm run store:assets` composes it from the maintained brand artwork, project logo, and latest generated Workbench screenshot, then writes the same image to `docs/assets/github-social-preview.png` for repository use.

The final card remains exactly `1280x640`; `npm run site:check` enforces that dimension.
