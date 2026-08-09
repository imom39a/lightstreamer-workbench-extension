# Public site source

The first-party Lightstreamer Workbench site is a static, zero-JavaScript GitHub Pages artifact. Markdown content lives in `site/content/`; shared policy content comes from root `PRIVACY.md` and `SECURITY.md`; current product screenshots come from `docs/assets/`.

```bash
npm run site:build
npm run site:check
npm run test:site
```

The build writes only public routes and required local assets to ignored `site-dist/`. `.github/workflows/pages.yml` uploads that isolated directory rather than the repository or `docs/` tree.

## Social card

`site/assets/og.png` is the release social card copied into the public artifact. It is composed from:

- `site/source/og-background.png`: one image-generation result created after the 2.0 site design stabilized;
- `site/source/og-overlay.svg`: deterministic, reviewable title and release copy;
- `public/icons/icon-128.png`: the existing project icon.

The generated-background prompt was:

> Create an original, understated wide technical illustration of ordered streaming evidence converging into one unified investigation workspace. Use a near-black grid, thin mint evidence traces, restrained blue accents, and calm negative space on the left. Match the credible Chrome DevTools density in the provided Workbench reference. Include no text, letters, numbers, logos, screenshots, browser chrome, people, mascots, watermark, fake code, or generic AI swirls.

The final card must remain exactly `1280x640`; `npm run site:check` enforces that dimension.
