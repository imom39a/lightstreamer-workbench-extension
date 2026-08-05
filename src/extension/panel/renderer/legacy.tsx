import "../main";

export const panelRendererName = "legacy";
export const rendererBuildMarker = "LSEW_PANEL_RENDERER:legacy";

/**
 * The legacy panel owns its existing bootstrap and disposal lifecycle. This
 * module only gives the stable panel bootstrap a compile-time renderer seam.
 */
export function mountPanelRenderer(_root: HTMLElement): () => void {
  return () => undefined;
}
