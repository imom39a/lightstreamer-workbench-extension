export type VisualTheme = "dark" | "light";

export type VisualMatrixCase = {
  id:
  | "timeline-live"
  | "timeline-frozen"
  | "topology-expanded"
  | "topology-collapsed"
  | "topology-command-evidence"
  | "export-open";
  theme: VisualTheme;
  viewport: { width: number; height: number };
};

/** Deliberate representative coverage without a Cartesian viewport/theme matrix. */
export const PANEL_VISUAL_MATRIX: readonly VisualMatrixCase[] = [
  { id: "timeline-live", theme: "dark", viewport: { width: 900, height: 700 } },
  { id: "timeline-frozen", theme: "light", viewport: { width: 900, height: 700 } },
  { id: "topology-expanded", theme: "dark", viewport: { width: 1_280, height: 800 } },
  { id: "topology-collapsed", theme: "light", viewport: { width: 1_280, height: 800 } },
  {
    id: "topology-command-evidence",
    theme: "dark",
    viewport: { width: 1_440, height: 900 }
  },
  { id: "export-open", theme: "light", viewport: { width: 563, height: 137 } }
];
