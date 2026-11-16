import { afterEach, describe, expect, it } from "vitest";

import { createThemeManager, THEME_STORAGE_KEY } from "../src/extension/panel/theme";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("dark-only panel theme", () => {
  it("applies dark to the panel root and document element", () => {
    const target = document.createElement("main");
    const manager = createThemeManager({ target, documentElement: document.documentElement });

    expect(manager.effectiveTheme).toBe("dark");
    expect(target.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("does not remove the dark attributes on dispose", () => {
    const target = document.createElement("main");
    const manager = createThemeManager({ target, documentElement: document.documentElement });
    manager.dispose();
    expect(target.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(THEME_STORAGE_KEY).toBe("lightstreamer-workbench.theme");
  });
});
