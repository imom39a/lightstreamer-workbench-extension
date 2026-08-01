import { PANEL_VISIBILITY_MESSAGE } from "../bridge/messages";

chrome.devtools.panels.create(
  "Lightstreamer Workbench",
  "",
  "extension/panel/index.html",
  (panel) => {
    let panelWindow: Window | null = null;
    const extensionOrigin = new URL(chrome.runtime.getURL("")).origin;

    panel.onShown.addListener((shownWindow) => {
      panelWindow = shownWindow;
      panelWindow.postMessage({ type: PANEL_VISIBILITY_MESSAGE, visible: true }, extensionOrigin);
    });
    panel.onHidden.addListener(() => {
      panelWindow?.postMessage(
        { type: PANEL_VISIBILITY_MESSAGE, visible: false },
        extensionOrigin
      );
    });
  }
);
