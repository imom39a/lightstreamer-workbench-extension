import {
  CONTENT_REINJECT_RESULT,
  PAGE_CAPTURE_SYNC_REQUEST,
  PAGE_REINJECT_REQUEST,
  RUNTIME_CAPTURE_MESSAGE,
  RUNTIME_TOPOLOGY_SYNC_FRAME,
  type ReinjectionDraftPayload,
  type ReinjectionResult,
  isCaptureMessage,
  isContentCaptureSyncRequestMessage,
  isContentReinjectRequestMessage,
  isRuntimeReinjectResultMessage,
  isPanelSessionId,
  isTopologySyncFrame
} from "../bridge/messages";

const PAGE_REINJECT_TIMEOUT_MS = 5000;

window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }

  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return;
  }

  if (isCaptureMessage(event.data)) {
    chrome.runtime.sendMessage({
      type: RUNTIME_CAPTURE_MESSAGE,
      message: event.data
    });
    return;
  }

  if (isTopologySyncFrame(event.data)) {
    const panelSessionId = (event.data as typeof event.data & { panelSessionId?: string }).panelSessionId;
    if (!isPanelSessionId(panelSessionId)) {
      return;
    }
    chrome.runtime.sendMessage({
      type: RUNTIME_TOPOLOGY_SYNC_FRAME,
      panelSessionId,
      frame: event.data
    });
  }
});

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isContentCaptureSyncRequestMessage(message)) {
      window.postMessage({
        type: PAGE_CAPTURE_SYNC_REQUEST,
        panelSessionId: message.panelSessionId
      }, "*");
      return false;
    }

    if (!isContentReinjectRequestMessage(message)) {
      return false;
    }

    void forwardReinjectionToPage(message.requestId, message.panelSessionId, message.draft).then((result) => {
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
          panelSessionId: message.panelSessionId,
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
  panelSessionId: string,
  draft: ReinjectionDraftPayload
): Promise<ReinjectionResult> {
  return new Promise((resolve) => {
    let settled = false;
    let responsePort: MessagePort | null = null;
    const timeout = setTimeout(() => {
      finish(
        createAcknowledgementUnknownResult(
          requestId,
          panelSessionId,
          "Timed out waiting for page reinjection result."
        )
      );
    }, PAGE_REINJECT_TIMEOUT_MS);

    function finish(result: ReinjectionResult) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener("message", onPageMessage);
      responsePort?.removeEventListener("message", onPortMessage);
      responsePort?.close();
      resolve(result);
    }

    function acceptPageResult(value: unknown) {
      if (
        !isRuntimeReinjectResultMessage(value) ||
        value.panelSessionId !== panelSessionId ||
        value.result.requestId !== requestId
      ) {
        return;
      }
      finish(value.result);
    }

    function onPageMessage(event: MessageEvent) {
      if (event.source !== window) {
        return;
      }
      acceptPageResult(event.data);
    }

    function onPortMessage(event: MessageEvent) {
      acceptPageResult(event.data);
    }

    window.addEventListener("message", onPageMessage);
    const pageRequest = {
      type: PAGE_REINJECT_REQUEST,
      requestId,
      panelSessionId,
      draft
    };

    if (typeof MessageChannel === "function") {
      try {
        const channel = new MessageChannel();
        responsePort = channel.port1;
        responsePort.addEventListener("message", onPortMessage);
        responsePort.start();
        window.postMessage(pageRequest, "*", [channel.port2]);
        return;
      } catch {
        responsePort?.removeEventListener("message", onPortMessage);
        responsePort?.close();
        responsePort = null;
      }
    }

    window.postMessage(pageRequest, "*");
  });
}

function createBridgeErrorResult(
  requestId: string,
  panelSessionId: string,
  error: string
): ReinjectionResult {
  return {
    requestId,
    panelSessionId,
    ok: false,
    status: "bridge-error",
    timestamp: Date.now(),
    error
  };
}

function createAcknowledgementUnknownResult(
  requestId: string,
  panelSessionId: string,
  error: string
): ReinjectionResult {
  return {
    requestId,
    panelSessionId,
    ok: false,
    status: "acknowledgement-unknown",
    timestamp: Date.now(),
    error
  };
}
