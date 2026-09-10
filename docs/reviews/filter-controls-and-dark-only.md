# Filter controls and dark-only appearance

Workbench supports Dark only. The panel, native form controls, and on-screen Topology HTML report use dark styling. The header and More actions no longer offer appearance controls. Legacy Light/Auto inputs and stored preferences cannot change the effective appearance; system and DevTools theme changes are ignored. Workbench also keeps its dark palette when the operating system requests forced colors, including a light high-contrast palette. Strong contrast, visible selection, and keyboard focus remain supported within that dark palette. Existing print styles and historical design-reference assets are retained.

This user-approved change supersedes the Light/Auto/Follow DevTools and system-palette product requirements in earlier UI contracts and verification records. The maintained visual matrix keeps the same workflows and geometries using Dark, including forced-colors system settings. Earlier screenshot references describe their historical appearance.

Each exact filter value now has one Off / Include / Exclude radio group in selected Evidence Context, the structured Filter explorer, and Notifications. Off removes that value only; Include and Exclude replace one another. Context and Notifications apply immediately, while the full editor retains Apply/Cancel staging. Other criteria, selected Evidence, Find, and Frozen state keep their existing semantics.

Common Context properties precede More properties. Long values have keyboard-accessible disclosures that preserve exact whitespace. A notification value that disappears when switched Off restores focus to Filter notifications. Structured explorers layer above the Timeline and scroll their value list while keeping search and completion controls available.

The shared control is justified by these three existing workflows. It uses native radio inputs, visible selection and keyboard focus, and explicit forced-colors styles. Browser regressions cover polarity switching, exact removal, zero-result recovery, legacy theme inputs, keyboard traversal, long values, and unobscured controls at compact, normal, shallow, and wide sizes.

Review and validation evidence is tracked in internal Project item `filter-state-01 — Unify filter controls and keep Workbench dark` in [Lightstreamer Workbench Project #2](https://github.com/users/imom39a/projects/2). Baselines are intentionally updated only with `npm run test:ui:update`; normal browser verification does not update them.
