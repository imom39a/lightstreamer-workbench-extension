import type { Page } from "@playwright/test";
export type FilterStateVisual = {
  flow: "context" | "editor" | "notifications";
  geometry: string;
  id: string;
  width: number;
  height: number;
  theme: "dark";
  forcedColors: boolean;
};
export const FILTER_STATE_VISUALS: readonly FilterStateVisual[];
export function prepareFilterStateVisual(page: Page, scene: FilterStateVisual): Promise<void>;
