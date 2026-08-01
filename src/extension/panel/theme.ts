export type ThemePreference = "auto" | "dark" | "light";
export type EffectiveTheme = Exclude<ThemePreference, "auto">;
export type DevToolsThemeName = "default" | "dark";

export const THEME_STORAGE_KEY = "lightstreamer-workbench.theme";

export type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export type ThemeMediaQuery = {
  readonly matches: boolean;
  addEventListener?(type: "change", listener: (event: MediaQueryListEvent) => void): void;
  removeEventListener?(type: "change", listener: (event: MediaQueryListEvent) => void): void;
  addListener?(listener: (event: MediaQueryListEvent) => void): void;
  removeListener?(listener: (event: MediaQueryListEvent) => void): void;
};

/** Narrow local extension for the Chrome 99+ API missing from the installed @types/chrome. */
export type DevToolsThemePanels = {
  readonly themeName?: string;
  setThemeChangeHandler?(
    callback?: ((theme: DevToolsThemeName) => void) | null
  ): void;
};

export type ThemeManagerOptions = {
  target: HTMLElement;
  documentElement?: HTMLElement | null;
  storage?: ThemeStorage | null;
  devtoolsPanels?: DevToolsThemePanels | null;
  matchMedia?: ((query: string) => ThemeMediaQuery) | null;
  storageKey?: string;
};

export type ThemeManager = {
  readonly preference: ThemePreference;
  readonly effectiveTheme: EffectiveTheme;
  setPreference(preference: ThemePreference): void;
  dispose(): void;
};

export function createThemeManager(options: ThemeManagerOptions): ThemeManager {
  const storageKey = options.storageKey ?? THEME_STORAGE_KEY;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const panels = options.devtoolsPanels === undefined ? defaultDevToolsPanels() : options.devtoolsPanels;
  const matchMedia = options.matchMedia === undefined ? defaultMatchMedia() : options.matchMedia;
  let preference = readPreference(storage, storageKey);
  let devToolsTheme = normalizeDevToolsTheme(panels?.themeName);
  let mediaQuery: ThemeMediaQuery | null = null;
  let themeHandlerInstalled = false;
  let disposed = false;

  if (matchMedia) {
    try {
      mediaQuery = matchMedia("(prefers-color-scheme: dark)");
    } catch {
      mediaQuery = null;
    }
  }

  const applyTheme = (): void => {
    if (disposed) {
      return;
    }
    const effectiveTheme = resolveEffectiveTheme(preference, devToolsTheme, mediaQuery?.matches);
    options.target.dataset.theme = effectiveTheme;
    if (options.documentElement) {
      options.documentElement.dataset.theme = effectiveTheme;
    }
  };

  const handleDevToolsThemeChange = (theme: DevToolsThemeName): void => {
    devToolsTheme = normalizeDevToolsTheme(theme);
    applyTheme();
  };
  const handleMediaThemeChange = (): void => {
    applyTheme();
  };

  if (panels?.setThemeChangeHandler) {
    try {
      panels.setThemeChangeHandler(handleDevToolsThemeChange);
      themeHandlerInstalled = true;
    } catch {
      themeHandlerInstalled = false;
    }
  }
  addMediaListener(mediaQuery, handleMediaThemeChange);
  applyTheme();

  return {
    get preference() {
      return preference;
    },
    get effectiveTheme() {
      return resolveEffectiveTheme(preference, devToolsTheme, mediaQuery?.matches);
    },
    setPreference(nextPreference) {
      if (disposed || !isThemePreference(nextPreference)) {
        return;
      }
      preference = nextPreference;
      writePreference(storage, storageKey, preference);
      applyTheme();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      removeMediaListener(mediaQuery, handleMediaThemeChange);
      if (themeHandlerInstalled && panels?.setThemeChangeHandler) {
        try {
          panels.setThemeChangeHandler(null);
        } catch {
          // DevTools may already be tearing down. Listener cleanup is best effort.
        }
      }
    }
  };
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  devToolsTheme?: DevToolsThemeName | null,
  mediaPrefersDark?: boolean
): EffectiveTheme {
  if (preference !== "auto") {
    return preference;
  }
  if (devToolsTheme) {
    return devToolsTheme === "dark" ? "dark" : "light";
  }
  if (typeof mediaPrefersDark === "boolean") {
    return mediaPrefersDark ? "dark" : "light";
  }
  return "dark";
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "auto" || value === "dark" || value === "light";
}

function normalizeDevToolsTheme(value: unknown): DevToolsThemeName | null {
  return value === "default" || value === "dark" ? value : null;
}

function readPreference(storage: ThemeStorage | null, storageKey: string): ThemePreference {
  if (!storage) {
    return "auto";
  }
  try {
    const value = storage.getItem(storageKey);
    return isThemePreference(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

function writePreference(
  storage: ThemeStorage | null,
  storageKey: string,
  preference: ThemePreference
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(storageKey, preference);
  } catch {
    // Storage can be disabled in extension or privacy contexts; theming still works in memory.
  }
}

function addMediaListener(
  mediaQuery: ThemeMediaQuery | null,
  listener: (event: MediaQueryListEvent) => void
): void {
  if (mediaQuery?.addEventListener) {
    mediaQuery.addEventListener("change", listener);
  } else {
    mediaQuery?.addListener?.(listener);
  }
}

function removeMediaListener(
  mediaQuery: ThemeMediaQuery | null,
  listener: (event: MediaQueryListEvent) => void
): void {
  if (mediaQuery?.removeEventListener) {
    mediaQuery.removeEventListener("change", listener);
  } else {
    mediaQuery?.removeListener?.(listener);
  }
}

function defaultStorage(): ThemeStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function defaultDevToolsPanels(): DevToolsThemePanels | null {
  const panels = globalThis.chrome?.devtools?.panels;
  return panels ? (panels as DevToolsThemePanels) : null;
}

function defaultMatchMedia(): ((query: string) => ThemeMediaQuery) | null {
  return typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia.bind(globalThis)
    : null;
}
