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

  it("retains the DevTools panel handle and forwards shown and hidden lifecycle", () => {
    expect(devtoolsSource).toContain("panel.onShown.addListener");
    expect(devtoolsSource).toContain("panel.onHidden.addListener");
  });
});
