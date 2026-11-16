/** Elastic Triad geometry thresholds and classification for the Scoped Evidence Workspace. */
export type WorkbenchGeometry = "wide" | "normal" | "shallow" | "compact";

export const SCOPE_MIN_WIDTH = 216;
export const SCOPE_MAX_WIDTH = 420;
export const EVIDENCE_MIN_WIDTH = 520;
export const EVIDENCE_MIN_HEIGHT = 220;
export const EVIDENCE_STACK_BUDGET = 244;
export const CONTEXT_MIN_WIDTH = 320;
export const CONTEXT_MIN_HEIGHT = 210;
export const CONTEXT_MAX_SIZE = 520;
export const SPLITTER_SIZE = 6;
export const PERSISTENT_CHROME_HEIGHT = 90;
export const NORMAL_MIN_WIDTH = 700;
export const NORMAL_MIN_HEIGHT = PERSISTENT_CHROME_HEIGHT + EVIDENCE_MIN_HEIGHT + CONTEXT_MIN_HEIGHT + SPLITTER_SIZE;
export const SHALLOW_MIN_WIDTH = EVIDENCE_MIN_WIDTH + CONTEXT_MIN_WIDTH + SPLITTER_SIZE;
export const WIDE_MIN_WIDTH = Math.max(1120, SCOPE_MIN_WIDTH + EVIDENCE_MIN_WIDTH + CONTEXT_MIN_WIDTH + SPLITTER_SIZE * 2);
export const GEOMETRY_HYSTERESIS = 32;
export const SCOPE_NODE_HEIGHT = 58;
export const EVIDENCE_ROW_HEIGHT = 30;
export const SCOPE_WINDOW_OVERSCAN = 8;
export const SCOPE_FALLBACK_VIEWPORT_ROWS = 48;
export const SCOPE_MAX_WINDOW_SIZE = 127;

export function classifyGeometry(width: number, height: number): WorkbenchGeometry {
  if (width >= WIDE_MIN_WIDTH && height >= NORMAL_MIN_HEIGHT) return "wide";
  if (width >= NORMAL_MIN_WIDTH && height >= NORMAL_MIN_HEIGHT) return "normal";
  if (width >= SHALLOW_MIN_WIDTH) return "shallow";
  return "compact";
}

function geometryFits(geometry: WorkbenchGeometry, width: number, height: number): boolean {
  if (geometry === "wide") return width >= WIDE_MIN_WIDTH && height >= NORMAL_MIN_HEIGHT;
  if (geometry === "normal") return width >= NORMAL_MIN_WIDTH && height >= NORMAL_MIN_HEIGHT;
  if (geometry === "shallow") return width >= SHALLOW_MIN_WIDTH;
  return true;
}

export function decideGeometry(width: number, height: number, previous?: WorkbenchGeometry): WorkbenchGeometry {
  if (!previous) return classifyGeometry(width, height);
  if (!geometryFits(previous, width, height)) return classifyGeometry(width, height);
  if (previous === "wide") return "wide";
  if (width >= WIDE_MIN_WIDTH + GEOMETRY_HYSTERESIS && height >= NORMAL_MIN_HEIGHT + GEOMETRY_HYSTERESIS) return "wide";
  if (previous === "normal") return "normal";
  if (width >= NORMAL_MIN_WIDTH + GEOMETRY_HYSTERESIS && height >= NORMAL_MIN_HEIGHT + GEOMETRY_HYSTERESIS) return "normal";
  if (previous === "shallow") return "shallow";
  if (width >= SHALLOW_MIN_WIDTH + GEOMETRY_HYSTERESIS) return "shallow";
  return "compact";
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
