# Reviewed Activity D references

These three unchanged screenshots archive the maintainer-reviewed single-track
prototype D from `prototype/activity-timeline` at `a06971b`, reviewed on
2026-08-28. They are design references, not production screenshots or pixel
parity targets. The production gate captures the real panel separately.
The originals contained JPEG bytes despite a `.png` filename; the archive
uses `.jpg` filenames without changing those bytes.

The [accepted production contract](../../WORKBENCH_INTEGRATED_ACTIVITY.md)
governs meaning: elapsed time starts at the first retained timestamped event, rather than
the prototype's illustrative “capture start.” Production also retains exact
captured records and scoped facts in existing Evidence and Context.

`npm run test:ui:visual` pairs these assets with normal Dark, compact Light and
wide Dark production Activity states. The shallow forced-colors state retains
the existing Workbench prototype as a density reference. No prototype runtime
is included in the extension build.
