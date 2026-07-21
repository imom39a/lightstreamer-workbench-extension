import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createThemeManager,
  THEME_STORAGE_KEY,
  type DevToolsThemeName,
  type DevToolsThemePanels,
  type ThemeMediaQuery,
  type ThemeStorage
} from "../src/extension/panel/theme";

type MutableMediaQuery = ThemeMediaQuery & {
  matches: boolean;
};

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("panel theme manager", () => {
  it.each([
    [true, "dark"],
    [false, "light"]
  ] as const)("resolves Auto from the media preference when dark=%s", (matches, expected) => {
    const target = document.createElement("main");
    const media = createMediaQuery(matches);
    const manager = createThemeManager({
      target,
      documentElement: document.documentElement,
      storage: null,
      devtoolsPanels: null,
      matchMedia: () => media.query
    });

    expect(manager.preference).toBe("auto");
    expect(manager.effectiveTheme).toBe(expected);
    expect(target.dataset.theme).toBe(expected);
    expect(document.documentElement.dataset.theme).toBe(expected);
  });

  it("uses and safely persists an explicit override", () => {
    const values = new Map([[THEME_STORAGE_KEY, "dark"]]);
    const storage: ThemeStorage = {
      getItem: vi.fn((key) => values.get(key) ?? null),
      setItem: vi.fn((key, value) => values.set(key, value))
    };
    const target = document.createElement("main");
    const manager = createThemeManager({
      target,
      storage,
      devtoolsPanels: { themeName: "default" },
      matchMedia: null
    });

    expect(manager.preference).toBe("dark");
    expect(manager.effectiveTheme).toBe("dark");
    manager.setPreference("light");
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "light");
    expect(target.dataset.theme).toBe("light");
  });

  it("updates Auto from the live DevTools callback", () => {
    const handler: { callback: ((theme: DevToolsThemeName) => void) | null } = {
      callback: null
    };
    const panels: DevToolsThemePanels = {
      themeName: "default",
      setThemeChangeHandler(nextCallback) {
        handler.callback = nextCallback ?? null;
      }
    };
    const target = document.createElement("main");
    const manager = createThemeManager({
      target,
      storage: null,
      devtoolsPanels: panels,
      matchMedia: null
    });

    expect(manager.effectiveTheme).toBe("light");
    handler.callback?.("dark");
    expect(manager.effectiveTheme).toBe("dark");
    expect(target.dataset.theme).toBe("dark");
  });

  it("falls back to a live media query when DevTools theme information is unavailable", () => {
    const target = document.createElement("main");
    const media = createMediaQuery(false);
    const manager = createThemeManager({
      target,
      storage: null,
      devtoolsPanels: {},
      matchMedia: () => media.query
    });

    expect(manager.effectiveTheme).toBe("light");
    media.setMatches(true);
    expect(manager.effectiveTheme).toBe("dark");
    expect(target.dataset.theme).toBe("dark");
  });

  it("defaults Auto to dark when neither DevTools nor media information is available", () => {
    const target = document.createElement("main");
    const manager = createThemeManager({
      target,
      storage: null,
      devtoolsPanels: null,
      matchMedia: null
    });

    expect(manager.effectiveTheme).toBe("dark");
    expect(target.dataset.theme).toBe("dark");
  });

  it("disposes DevTools and media handlers exactly once", () => {
    const setThemeChangeHandler = vi.fn();
    const panels: DevToolsThemePanels = {
      themeName: "dark",
      setThemeChangeHandler
    };
    const media = createMediaQuery(false);
    const manager = createThemeManager({
      target: document.createElement("main"),
      storage: null,
      devtoolsPanels: panels,
      matchMedia: () => media.query
    });

    manager.dispose();
    manager.dispose();

    expect(media.remove).toHaveBeenCalledTimes(1);
    expect(setThemeChangeHandler).toHaveBeenLastCalledWith(null);
    expect(setThemeChangeHandler).toHaveBeenCalledTimes(2);
  });
});

function createMediaQuery(initialMatches: boolean): {
  query: MutableMediaQuery;
  setMatches(matches: boolean): void;
  remove: ReturnType<typeof vi.fn>;
} {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const remove = vi.fn((_: "change", listener: (event: MediaQueryListEvent) => void) => {
    listeners.delete(listener);
  });
  const query: MutableMediaQuery = {
    matches: initialMatches,
    addEventListener(_, listener) {
      listeners.add(listener);
    },
    removeEventListener: remove
  };
  return {
    query,
    setMatches(matches) {
      query.matches = matches;
      const event = { matches } as MediaQueryListEvent;
      for (const listener of listeners) {
        listener(event);
      }
    },
    remove
  };
}
