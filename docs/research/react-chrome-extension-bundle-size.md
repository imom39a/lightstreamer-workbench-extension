# React bundle size in the Chrome DevTools extension

Research date: 2026-08-04

Scope: whether a locally bundled React UI creates a Chrome Web Store publication or package-size risk for the Lightstreamer Workbench Manifest V3 DevTools panel. Sources are limited to official Chrome, Vite, React/npm metadata, and the current local production build.

## Conclusion

**React is not a Chrome Web Store package-size blocker for Workbench.** The Store's documented hard ceiling is a **2 GB uploaded extension ZIP**. The current Workbench production output is approximately 436 KiB unpacked, and the repository's deterministic release packager produces a 409,818-byte Store ZIP. A measured React 19.2.8 and React DOM 19.2.8 production baseline adds 193,486 uncompressed bytes (60,424 gzip bytes). Even the temporary dual-renderer package remains orders of magnitude below the upload limit. [Chrome Web Store publishing guide](https://developer.chrome.com/docs/webstore/publish/)

The meaningful risks are instead:

- JavaScript parse, execution, and memory cost when a DevTools panel opens;
- adding React to extension contexts that do not render the panel;
- accidentally loading executable code from a CDN or dependency at runtime;
- producing enough generated or difficult-to-review code to lengthen Store review.

Chrome says submissions with a lot of code or hard-to-review code may take longer to review. Normal minification and file collapsing are allowed; obfuscation is not. [Chrome Web Store review process](https://developer.chrome.com/docs/webstore/review-process), [code-readability policy](https://developer.chrome.com/docs/webstore/program-policies/code-readability)

The recommendation is therefore to proceed with React, bundle it locally into the panel only, and add release bundle and startup-performance gates.

## Store and runtime constraints

### Package upload

- The submitted artifact is a ZIP containing the extension files, with `manifest.json` at its root. [Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)
- The maximum supported extension package is **2 GB**; larger ZIP files are rejected. This is an upload ceiling, not a sensible performance budget. [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish/)

No special lower package limit is documented for a React extension or a DevTools panel.

### Manifest V3 and remote code

Manifest V3 requires the extension's executable logic to be self-contained and reviewable in the submitted package. A script tag pointing outside the package, evaluating remotely fetched code, or hiding logic behind a remote command interpreter can cause rejection. Chrome explicitly identifies locally importing a framework such as React as the supported alternative to CDN loading. [Manifest V3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements), [Manifest V3 security guidance](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)

Consequently:

- include React and React DOM in the production extension bundle;
- do not load React, JSX transforms, plugins, or other executable dependencies from a CDN;
- audit the compiled extension, not only source imports, because dependencies can introduce runtime code loading. [Remote-hosted-code guidance](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)

### Extension-page CSP

A DevTools panel is a separate HTML extension page. Manifest V3's extension-page CSP therefore applies to the React root and its emitted assets. [DevTools panels API](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels)

The default extension-page policy loads scripts and objects from the package itself. It does not permit inline executable JavaScript or evaluating strings, and the minimum policy cannot be relaxed with `'unsafe-eval'`. A standard Vite production build with local external scripts is compatible; a runtime JSX compiler or dependency that needs `eval()`/`new Function()` is not. [Extension-page CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)

## Current Workbench baseline

Measured from the existing local `dist/` production output on 2026-08-04:

| Artifact | Baseline |
| --- | ---: |
| Entire `dist/`, unpacked | 436 KiB |
| Store ZIP from `scripts/package-extension.mjs` | 409,818 bytes (about 400 KiB; entries are stored without deflate compression) |
| Same `dist/` with ordinary ZIP deflate, for comparison only | 117,077 bytes (about 114 KiB) |
| Panel JavaScript, uncompressed | 256,581 bytes (about 251 KiB) |
| Panel JavaScript, gzip-compressed | 74,165 bytes (about 72 KiB) |
| Minimal React 19.2.8 + React DOM 19.2.8 production bundle, uncompressed | 193,486 bytes (about 189 KiB) |
| Same React baseline, gzip-compressed | 60,424 bytes (about 59 KiB) |
| Same React baseline, Brotli-compressed | 51,836 bytes (about 51 KiB) |

These values are an engineering baseline, not Chrome Web Store limits. The repository ZIP is much larger than the deflated comparison because `scripts/package-extension.mjs` writes ZIP entries with compression method 0 (stored). The Store limit applies to the actual uploaded ZIP, so 409,818 bytes—not the smaller deflated comparison—is the correct publication baseline.

The React measurement was produced with the repository's current esbuild, production minification, `react`, `react-dom/client`, and `useSyncExternalStore`; it measures the framework floor rather than the completed Workbench UI and is not an exact additive forecast. A framework choice should be assessed from the actual Workbench production bundle; npm package `unpackedSize` is not a useful proxy because a client build includes only the selected browser entry points and build output.

## Recommended gates

### Required for every production package

1. Build and package the exact Store ZIP in CI.
2. Record the repository packager's actual ZIP bytes, unpacked bytes, every JavaScript chunk's uncompressed and gzip sizes, and the delta from the last released baseline.
3. Fail if the Store ZIP reaches the 2 GB platform ceiling. In practice, alert far earlier on the internal engineering budget.
4. Scan the compiled extension for remote executable imports/loaders, inline executable script, `eval`, and `new Function`; verify that the packaged extension installs under its declared CSP.
5. Confirm React appears only in the DevTools panel bundle—not in the service worker, content script, or inspected-page instrumentation bundles unless a separate design explicitly requires it.

### Initial engineering budget for the migration

Use these as starting guardrails, not Chrome requirements:

- keep every initial-load panel JavaScript chunk at or below **500 kB uncompressed**, matching Vite's default chunk-size warning threshold; Vite notes that uncompressed JavaScript size relates to execution time. [Vite build options](https://vite.dev/config/build-options.html#build-chunksizewarninglimit)
- keep the actual stored-entry Store ZIP below **1 MiB** during the UI migration and require an explicit review to raise it;
- capture cold panel time-to-first-usable-frame, scripting/parse time, long tasks, and retained heap on representative low- and high-volume histories;
- set the performance pass/fail threshold from a React vertical-slice baseline before replacing the old UI, rather than treating compressed transfer size as sufficient evidence.

Because an extension panel has `onShown` and `onHidden` lifecycle events, expensive view-only work can be activated when the panel is visible while the capture/runtime boundary remains independent. [DevTools panels API](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels)

Vite production builds are minified by default and report gzip-compressed sizes by default, so the repository can enforce these measurements without a separate packaging system. [Vite build options](https://vite.dev/config/build-options.html#build-minify), [compressed-size reporting](https://vite.dev/config/build-options.html#build-reportcompressedsize)

## Migration decision

Adopt React for the new Workbench panel with these constraints:

1. React owns the new panel UI only.
2. The Workbench runtime, capture, bridge, content script, and page instrumentation stay framework-independent.
3. All executable dependencies ship locally in the extension package and pass Manifest V3 CSP checks.
4. The first vertical slice establishes a measured size, startup, and memory baseline; subsequent slices must report their delta.
5. The legacy UI is removed at cutover so the final package does not permanently carry two renderers.

Under those rules, Chrome Web Store publishing size is not a reason to reject React. Runtime discipline and reviewability should govern the migration instead.
