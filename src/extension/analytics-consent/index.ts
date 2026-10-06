import { firefoxDataPermissions } from "../firefox-data-consent";
import { ANALYTICS_MESSAGE } from "../analytics/events";
import "./style.css";

const request = document.querySelector<HTMLButtonElement>("#request")!;
const cancel = document.querySelector<HTMLButtonElement>("#cancel")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
for (const button of [request, cancel]) {
  button.addEventListener("focus", () => button.scrollIntoView({ block: "nearest" }));
}
async function finish(allowed: boolean) {
  try { await chrome.runtime.sendMessage({ type: ANALYTICS_MESSAGE, action: "consent-result", allowed }); }
  finally { window.close(); }
}
cancel.addEventListener("click", () => { void finish(false); });
request.addEventListener("click", () => {
  // This must remain the direct click handler in an ordinary extension page.
  const operation = firefoxDataPermissions()?.request({ data_collection: ["technicalAndInteraction"] });
  request.disabled = true;
  status.textContent = "Waiting for Firefox permission…";
  void Promise.resolve(operation).then(allowed => finish(allowed === true), () => {
    request.disabled = false;
    status.textContent = "Firefox could not open the permission request. Keep analytics off or try again.";
  });
});
