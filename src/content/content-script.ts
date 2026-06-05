import {
  PAGE_REINJECT_REQUEST,
  RUNTIME_CAPTURE_MESSAGE,
  type ReinjectionDraftPayload,
  type ReinjectionResult,
  isCaptureMessage,
  isContentReinjectRequestMessage,
  isRuntimeReinjectResultMessage
} from "../bridge/messages";

const PAGE_REINJECT_TIMEOUT_MS = 2500;

window.addEventListener("message", (event) => {
  if (event.source !== window || !isCaptureMessage(event.data)) {
    return;
  }

  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return;
  }

  chrome.runtime.sendMessage({
    type: RUNTIME_CAPTURE_MESSAGE,
    message: event.data
  });
});

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isContentReinjectRequestMessage(message)) {
      return false;
    }

    forwardReinjectionToPage(message.requestId, message.draft).then(sendResponse);
    return true;
  });
}

function forwardReinjectionToPage(
  requestId: string,
  draft: ReinjectionDraftPayload
): Promise<ReinjectionResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onPageMessage);
      resolve(createBridgeErrorResult(requestId, "Timed out waiting for page reinjection result."));
    }, PAGE_REINJECT_TIMEOUT_MS);

    function onPageMessage(event: MessageEvent) {
      if (event.source !== window || !isRuntimeReinjectResultMessage(event.data)) {
        return;
      }
      if (event.data.result.requestId !== requestId) {
        return;
      }

      clearTimeout(timeout);
      window.removeEventListener("message", onPageMessage);
      resolve(event.data.result);
    }

    window.addEventListener("message", onPageMessage);
    window.postMessage(
      {
        type: PAGE_REINJECT_REQUEST,
        requestId,
        draft
      },
      "*"
    );
  });
}

function createBridgeErrorResult(requestId: string, error: string): ReinjectionResult {
  return {
    requestId,
    ok: false,
    status: "bridge-error",
    timestamp: Date.now(),
    error
  };
}
