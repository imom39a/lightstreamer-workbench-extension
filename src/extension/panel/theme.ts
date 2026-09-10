export type ThemePreference = "auto" | "dark" | "light";
export type EffectiveTheme = "dark";
export type DevToolsThemeName = "default" | "dark";

/** Retained for callers that may still carry a pre-dark-only preference key. */
export const THEME_STORAGE_KEY = "lightstreamer-workbench.theme";

export type ThemeStorage = Pick<Storage, "getItem" | "setItem">;
export type ThemeMediaQuery = {
  readonly matches: boolean;
  addEventListener?(type: "change", listener: (event: MediaQueryListEvent) => void): void;
  removeEventListener?(type: "change", listener: (event: MediaQueryListEvent) => void): void;
  addListener?(listener: (event: MediaQueryListEvent) => void): void;
  removeListener?(listener: (event: MediaQueryListEvent) => void): void;
};

/** Narrow local extension for the Chrome API retained for source compatibility. */
export type DevToolsThemePanels = {
  readonly themeName?: string;
  setThemeChangeHandler?(
    callback?: ((theme: DevToolsThemeName) => void) | null
  ): void;
};

export type ThemeManagerOptions = {
  target: HTMLElement;
  documentElement?: HTMLElement | null;
  /** Legacy compatibility input; dark-only mode does not read or write it. */
  storage?: ThemeStorage | null;
  /** Legacy compatibility input; dark-only mode ignores DevTools theme changes. */
  devtoolsPanels?: DevToolsThemePanels | null;
  /** Legacy compatibility input; dark-only mode ignores system preference changes. */
  matchMedia?: ((query: string) => ThemeMediaQuery) | null;
  storageKey?: string;
};

export type ThemeManager = {
  readonly preference: ThemePreference;
  readonly effectiveTheme: EffectiveTheme;
  setPreference(preference: ThemePreference): void;
  dispose(): void;
};

/** Applies the product's single supported theme. Legacy inputs safely normalize to dark. */
export function createThemeManager(options: ThemeManagerOptions): ThemeManager {
  let disposed = false;
  const applyTheme = (): void => {
    if (disposed) return;
    options.target.dataset.theme = "dark";
    if (options.documentElement) options.documentElement.dataset.theme = "dark";
  };
  applyTheme();
  return {
    preference: "dark",
    effectiveTheme: "dark",
    setPreference(_preference) {
      applyTheme();
    },
    dispose() {
      disposed = true;
    }
  };
}

/** Legacy resolver retained at the API boundary; all preferences resolve to dark. */
export function resolveEffectiveTheme(
  _preference: ThemePreference,
  _devToolsTheme?: DevToolsThemeName | null,
  _mediaPrefersDark?: boolean
): EffectiveTheme {
  return "dark";
}
