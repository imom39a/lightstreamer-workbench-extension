import { mountPanelRenderer, panelRendererName, rendererBuildMarker } from "panel-renderer";

function bootPanel(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) {
    return;
  }

  root.dataset.panelRenderer = panelRendererName;
  root.dataset.panelRendererBuild = rendererBuildMarker;
  const dispose = mountPanelRenderer(root);
  window.addEventListener("pagehide", dispose, { once: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootPanel, { once: true });
} else {
  bootPanel();
}
