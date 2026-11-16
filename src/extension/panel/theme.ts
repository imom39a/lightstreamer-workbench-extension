/** The panel's single supported theme. */
export type EffectiveTheme = "dark";

/** Retained so callers can recognize the pre-dark-only preference key; dark-only mode never reads it. */
export const THEME_STORAGE_KEY = "lightstreamer-workbench.theme";

export type ThemeManagerOptions = {
  target: HTMLElement;
  documentElement?: HTMLElement | null;
};

export type ThemeManager = {
  readonly effectiveTheme: EffectiveTheme;
  dispose(): void;
};

/** Applies the product's single supported dark theme to the panel root and document. */
export function createThemeManager(options: ThemeManagerOptions): ThemeManager {
  options.target.dataset.theme = "dark";
  if (options.documentElement) options.documentElement.dataset.theme = "dark";
  return {
    effectiveTheme: "dark",
    dispose() {
      // Dark attributes intentionally remain until the document is torn down.
    }
  };
}
