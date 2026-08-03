# Chrome DevTools interaction conventions for Lightstreamer Workbench

Research date: 2026-08-03

Chromium DevTools source snapshot: [`b963582b6689f136a8222c91bc005060b9f0616d`](https://chromium.googlesource.com/devtools/devtools-frontend/+/b963582b6689f136a8222c91bc005060b9f0616d)

Scope: interaction conventions for a Chrome DevTools extension panel; this report does not choose the Workbench information architecture.

## Executive finding

Workbench should behave like a debugging instrument embedded in DevTools, not like a dashboard-shaped web application. The strongest recurring DevTools pattern for Workbench's kind of data is a thin action bar, a dense navigable evidence surface, selection-driven detail, compact persistent status, and contextual actions. Chromium's Protocol Monitor is the closest direct precedent: it combines recording, clear/save controls, a structured filter, a striped data grid, a resizable selected-message detail pane, contextual actions, and a collapsible command editor without surrounding the evidence in cards or explanatory chrome. This is an **observed convention**, not a mandatory layout or a decision that Workbench must copy Protocol Monitor's information architecture. [Protocol Monitor source](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/panels/protocol_monitor/ProtocolMonitor.ts#L193-L353)

The most important platform fact is that an extension panel is its own HTML page. The public API creates the panel and exposes theme state, but it does not expose Chromium's private component library. Workbench therefore needs to reproduce the *behavioral language* with semantic HTML and local components; it should not import or vendor DevTools frontend internals. The extension API currently reports only `default` (light) and `dark`, even though built-in DevTools can use dynamic Chrome accent themes. [Chrome `devtools.panels` API](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels)

Density should come from prioritization, compact controls, tables, trees, truncation with inspection, and progressive disclosure—not from shrinking every target or showing every control continuously. Current Chromium uses a 26 px toolbar, 26 px toolbar buttons, approximately 20 px data-grid rows, and 16 px minimum tree rows; those values are useful evidence of the product's compact posture, not a public extension-panel contract. Workbench should keep independent interactive targets at least 24 by 24 CSS pixels and use 24 px as the normal floor for selectable rows, reserving tighter line heights for non-interactive evidence. This is a deliberate accessibility adjustment to current built-in density. [Toolbar CSS](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui/legacy/toolbar.css#L7-L18), [button CSS](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui/components/buttons/button.css#L75-L100), [data-grid CSS](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui/legacy/components/data_grid/dataGrid.css#L84-L111), [tree CSS](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui/legacy/treeoutline.css#L75-L91), [WCAG 2.2 target size](https://www.w3.org/TR/WCAG22/#target-size-minimum)

Local Injection is the justified exception to copying a conventional inspector action. Protocol Monitor can offer “Edit and resend” directly from a captured outgoing command. Workbench capture is observational, so a captured Server Update must remain immutable; Local Injection must fork an explicitly named draft, keep the target Subscription visible, and mark the successful result as locally injected. The affordance can be contextual and compact, but the state transition cannot be visually collapsed into ordinary selection or editing. [Protocol Monitor contextual action](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/panels/protocol_monitor/ProtocolMonitor.ts#L484-L525), [Keep capture observational](../adr/0001-keep-capture-observational.md), [Scope Local Injection to one Subscription](../adr/0002-scope-local-injection-to-one-subscription.md)

## How to read the findings

The report uses three evidence levels:

- **Requirement**: a public Chrome extension platform boundary or a normative WCAG 2.2 success criterion.
- **Observed convention**: behavior documented in official Chrome DevTools documentation or implemented in Chromium DevTools source. It is strong compatibility evidence, but not automatically a requirement for an extension panel.
- **Recommendation**: an inference for Workbench based on those requirements, conventions, and accepted Workbench domain decisions.

The WAI-ARIA Authoring Practices Guide (APG) is used as first-party implementation guidance for composite widgets. APG patterns are not themselves WCAG conformance requirements, and an ARIA role without its expected keyboard behavior is worse than native semantic HTML.

## Platform boundary and design relationship

### Facts

- **Requirement:** a DevTools extension panel is a separate extension HTML page. It can use the `chrome.devtools` and other extension APIs, but the public panel API does not provide built-in DevTools toolbars, grids, trees, or split views. [Chrome `devtools.panels` API](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels)
- **Requirement:** the public theme contract is `default` or `dark`, with `themeName` for the current value and `setThemeChangeHandler()` for changes. `default` is documented as light. [Chrome `devtools.panels` theme API](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels#type-Theme)
- **Observed convention:** built-in DevTools follows system/light/dark preferences and can dynamically match Chrome's color theme. That richer accent information is not exposed by the public extension-panel theme API. [Customize DevTools](https://developer.chrome.com/docs/devtools/customize#theme)
- **Observed convention:** Chromium asks its own contributors to use one reusable component for a repeated task and to rely on established UI implementations because they include less-obvious behavior such as accessibility. That supports behavioral consistency, but those components remain Chromium internals rather than an extension SDK. [Chromium DevTools UI engineering](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/docs/ui_engineering.md#L1-L31)

### Candidate Workbench rules

1. Use Chrome DevTools as the governing interaction language and Workbench's own semantic component layer as the implementation boundary.
2. Do not import, copy wholesale, or depend on Chromium's private frontend modules. Native elements should be the default; custom widgets must implement complete semantics and keyboard behavior.
3. Use internal semantic tokens—surface, container, divider, text, subtle text, selected, focus, warning, error, success/provenance—instead of raw palette values. This mirrors Chromium's system-token/application-token separation without depending on its private token names. [Chromium color-token guidance](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/docs/styleguide/ux/styles.md#L5-L40)
4. Treat exact visual parity as a best effort. Behavioral parity, compact hierarchy, focus behavior, and theme correctness matter more than copying a transient Chrome pixel value.

## Closest built-in precedent: Protocol Monitor

Protocol Monitor is unusually relevant because it is also a developer-facing live protocol inspector. Its current composition supplies useful evidence without deciding Workbench's eventual IA:

- a top toolbar starts/stops recording, clears, saves, and provides a growing filter input with `key:` and `-key:` suggestions;
- a striped, sortable, hideable-column data grid carries the message stream;
- selecting a message populates request/response details in a resizable secondary pane;
- row context actions include **Edit and resend**, **Filter**, and **Documentation**;
- a bottom toolbar exposes a compact command input, while a toggle opens a larger editor when needed. [Protocol Monitor view](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/panels/protocol_monitor/ProtocolMonitor.ts#L193-L353), [Protocol Monitor context actions](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/panels/protocol_monitor/ProtocolMonitor.ts#L484-L525)

The transferable pattern is **observe → select evidence → inspect → take a contextual action**. The non-transferable detail is that Protocol Monitor's “Edit and resend” operates on an outgoing command, whereas Workbench Local Injection creates an additional local update from an immutable observed source.

## Detailed interaction conventions

### Toolbars and action hierarchy

**Observed convention.** Built-in DevTools uses compact action bars for high-frequency, current-context controls. The Chromium UX guide says primary buttons should be rare, icon buttons belong in toolbars for compact contextual actions, and ordinary actions should normally use outlined or lower-prominence styles. It also treats micro buttons as a small-line-height exception. [Chromium button guidance](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/docs/styleguide/ux/components.md#L11-L49)

**Observed convention.** Recording tools place the recording toggle first, followed by clear and export/save, then filters and configuration. Network documents recording as on by default, with a focused-panel shortcut, a neighboring clear action, and **Preserve log** as an explicit state. Protocol Monitor follows the same ordering. [Network recording controls](https://developer.chrome.com/docs/devtools/network/reference/#record), [Protocol Monitor toolbar](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/panels/protocol_monitor/ProtocolMonitor.ts#L203-L236)

**Recommendation.** A Workbench action strip should contain only actions that apply to the visible working context. Capture state, clear, and export are global/session actions; selection-dependent actions such as copy or starting a Local Injection draft belong next to the selected evidence or in a selection action group. Avoid a page header plus multiple card-level toolbars that duplicate scope.

**Recommendation.** Use icon-only buttons only for familiar actions with an accessible name and a tooltip. Chrome documents that tooltips expose shortcuts; Workbench should follow that convention for every assigned shortcut. Unfamiliar or consequential actions—especially **Create local injection draft** and **Inject update**—need text labels at the point of decision. [Chrome DevTools shortcuts](https://developer.chrome.com/docs/devtools/shortcuts)

**Accessibility guidance.** Do not add `role="toolbar"` merely because controls are arranged in a row. A true ARIA toolbar has one tab stop and arrow-key navigation. A mixed row with a filter textbox can remain a labelled action group with normal native tab order unless Workbench implements the full toolbar pattern. [WAI-ARIA toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)

### Navigation and layered surfaces

**Observed convention.** DevTools uses top-level panels and subordinate tabs/panes, and lets developers reorder those tabs. Hidden or secondary tools can live in the Drawer and are keyboard reachable. This supports a small number of durable work contexts, not deep app-style route trees. [Customize DevTools: Drawer and panel ordering](https://developer.chrome.com/docs/devtools/customize#drawer)

**Observed convention.** The official assistive-technology guide describes top-level DevTools panels as an ARIA `tablist`, with `Control`/`Command` + `[` or `]` for previous/next panel and arrow navigation when focus is in the tablist. [Navigate DevTools with assistive technology](https://developer.chrome.com/docs/devtools/accessibility/navigation#navigate-between-panels)

**Recommendation.** Any eventual Workbench navigation must choose semantics that match behavior:

- use tabs only for peer surfaces where one panel is displayed at a time;
- use a tree for hierarchical runtime topology;
- use buttons or links for commands and jumps, not tabs styled as buttons;
- use a labelled split pane when two simultaneously visible surfaces have a selection/detail relationship.

If tabs render instantly, arrow focus may activate them. If switching causes meaningful latency or destroys work-in-progress, use manual activation with `Enter`/`Space`. [WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)

This report intentionally does not decide which Workbench capabilities become peers, panes, or contextual modes.

### Split panes and detail inspection

**Observed convention.** DevTools repeatedly uses master/detail splits: Network request rows open tabbed details; Application storage selection exposes a preview; Protocol Monitor selects a message and shows request/response detail. [Network request inspection](https://developer.chrome.com/docs/devtools/network/overview#inspect), [extension storage preview](https://developer.chrome.com/docs/devtools/storage/extensionstorage#view-extension-storage), [Protocol Monitor detail split](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/panels/protocol_monitor/ProtocolMonitor.ts#L237-L312)

**Observed convention.** DevTools automatically changes some panes from side-by-side to stacked when the window is narrow, and users can override the panel layout globally. DevTools itself can be docked left, right, bottom, or undocked. [Customize DevTools: placement and panel layout](https://developer.chrome.com/docs/devtools/customize#placement)

**Recommendation.** A Workbench master/detail relationship should:

- keep the evidence surface primary and the detail pane secondary;
- support pointer resizing and a visible show/hide control;
- switch between side and bottom placement from available geometry, not a browser-width assumption;
- preserve a user's size independently for side and stacked orientations;
- set minimum sizes that retain the primary action and close/show controls;
- keep the selected item visible when the detail pane opens.

**Accessibility guidance.** A movable divider should be a labelled, focusable separator with orientation, min/max/current values, directional-arrow resizing, and `Enter` to collapse/restore where collapse is supported. Chromium's legacy splitter is strong evidence for a narrow draggable divider and persistent split state, but the APG window-splitter behavior should be the Workbench accessibility baseline. [Chromium split widget](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui/legacy/SplitWidget.ts#L19-L116), [WAI-ARIA window splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)

### Trees

**Observed convention.** DevTools uses trees for real hierarchies such as the DOM and source/storage navigation. Its tree implementation is one composite tab stop with roving focus, Up/Down traversal, Left collapse/ascend, Right reveal/expand, Home/End traversal, and Enter/Space activation. [Chrome DOM tree keyboard guide](https://developer.chrome.com/docs/devtools/dom#navigate), [Chromium tree implementation](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui/legacy/Treeoutline.ts#L118-L148), [Chromium tree keyboard handling](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui/legacy/Treeoutline.ts#L322-L362)

**Recommendation.** Use a tree only when the parent/child relationship is meaningful and stable. For Workbench topology, tree items should represent Lightstreamer structure; high-cardinality COMMAND keys or events should not become peer topology nodes. Selection should open or update detail without adding action buttons to every row. [Keep Topology structural and bound raw evidence](../adr/0009-keep-topology-structural-and-bound-raw-evidence.md)

**Recommendation.** A Workbench tree must provide the conventional arrow/Home/End keys, roving focus, `aria-expanded`, `aria-selected`, an accessible name, and focus restoration when a live node disappears. Typeahead is strongly recommended for large sibling sets. Focus and selection must remain visually distinct. [WAI-ARIA tree view pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/), [APG keyboard-interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)

### Tables and streaming logs

**Observed convention.** DevTools uses data grids for dense, comparable records. Network's request log provides sortable columns, column visibility from the header context menu, filtering, row selection, selected-row details, and bottom status totals. [Network request table and columns](https://developer.chrome.com/docs/devtools/network/reference/#requests), [Network status totals](https://developer.chrome.com/docs/devtools/network/reference/#load-statistics)

**Observed convention.** Chromium's data grid has one focusable container, Up/Down row traversal, optional hierarchical Left/Right behavior, Enter to open or edit, keyboard-sortable headers with `aria-sort`, distinct focused/unfocused selection colors, resizable columns, and row/header context-menu callbacks. It also announces a selected row using its column labels rather than reading an opaque concatenated payload. [Chromium data-grid construction and semantics](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui/legacy/components/data_grid/DataGrid.ts#L178-L240), [data-grid accessible row text](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui/legacy/components/data_grid/DataGrid.ts#L303-L413), [data-grid keyboard handling](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui/legacy/components/data_grid/DataGrid.ts#L1150-L1256)

**Recommendation.** Primary Workbench evidence streams should be compact grids or purpose-built virtualized lists with grid-like row navigation, not a stack of cards. Keep the scannable columns stable: time/order, origin or provenance, Lightstreamer primitive identity, operation/state, and a concise summary. Put full payloads and mutation controls in detail.

**Recommendation.** Use native `<table>` semantics for static tabular summaries. Use a managed grid or treegrid only when rows/cells are selectable, editable, or otherwise interactive, and implement its keyboard model completely. A grid reduces tab stops but transfers focus-management responsibility to Workbench. [WAI-ARIA table pattern](https://www.w3.org/WAI/ARIA/apg/patterns/table/), [WAI-ARIA grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)

**Recommendation.** Live updates must preserve stable row identity, selection, focus, scroll anchor, column widths, and the detail draft. New events should append without stealing focus. Virtualization must keep the selected row and its accessible description coherent even when off-screen evidence is not mounted.

### Selection

**Observed convention.** DevTools gives selection a persistent neutral appearance when its containing surface is unfocused and a stronger tonal appearance when focused. Hover, selection, focus, inactive, warning, and error are separate visual states. [Chromium selection color guidance](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/docs/styleguide/ux/styles.md#L79-L123), [data-grid selection CSS](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui/legacy/components/data_grid/dataGrid.css#L248-L313)

**Recommendation.** Workbench should normally use single selection within an evidence surface. Selection controls detail scope; focus controls the next keyboard operation. Do not use hover as selection, do not make selected and focused states visually identical, and do not clear selection merely because focus moves into detail.

**Recommendation.** When filtering hides a selection, preserve it only if the UI clearly says the selected item is outside the current results; otherwise clear it and move focus predictably. When an item retires, move focus to the nearest surviving logical row and announce the change only if the user was operating that surface.

### Search and filtering

**Observed convention.** DevTools distinguishes panel-local search from filtering. `Control`/`Command` + `F` opens a find surface in supported panels, with previous/next result controls; cross-resource search uses a different global shortcut. Tool-specific searches can add case sensitivity and regular expression modes. [Chrome DevTools search](https://developer.chrome.com/docs/devtools/search/), [Chrome DevTools shortcuts](https://developer.chrome.com/docs/devtools/shortcuts)

**Observed convention.** Data-heavy tools expose a persistent filter input in the action bar. Network combines text, property filters, negation, resource-type facets, time ranges, and additional toggles, then reports shown versus total rows in the bottom status bar. Protocol Monitor suggests `key:` and `-key:` queries. [Network filtering](https://developer.chrome.com/docs/devtools/network/reference/#filter), [Protocol Monitor filter](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/panels/protocol_monitor/ProtocolMonitor.ts#L225-L242)

**Recommendation.** Define these as different Workbench operations:

- **Find** locates matches and supports next/previous navigation without changing the evidence set.
- **Filter** changes the visible evidence set and always exposes the active criteria plus `shown / total` status.
- **Jump** navigates to a known client, Subscription, item, key, or event identity.

`Control`/`Command` + `F` should focus a panel-local find experience, or the primary text filter only if that control also provides clear result count and next/previous behavior. It must not silently toggle an unrelated filter. Escape should clear a temporary find in stages and return focus to the evidence surface.

**Recommendation.** Support ordinary text first, then discoverable Lightstreamer-native query suggestions such as `client:`, `session:`, `subscription:`, `mode:`, `item:`, `key:`, `command:`, and `provenance:` where those fields exist. Use a leading `-` for negation if adopted. Regex and case toggles should remain compact options, not separate explanatory blocks. Active non-default filters need a visible count or marker and a one-step reset.

### Context actions and overflow

**Observed convention.** DevTools context menus are object-scoped and normally triggered by right-click or a dedicated menu button. Chromium prefers a native menu internally, groups actions into sections, and discourages displaying shortcuts in context menus. [Chromium context-menu guidance](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/docs/styleguide/ux/components.md#L339-L405)

**Platform limitation.** An extension panel cannot call Chromium's private native context-menu component through the public `chrome.devtools.panels` API. A Workbench menu therefore needs a semantic local implementation or another public extension mechanism, and it will not be pixel-identical to built-in native menus. [Chrome `devtools.panels` API](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels)

**Recommendation.** Context menus are accelerators, never the sole route to a core operation. Copy, filter-by-value, reveal-related-evidence, and create-draft actions are good contextual candidates. The primary Local Injection path, clearing history, and export controls must also be reachable without right-click. Support the context-menu key or `Shift` + `F10`, return focus after dismissal, close on Escape, and use disabled states only when the reason is discoverable.

**Recommendation.** Overflow low-frequency configuration before overflowing high-frequency observation controls. Avoid nesting more than one submenu deep. Chrome's UX guidance warns that nested interactions reduce discovery and that feature promotion should be used sparingly because it creates visual noise. [Chromium common UX patterns](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/docs/styleguide/ux/patterns.md#L7-L31)

### Keyboard operation

**Observed convention.** DevTools has stable global shortcuts for panels, command menu, drawer, search, settings, and zoom. Panel-specific tools add focused-context shortcuts, and shortcut tooltips reveal them. [Chrome DevTools shortcuts](https://developer.chrome.com/docs/devtools/shortcuts)

**Recommendation.** Workbench should reserve keyboard behavior in this order:

1. native controls (`Tab`, `Shift` + `Tab`, `Enter`, `Space`, Escape);
2. expected composite-widget keys (arrows, Home/End, Page Up/Down where appropriate);
3. DevTools-compatible panel-local find (`Control`/`Command` + `F`);
4. a very small set of documented high-frequency Workbench shortcuts.

Do not claim global DevTools chords, browser reload chords, or text-editing keys. Single-character shortcuts should work only while the relevant composite has focus, or provide a way to turn them off/remap them, as required by WCAG 2.2. [WCAG 2.2 keyboard](https://www.w3.org/TR/WCAG22/#keyboard), [WCAG 2.2 character key shortcuts](https://www.w3.org/TR/WCAG22/#character-key-shortcuts)

**Recommendation.** Keyboard activation must never lose focus during live rerenders. Closing a popover or detail surface returns focus to its trigger or selected evidence. Clearing or removing selected data moves focus to a logical survivor. Focus must remain visible and distinct from selection. [APG keyboard-interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/), [WCAG 2.2 focus visible](https://www.w3.org/TR/WCAG22/#focus-visible), [WCAG 2.2 focus not obscured](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum)

### Resizing, docking, and compact layouts

**Requirement.** The panel must remain operable as its own HTML content when DevTools is docked left, right, or bottom, or undocked. Chrome does not give an extension a single reliable desktop viewport. [Customize DevTools: placement](https://developer.chrome.com/docs/devtools/customize#placement)

**Requirement.** WCAG 2.2 AA requires reflow without loss of information or functionality at a width equivalent to 320 CSS pixels, except where two-dimensional layout is essential to usage or meaning. A data grid can legitimately retain two-dimensional scrolling, but its surrounding controls, status, empty states, and detail actions cannot become unreachable. [WCAG 2.2 reflow](https://www.w3.org/TR/WCAG22/#reflow)

**Recommendation.** Define behavior by available space rather than device labels:

- **compact:** single primary pane at a time or stacked details; toolbars overflow low-frequency controls; labels may shorten only when accessible names remain complete;
- **normal:** primary evidence and detail can coexist;
- **wide:** additional context may remain visible, but line lengths and detail widths stay bounded.

Every material UI scenario should be tested in compact, normal, and wide geometry, plus light and dark themes, at browser zoom levels that exercise reflow. Dense tables may scroll horizontally, but the identity column and selection state should remain understandable; sticky headers or columns must not obscure keyboard focus.

### Persistent status and transient outcomes

**Observed convention.** Network uses a compact bottom status bar for total/filtered request counts and transfer/loaded sizes. Recording state is represented by a persistent toggle, not a toast. Filters update the shown/total summary. [Network load statistics](https://developer.chrome.com/docs/devtools/network/reference/#load-statistics), [Network filtered totals](https://developer.chrome.com/docs/devtools/network/reference/#filter)

**Recommendation.** Separate three kinds of Workbench state:

- **persistent operating state:** capture active/stopped, Live/Frozen view, current scope, selected COMMAND projection;
- **evidence summary:** visible/total events, newer matching events, active filters, retention/fallback warnings;
- **transient action outcome:** copied, export ready/failed, draft reset, injection delivered/failed.

Persistent state belongs in always-visible compact chrome; summary belongs in a status bar or equivalent; action outcomes use a non-modal status region. None should rely on color alone.

**Requirement.** Success, progress, and error messages that do not move focus must be programmatically determinable as status messages. Use a polite live region for ordinary completion and an alert only when immediate interruption is justified. Do not announce every captured update; announce deliberate user-action outcomes and material operating-state changes. [WCAG 2.2 status messages](https://www.w3.org/TR/WCAG22/#status-messages), [W3C understanding status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages)

### Theming and visual semantics

**Observed convention.** Chromium's style guide uses semantic system tokens for light/dark-aware surfaces, text, selection, focus, warning, error, and syntax highlighting; one-off application tokens are reserved for rare domain exceptions. It distinguishes focused and unfocused selection, and treats fainter text as something to use rarely. [Chromium color-token guidance](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/docs/styleguide/ux/styles.md#L16-L40), [Chromium state colors](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/docs/styleguide/ux/styles.md#L79-L177)

**Recommendation.** Workbench should default to **Follow DevTools** and apply changes live through `setThemeChangeHandler()`. If explicit Workbench light/dark overrides remain valuable for testing or user preference, move them out of permanent primary chrome and make **Follow DevTools** the default. The panel should set `color-scheme` consistently so native form controls render correctly.

**Recommendation.** Define a small local semantic token contract rather than copying Chromium's private variables. Domain-specific tokens are justified for:

- server-observed versus locally injected provenance;
- successful Local Injection versus warning/error outcomes;
- active versus deleted COMMAND state where text/icon/state labels also carry meaning.

Do not use arbitrary brand accents for generic selection, focus, or action priority. Do not use syntax colors for provenance. Test forced-colors/high-contrast behavior as well as light and dark.

### Accessibility baseline

**Requirement.** Adopt WCAG 2.2 AA as the baseline for the extension panel: keyboard access and no traps, text and non-text contrast, reflow, visible and unobscured focus, labels that describe purpose, programmatic name/role/value, and programmatic status messages. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

**Recommendation.** Prefer native `button`, `input`, `select`, `table`, `details`, and dialog semantics. Use ARIA composite roles only when the full associated interaction model is implemented. A static table is not an interactive grid; a visual list is not automatically a tree; a row of buttons is not automatically a toolbar. [WAI-ARIA patterns](https://www.w3.org/WAI/ARIA/apg/patterns/)

**Recommendation.** Required acceptance checks for material UI changes should include:

- complete keyboard traversal and operation without a pointer;
- visible focus in light, dark, and forced-colors modes;
- screen-reader names, roles, states, row/column context, and action outcomes;
- focus/selection preservation while capture continues;
- compact reflow and zoom without clipped actions;
- serious/critical automated accessibility checks followed by manual keyboard and assistive-technology review;
- empty, loading, error, high-volume, filtered-empty, no-selection, and selection-retired states.

**Recommendation.** Auto-updating evidence must not force viewport movement or selection changes. The existing separation between Capture and Timeline Live/Frozen state is the correct domain model: freezing investigation stops visual following, not capture. This also gives developers control over moving content without hiding ongoing collection. [Separate Timeline view state from Capture state](../adr/0008-separate-timeline-view-state-from-capture-state.md), [WCAG 2.2 pause, stop, hide](https://www.w3.org/TR/WCAG22/#pause-stop-hide)

**Recommendation.** Tooltips must appear for pointer hover and keyboard focus, remain hoverable, and be dismissible without moving focus when they obscure content. Do not put essential instructions only in a tooltip. [WCAG 2.2 content on hover or focus](https://www.w3.org/TR/WCAG22/#content-on-hover-or-focus)

### Compact, expert-first behavior

**Observed convention.** Chromium's current built-in primitives are intentionally small, and its writing guidance says to give information at the right time, keep most messages to one sentence, use active voice and common terms, cut filler, and use sentence case. [Chromium control-density CSS](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui/components/buttons/button.css#L34-L100), [Chromium UX writing guidance](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/docs/styleguide/ux/writing.md#L5-L60)

**Recommendation.** Expert-first means:

- show live evidence and scope immediately when capture is available;
- use Lightstreamer terms directly and consistently;
- keep persistent instructional prose out of the normal working surface;
- use one-sentence empty/error recovery guidance with the relevant action;
- keep raw payloads one interaction away, not permanently expanded;
- make copy, reveal, filter-by-value, and draft-from-selection fast;
- bound rendered high-cardinality evidence while preserving complete copy/export;
- use monospace for identifiers, values, queries, and payloads—not for general UI text;
- truncate only when the complete value is available by detail, copy, or an accessible tooltip;
- avoid card layouts for logs, topology, state rows, and other comparable evidence.

Expert-first does not mean undocumented iconography, tiny pointer targets, hover-only actions, or hidden operating state. Progressive disclosure is appropriate for infrequent controls and raw detail; it is not appropriate for Capture state, current scope, active filters, selection, provenance, or the final injection target.

## Candidate rules for the lasting Workbench UI standard

These are standard candidates, not an IA decision.

| ID | Candidate rule | Strength | Evidence |
| --- | --- | --- | --- |
| `ENV-01` | Implement DevTools-like behavior with Workbench-owned semantic HTML/components; do not depend on private Chromium UI modules. | Must | Public extension page/API boundary; inference |
| `ENV-02` | Treat bottom, left, right, and undocked DevTools placements as normal environments. | Must | Chrome placement documentation |
| `DEN-01` | Default to compact toolbars and evidence rows; use at least 24×24 px for independent controls and 24 px for selectable rows. | Must | DevTools density observation plus WCAG target-size adjustment |
| `DEN-02` | Use tables, trees, split panes, and status bars for operational evidence; do not use cards as the default log/hierarchy/state container. | Should | Recurring DevTools convention; inference |
| `ACT-01` | Keep one necessary primary action per decision context; use compact icon actions only when familiar and named. | Should | Chromium button guidance |
| `ACT-02` | Separate global/session actions from selection-scoped actions and visually separate destructive clear/reset actions. | Should | DevTools action-bar convention; inference |
| `NAV-01` | Use tab, tree, link, button, and split-pane semantics according to actual behavior; implement each composite keyboard model completely. | Must | APG and DevTools accessibility behavior |
| `PANE-01` | Make master/detail panes resizable, collapsible, orientation-adaptive, keyboard operable, and focus preserving. | Must | DevTools split convention, APG, WCAG |
| `TREE-01` | Hierarchical navigation provides roving focus, arrows, Home/End, expand/collapse state, accessible naming, and live-node focus recovery. | Must | DevTools tree and APG |
| `GRID-01` | Interactive evidence grids provide stable row identity, sortable headers where useful, Up/Down navigation, selection-driven detail, and accessible row/column context. | Must | DevTools data grid and APG |
| `GRID-02` | High-volume streams preserve focus, selection, scroll anchor, and draft state during live updates; virtualization never changes data semantics. | Must | Developer-tool usability and accessibility inference |
| `SEL-01` | Focus, selection, hover, inactive, warning, and error are separate visual and programmatic states. | Must | Chromium styles and APG |
| `FIND-01` | Find, filter, and jump are distinct; active filters and shown/total counts stay visible and have a one-step reset. | Must | DevTools search/filter convention |
| `MENU-01` | Context menus accelerate object-specific actions but never provide the only route to a core action; support keyboard opening and Escape/focus return. | Must | Chromium context-menu convention and keyboard accessibility |
| `KEY-01` | Start with native and composite keyboard conventions; add only a small, documented set of non-conflicting panel-local shortcuts and include them in tooltips. | Must | DevTools shortcuts, APG, WCAG |
| `RESP-01` | Adapt by available geometry; allow two-dimensional scrolling only for evidence that needs it, while keeping actions/status operable at compact width. | Must | Chrome docking and WCAG reflow |
| `STAT-01` | Persistent operating state, evidence summaries, and transient outcomes use distinct placements and semantics; do not announce every captured event. | Must | Network convention and WCAG status messages |
| `THEME-01` | Follow DevTools by default through the public theme API and use Workbench semantic tokens for both light and dark; do not copy private Chromium tokens. | Must | Chrome public theme API and Chromium token convention |
| `A11Y-01` | WCAG 2.2 AA, manual keyboard testing, and real browser/assistive-technology checks are release gates for material UI work. | Must | WCAG; DevTools accessibility documentation |
| `COPY-01` | UI text uses sentence case, active voice, one idea per sentence, Lightstreamer-native terms, and direct recovery guidance. | Should | Chromium UX writing guide |
| `EVID-01` | Raw/high-cardinality evidence is bounded in rendering but remains completely inspectable, copyable, and exportable. | Must | Workbench topology decision; performance/accessibility inference |

## Justified Lightstreamer-specific exceptions

### Local Injection is a draft-and-act workflow, not ordinary editing

Protocol Monitor's **Edit and resend** is a useful discoverability pattern, but Workbench must not make captured updates look editable. The source stays immutable; the developer creates a separate Injection Draft; the final target Subscription and local-only nature remain visible; injection is an explicit additional action; and the outcome is marked as local. This justifies a labelled action and stronger provenance treatment than a generic compact “resend” icon. [Keep capture observational](../adr/0001-keep-capture-observational.md), [Scope Local Injection to one Subscription](../adr/0002-scope-local-injection-to-one-subscription.md)

Candidate standard language:

> Never edit observed evidence in place. Start Local Injection from an explicit source-to-draft transition, keep source and target inspectable, and require a labelled final action whose result reports local provenance and delivery outcome.

### Server-observed and local-effective COMMAND projections need persistent provenance

Most DevTools selections show one view of one underlying state. Workbench intentionally has two COMMAND projections: Observed Server COMMAND State and Local Effective COMMAND State. The selected projection cannot be an implicit filter or color-only badge; it must be a visible operating-state control/label, and locally injected effects must not look like server evidence. [Separate server observation from local effective state](../adr/0006-separate-server-observation-from-local-effective-state.md)

### Capture state and investigation position are independent

DevTools recording tools provide explicit recording state, but Workbench also needs an independent Live/Frozen investigation state. Scrolling history or pinning detail must never imply capture pause, and stopping capture must not silently discard the current investigation. Both states need compact, persistent labels. [Separate Timeline view state from Capture state](../adr/0008-separate-timeline-view-state-from-capture-state.md)

### Topology stays structural despite high-cardinality COMMAND evidence

A generic tree convention would allow arbitrarily deep expansion, but thousands of COMMAND keys would make topology unstable and unusable. Workbench should keep structural Lightstreamer nodes in the tree and expose key/generation evidence through bounded summaries, complete copy, and a route to the dedicated investigation surface. This is a domain-specific limit on tree depth/cardinality, not a reason to abandon tree semantics. [Keep Topology structural and bound raw evidence](../adr/0009-keep-topology-structural-and-bound-raw-evidence.md)

### Injection provenance uses a rare domain token, not generic selection color

Chromium permits rare application-level semantic color tokens when system roles are insufficient. Local provenance is such a case, but color must be paired with text/icon/state metadata and must not replace the normal selection/focus colors. [Chromium application-token guidance](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/docs/styleguide/ux/styles.md#L34-L40), [WCAG use of color](https://www.w3.org/TR/WCAG22/#use-of-color)

## Implications for later design tickets

This research constrains, but does not answer, the information-architecture and prototype decisions:

- Any candidate IA should demonstrate the full **orient → investigate → act** flow without duplicating controls across cards or pages.
- At least one prototype should use the Protocol Monitor-like evidence pattern as a benchmark: compact actions, structured filter, dense selection surface, detail split, contextual draft action, and status summary.
- Competing prototypes may organize peer surfaces differently, but each must use the same keyboard, selection, provenance, status, theme, and resizing rules.
- Local Injection prototypes must show source, draft, target Subscription, validation, deliberate injection, and result provenance; simply placing a JSON textarea in a permanent card does not satisfy the domain exception.
- Compact prototypes must be evaluated in both side-docked and bottom-docked shapes, not only as a conventional wide webpage.

## Limitations and open validation work

- Chrome publishes comprehensive user documentation and source, but its current UX `organizing.md` contains headings rather than prescriptive panel-organization rules. Layout findings in this report are therefore triangulated from official behavior documentation and current source, and are labelled as observations or recommendations rather than requirements. [Chromium UX organizing guide](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/docs/styleguide/ux/organizing.md)
- Chromium frontend source changes continuously. Links to implementation evidence are pinned to the commit above; the lasting Workbench standard should rely on behavioral rules, not copied class names or CSS values.
- Built-in DevTools has access to native menus, private tokens, and richer dynamic theming that extension pages do not. Exact pixel/color/menu parity is neither possible nor necessary through the public panel API.
- The public theme API exposes light/dark state, not Chrome's dynamic accent palette. A Workbench-specific accent can be semantically consistent but cannot claim exact dynamic-theme parity.
- WAI-ARIA APG examples explicitly require testing across real browser/assistive-technology combinations. Automated checks alone cannot validate composite grids, trees, splitters, or focus behavior. [APG patterns](https://www.w3.org/WAI/ARIA/apg/patterns/)
- This research did not run a comparative usability study or select breakpoints, row columns, pane defaults, Workbench navigation peers, or the final Local Injection placement. Those remain prototype/decision work.

## Primary source index

- [Chrome DevTools extension panels API](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels)
- [Customize Chrome DevTools](https://developer.chrome.com/docs/devtools/customize)
- [Chrome DevTools keyboard shortcuts](https://developer.chrome.com/docs/devtools/shortcuts)
- [Chrome DevTools search](https://developer.chrome.com/docs/devtools/search/)
- [Chrome DevTools Network overview and reference](https://developer.chrome.com/docs/devtools/network/overview)
- [Navigate Chrome DevTools with assistive technology](https://developer.chrome.com/docs/devtools/accessibility/navigation)
- [Chromium DevTools UX style guide at the pinned source snapshot](https://github.com/ChromeDevTools/devtools-frontend/tree/b963582b6689f136a8222c91bc005060b9f0616d/docs/styleguide/ux)
- [Chromium Protocol Monitor at the pinned source snapshot](https://github.com/ChromeDevTools/devtools-frontend/blob/b963582b6689f136a8222c91bc005060b9f0616d/front_end/panels/protocol_monitor/ProtocolMonitor.ts)
- [Chromium tree, data-grid, toolbar, and split-widget source](https://github.com/ChromeDevTools/devtools-frontend/tree/b963582b6689f136a8222c91bc005060b9f0616d/front_end/ui)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA Authoring Practices Guide patterns](https://www.w3.org/WAI/ARIA/apg/patterns/)
