import { mountWorkbenchPanel } from "./panel";

function bootPanel(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) {
    return;
  }

  const dispose = mountWorkbenchPanel(root);
  window.addEventListener("pagehide", dispose, { once: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootPanel, { once: true });
} else {
  bootPanel();
}
