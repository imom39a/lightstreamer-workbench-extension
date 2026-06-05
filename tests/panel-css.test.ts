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

describe("panel CSS", () => {
  it("keeps an explicit hidden override for view regions with display rules", () => {
    expect(panelCss).toMatch(/\[hidden\]\s*{\s*display:\s*none\s*!important;\s*}/);
    expect(panelCss).toContain(".filter-strip");
    expect(panelCss).toContain(".command-filter-strip");
    expect(panelCss).toContain(".workspace");
    expect(panelCss).toContain(".command-workspace");
  });
});
