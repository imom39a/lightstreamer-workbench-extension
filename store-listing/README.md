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

- `../public/icons/icon-128.png` - store icon and extension icon
- `../public/icons/icon-48.png`
- `../public/icons/icon-16.png`

SVG sources:

- `source/icon.svg`
- `source/small-promo-tile.svg`
- `source/marquee-promo-tile.svg`

## Regenerate Screenshots

```bash
npm run store:assets
```

The screenshot generator bundles the real panel component, seeds deterministic Lightstreamer COMMAND events, and captures 1280x800 Chrome screenshots. Set `CHROME_PATH` if Chrome is not in a standard location.

Promo tiles and icons are generated from SVG sources with ImageMagick:

```bash
mkdir -p public/icons store-listing/promo
magick -background none store-listing/source/icon.svg -resize 16x16 -depth 8 public/icons/icon-16.png
magick -background none store-listing/source/icon.svg -resize 48x48 -depth 8 public/icons/icon-48.png
magick -background none store-listing/source/icon.svg -resize 128x128 -depth 8 public/icons/icon-128.png
magick -background none store-listing/source/small-promo-tile.svg -depth 8 store-listing/promo/small-promo-tile.png
magick -background none store-listing/source/marquee-promo-tile.svg -depth 8 store-listing/promo/marquee-promo-tile.png
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
