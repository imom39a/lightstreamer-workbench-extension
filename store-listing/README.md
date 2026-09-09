# Chrome Web Store Listing Assets

This folder contains source-controlled Chrome Web Store release materials for Lightstreamer Workbench.

## Generated Assets

Screenshots, 1280x800 PNG:

1. `screenshots/01-workspace-context.png`
2. `screenshots/02-ordered-evidence-context.png`
3. `screenshots/03-local-injection-editor.png`
4. `screenshots/04-notifications.png`
5. `screenshots/05-server-injection.png`
5. `screenshots/05-server-injection.png`

Promotional images:

- `promo/small-promo-tile.png` - 440x280 PNG
- `promo/marquee-promo-tile.png` - 1400x560 PNG, optional but ready for dashboard upload

Icon:

- `icons/icon-128.png` - store upload icon
- `../public/icons/icon-128.png` - extension package icon
- `../public/icons/icon-48.png`
- `../public/icons/icon-16.png`

SVG sources:

- `source/icon.svg`
- `source/small-promo-tile.svg` - editable promo layout reference
- `source/marquee-promo-tile.svg` - editable promo layout reference

Generated product/site artwork:

- `../docs/assets/brand-hero-ai.png` - AI-generated original hero artwork
- `../docs/assets/mascot.png` - AI-generated original transparent mascot cutout
- `../site/assets/og.png` - 1280x640 public-site social card
- `../docs/assets/real-app-gallery.png` - annotated feature walkthrough generated from the current workspace screenshot
- `../docs/assets/app-workspace-context.png` - web-ready real app screenshot generated from `screenshots/01-workspace-context.png`
- `../docs/assets/app-ordered-evidence-context.png` - web-ready real app screenshot generated from `screenshots/02-ordered-evidence-context.png`
- `../docs/assets/app-local-injection-editor.png` - web-ready real app screenshot generated from `screenshots/03-local-injection-editor.png`
- `../docs/assets/app-notifications.png` - web-ready real app screenshot generated from `screenshots/04-notifications.png`
- `../docs/assets/app-server-injection.png` - web-ready real app screenshot generated from `screenshots/05-server-injection.png`
- `../docs/assets/app-server-injection.png` - web-ready real app screenshot generated from `screenshots/05-server-injection.png`

## Regenerate Screenshots

```bash
npm run store:assets
```

The screenshot generator bundles the real panel component, seeds deterministic Lightstreamer COMMAND events, and captures 1280x800 Chrome screenshots. Set `CHROME_PATH` if Chrome is not in a standard location.

Icons are generated from `source/icon.svg` with ImageMagick. Promo tiles are raster-composed by `scripts/generate-store-listing-assets.mjs` from the maintained brand artwork, generated icon, and crisp text overlays. The same script derives web-ready real-app images and the public-site social card at `site/assets/og.png` from the current release screenshots. Keep `docs/assets/` available when regenerating store assets because the static site build copies the current product screenshots from there.

For icon-only regeneration:

```bash
mkdir -p public/icons store-listing/icons store-listing/promo
magick -background none store-listing/source/icon.svg -resize 16x16 -depth 8 public/icons/icon-16.png
magick -background none store-listing/source/icon.svg -resize 48x48 -depth 8 public/icons/icon-48.png
magick -background none store-listing/source/icon.svg -resize 128x128 -depth 8 public/icons/icon-128.png
magick -background none store-listing/source/icon.svg -resize 128x128 -depth 8 store-listing/icons/icon-128.png
```

## Current Chrome Web Store Requirements Checked

- At least one screenshot is required, with up to five preferred.
- Screenshots should be full-bleed 1280x800 or 640x400.
- Store listing graphic assets include a 128x128 icon, screenshots, small promo tile, and optional marquee tile.
- The item summary should be 132 characters or less.

Official references:

- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- https://developer.chrome.com/docs/webstore/best-listing
- https://developer.chrome.com/docs/webstore/program-policies/listing-requirements
