# Chrome Web Store Listing Assets

This folder contains source-controlled Chrome Web Store release materials for Lightstreamer Event Workbench.

## Generated Assets

Screenshots, 1280x800 PNG:

1. `screenshots/01-command-state-active-keys.png`
2. `screenshots/02-timeline-event-detail.png`
3. `screenshots/03-new-command-update-editor.png`

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

Generated page artwork:

- `../docs/assets/brand-hero-ai.png` - AI-generated original hero artwork
- `../docs/assets/mascot.png` - AI-generated original transparent mascot cutout
- `../docs/assets/real-app-gallery.png` - annotated feature walkthrough generated from the current COMMAND-state screenshot
- `../docs/assets/app-command-state.png` - web-ready real app screenshot generated from `screenshots/01-command-state-active-keys.png`
- `../docs/assets/app-timeline-detail.png` - web-ready real app screenshot generated from `screenshots/02-timeline-event-detail.png`
- `../docs/assets/app-replay-editor.png` - web-ready real app screenshot generated from `screenshots/03-new-command-update-editor.png`

## Regenerate Screenshots

```bash
npm run store:assets
```

The screenshot generator bundles the real panel component, seeds deterministic Lightstreamer COMMAND events, and captures 1280x800 Chrome screenshots. Set `CHROME_PATH` if Chrome is not in a standard location.

Icons are generated from `source/icon.svg` with ImageMagick. Promo tiles are raster-composed by `scripts/generate-store-listing-assets.mjs` from `../docs/assets/brand-hero-ai.png`, the generated 128px icon, and crisp text overlays. The same script also derives real-app GitHub Pages images from the current release screenshots, so rerun it after UI changes and before every store release. Keep `docs/assets/` available when regenerating store assets.

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
