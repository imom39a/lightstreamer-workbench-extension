import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = process.cwd().endsWith(`${sep}src`)
  ? process.cwd()
  : resolve(process.cwd(), "src");
const panelCss = readFileSync(
  resolve(sourceRoot, "extension/panel/panel.css"),
  "utf8"
);
const panelHtml = readFileSync(resolve(sourceRoot, "extension/panel/index.html"), "utf8");
const devtoolsSource = readFileSync(resolve(sourceRoot, "extension/devtools.ts"), "utf8");

describe("panel CSS", () => {
  it("keeps an explicit hidden override for view regions with display rules", () => {
    expect(panelCss).toMatch(/\[hidden\]\s*{\s*display:\s*none\s*!important;\s*}/);
    expect(panelCss).toContain(".filter-strip");
    expect(panelCss).toContain(".command-filter-strip");
    expect(panelCss).toContain(".workspace");
    expect(panelCss).toContain(".command-workspace");
  });

  it("disables native scroll anchoring in live-remounted panes", () => {
    expect(panelCss).toMatch(
      /\.command-group-pane,[\s\S]*?\.command-detail-pane\s*{[\s\S]*?overflow-anchor:\s*none;/
    );
    expect(panelCss).toMatch(/\.event-feed\s*{[\s\S]*?overflow-anchor:\s*none;/);
    expect(panelCss).toMatch(/\.detail-pane\s*{[\s\S]*?overflow-anchor:\s*none;/);
  });

  it("keeps Timeline and COMMAND pagers compact without wrapped actions", () => {
    expect(panelCss).toMatch(
      /\.event-window-navigation,[\s\S]*?\.command-window-navigation\s*{[\s\S]*?flex-wrap:\s*nowrap;/
    );
    expect(panelCss).toMatch(
      /\.window-navigation-actions\s*{[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?white-space:\s*nowrap;/
    );
  });

  it("uses shared dense striping instead of per-row divider lines in both views", () => {
    expect(panelCss).toContain(".event-row:nth-child(even)");
    expect(panelCss).toContain(".command-current-row:nth-child(even)");
    expect(panelCss).toContain(".command-update-row:nth-child(even)");
    expect(panelCss).not.toMatch(/\.event-row\s*{[^}]*border-bottom:/);
  });

  it("defines dark-first semantic tokens with an explicit light override", () => {
    expect(panelCss).toMatch(/:root\s*{[\s\S]*?color-scheme:\s*dark;/);
    expect(panelCss).toContain("--color-bg: #1f1f1f");
    expect(panelCss).toContain("--color-surface: #242424");
    expect(panelCss).toContain("--color-border: #3c4043");
    expect(panelCss).toContain("--color-text: #e8eaed");
    expect(panelCss).toContain("--color-accent: #8ab4f8");
    expect(panelCss).toMatch(/\[data-theme="light"\]\s*{[\s\S]*?color-scheme:\s*light;/);
    expect(panelHtml).toContain('<meta name="color-scheme" content="dark light" />');
  });

  it("styles command and Workbench source chips without removing their text", () => {
    expect(panelCss).toContain('.event-row[data-command="ADD"] .event-command');
    expect(panelCss).toContain('.event-row[data-command="UPDATE"] .event-command');
    expect(panelCss).toContain('.event-row[data-command="DELETE"] .event-command');
    expect(panelCss).toContain('.event-row[data-command="SUBSCRIBE"] .event-code');
    expect(panelCss).toContain('.event-row[data-command="EOS"] .event-code');
    expect(panelCss).toContain('.event-code[data-code-family="tlcp"]');
    expect(panelCss).toContain('.event-code[data-code-family="workbench"]');
    expect(panelCss).toContain('.event-row[data-source="workbench"] .event-marker');
    expect(panelCss).toMatch(/\.event-command\s*{[\s\S]*?max-width:\s*100%;/);
  });

  it("gives parsed JSON drafts bounded multiline editors", () => {
    expect(panelCss).toContain('.draft-field-diff tr[data-layout="json-summary"]');
    expect(panelCss).toContain(".draft-json-editor-cell");
    expect(panelCss).toMatch(/\.structured-json-input\s*{[\s\S]*?min-height:\s*190px;/);
    expect(panelCss).toMatch(/\.structured-json-input\s*{[\s\S]*?max-height:/);
    expect(panelCss).toMatch(/\.structured-json-inline-input\s*{[\s\S]*?min-height:\s*88px;/);
    expect(panelCss).toContain(".detail-changed-fields");
  });

  it("keeps desktop split panes, stacks medium panes, and drills into detail on narrow panels", () => {
    expect(panelCss).toContain("@media (min-width: 960px)");
    expect(panelCss).toContain("@media (min-width: 600px) and (max-width: 959px)");
    expect(panelCss).toContain("@media (max-width: 599px)");
    expect(panelCss).toContain(
      '.workspace[data-detail-open="true"] .event-feed'
    );
    expect(panelCss).toContain(
      '.workspace[data-detail-open="true"] .detail-pane'
    );
    expect(panelCss).toContain("@media (max-width: 400px)");
  });

  it("retains the DevTools panel handle and forwards shown and hidden lifecycle", () => {
    expect(devtoolsSource).toContain("panel.onShown.addListener");
    expect(devtoolsSource).toContain("panel.onHidden.addListener");
  });
});
