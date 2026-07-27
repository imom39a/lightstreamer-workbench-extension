import {
  CONTENT_REINJECT_RESULT,
  PAGE_CAPTURE_SYNC_REQUEST,
  PAGE_REINJECT_REQUEST,
  RUNTIME_CAPTURE_MESSAGE,
  type ReinjectionDraftPayload,
  type ReinjectionResult,
  isCaptureMessage,
  isContentCaptureSyncRequestMessage,
  isContentReinjectRequestMessage,
  isRuntimeReinjectResultMessage
} from "../bridge/messages";

const PAGE_REINJECT_TIMEOUT_MS = 5000;

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
    if (isContentCaptureSyncRequestMessage(message)) {
      window.postMessage({ type: PAGE_CAPTURE_SYNC_REQUEST }, "*");
      return false;
    }

    if (!isContentReinjectRequestMessage(message)) {
      return false;
    }

    void forwardReinjectionToPage(message.requestId, message.draft).then((result) => {
      // Return the final result on the original channel for compatibility with
      // background workers that predate the detached result message.
      try {
        sendResponse(result);
      } catch {
        // The detached result below remains available if this channel closed.
      }

      // Also publish it independently. This survives a response channel that
      // closes while the inspected page is processing the update.
      chrome.runtime.sendMessage(
        {
          type: CONTENT_REINJECT_RESULT,
          result
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    });

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
