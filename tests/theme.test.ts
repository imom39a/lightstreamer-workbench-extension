import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createThemeManager,
  resolveEffectiveTheme,
  THEME_STORAGE_KEY,
  type ThemeStorage
} from "../src/extension/panel/theme";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("dark-only panel theme", () => {
  it.each(["auto", "light", "dark"] as const)("normalizes legacy preference %s to dark", (preference) => {
    const target = document.createElement("main");
    const manager = createThemeManager({
      target,
      documentElement: document.documentElement,
      storage: null,
      devtoolsPanels: { themeName: "default" },
      matchMedia: () => ({ matches: false })
    });

    manager.setPreference(preference);

    expect(manager.preference).toBe("dark");
    expect(manager.effectiveTheme).toBe("dark");
    expect(target.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores legacy storage, OS light, and DevTools light inputs", () => {
    const storage: ThemeStorage = {
      getItem: vi.fn(() => "light"),
      setItem: vi.fn()
    };
    const setThemeChangeHandler = vi.fn();
    const matchMedia = vi.fn(() => ({ matches: false }));
    const manager = createThemeManager({
      target: document.createElement("main"),
      storage,
      devtoolsPanels: { themeName: "default", setThemeChangeHandler },
      matchMedia
    });

    expect(manager.effectiveTheme).toBe("dark");
    expect(manager.preference).toBe("dark");
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(matchMedia).not.toHaveBeenCalled();
    expect(setThemeChangeHandler).not.toHaveBeenCalled();
  });

  it("keeps the legacy resolver dark for every OS and DevTools combination", () => {
    expect(resolveEffectiveTheme("auto", "default", false)).toBe("dark");
    expect(resolveEffectiveTheme("auto", "dark", true)).toBe("dark");
    expect(resolveEffectiveTheme("light", "default", false)).toBe("dark");
  });

  it("does not remove the dark attributes on dispose", () => {
    const target = document.createElement("main");
    const manager = createThemeManager({ target, documentElement: document.documentElement });
    manager.dispose();
    manager.setPreference("light");
    expect(target.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(THEME_STORAGE_KEY).toBe("lightstreamer-workbench.theme");
  });
});
