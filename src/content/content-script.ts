import {
  CAPTURE_NAMESPACE,
  CONTENT_REINJECT_RESULT,
  CONTENT_BRIDGE_READY,
  PAGE_CAPTURE_SYNC_REQUEST,
  PAGE_REINJECT_REQUEST,
  RUNTIME_CAPTURE_MESSAGE,
  RUNTIME_PANEL_ATTACHMENT_QUERY,
  RUNTIME_TOPOLOGY_SYNC_FRAME,
  type ContentPanelAttachmentMessage,
  type ReinjectionDraftPayload,
  type ReinjectionResult,
  isCaptureMessage,
  isContentCaptureSyncRequestMessage,
  isContentPanelAttachmentMessage,
  isContentReinjectRequestMessage,
  isRuntimeReinjectResultMessage,
  isTopologySyncFrame
} from "../bridge/messages";

const PAGE_REINJECT_TIMEOUT_MS = 5000;
const runtime = typeof chrome === "undefined" ? undefined : chrome.runtime;
const pendingPageRequests = new Set<() => void>();
let active = false;
// Until the service worker answers, behave as before gating existed and
// forward everything: an early page Capture must not be lost to a slow reply.
let panelAttachment: "unknown" | "attached" | "detached" = "unknown";
let panelAttachmentRevision = Number.NEGATIVE_INFINITY;

if (runtime?.sendMessage && runtime.onMessage) {
  active = true;
  try {
    runtime.onMessage.addListener(onRuntimeMessage);
    window.addEventListener("message", onPageMessage);
    window.addEventListener("pageshow", onPageShow);
    // Transient readiness signal for browser tests; production does not read it
    // and, unlike a DOM attribute, it leaves no state in the page document.
    window.postMessage({ type: CONTENT_BRIDGE_READY }, "*");
    queryPanelAttachment();
  } catch (error) {
    handleRuntimeError(error);
  }
}

function onPageMessage(event: MessageEvent) {
  if (!active || event.source !== window) {
    return;
  }

  if (panelAttachment === "detached" && isUnscopedCaptureCandidate(event.data)) {
    // No panel can receive live Capture for this tab. Skip validation and the
    // runtime hop; a later panel learns current topology through sync.
    return;
  }

  if (isCaptureMessage(event.data)) {
    const panelSessionId = event.data.panelSessionId;
    sendRuntimeMessage({
      type: RUNTIME_CAPTURE_MESSAGE,
      ...(panelSessionId ? { panelSessionId } : {}),
      message: event.data
    });
    return;
  }

  if (isTopologySyncFrame(event.data)) {
    const panelSessionId = event.data.panelSessionId;
    sendRuntimeMessage({
      type: RUNTIME_TOPOLOGY_SYNC_FRAME,
      panelSessionId,
      frame: event.data
    });
  }
}

function onRuntimeMessage(message: unknown): false {
  if (!active) {
    return false;
  }

  if (isContentPanelAttachmentMessage(message)) {
    applyPanelAttachment(message);
    return false;
  }

  if (isContentCaptureSyncRequestMessage(message)) {
    // A sync request proves a panel is registered for this tab.
    panelAttachment = "attached";
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
    // Publish independently of the original request channel so page delivery
    // remains correlated even when the sender is already detached.
    sendRuntimeMessage({
      type: CONTENT_REINJECT_RESULT,
      panelSessionId: message.panelSessionId,
      result
    });
  });

  return false;
}

function isUnscopedCaptureCandidate(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { namespace?: unknown }).namespace === CAPTURE_NAMESPACE &&
    (value as { panelSessionId?: unknown }).panelSessionId === undefined
  );
}

function applyPanelAttachment(message: ContentPanelAttachmentMessage): void {
  if (message.revision < panelAttachmentRevision) {
    return;
  }
  panelAttachmentRevision = message.revision;
  panelAttachment = message.attached ? "attached" : "detached";
}

function queryPanelAttachment(): void {
  if (!active || !runtime) {
    return;
  }
  try {
    runtime.sendMessage({ type: RUNTIME_PANEL_ATTACHMENT_QUERY }, (response: unknown) => {
      try {
        const error = runtime.lastError;
        if (isInvalidatedContext(error)) {
          retireBridge();
          return;
        }
        if (isContentPanelAttachmentMessage(response)) {
          applyPanelAttachment(response);
        }
      } catch (error) {
        retireIfInvalidated(error);
      }
    });
  } catch (error) {
    retireIfInvalidated(error);
  }
}

// The attachment query is an optimization: any failure other than context
// invalidation leaves the bridge forwarding as if a panel were attached.
function retireIfInvalidated(error: unknown): void {
  if (isInvalidatedContext(error)) {
    retireBridge();
  }
}

function onPageShow(event: PageTransitionEvent): void {
  if (!active || !event.persisted) {
    return;
  }
  // A page restored from the back/forward cache missed attachment changes.
  panelAttachment = "unknown";
  queryPanelAttachment();
}

function sendRuntimeMessage(message: unknown): void {
  if (!active || !runtime) {
    return;
  }
  try {
    // The API function survives extension reload, but calling it can throw.
    // Callback form also consumes transient delivery errors instead of leaving
    // an unhandled rejected Promise when the background receiver is unavailable.
    runtime.sendMessage(message, () => {
      try {
        const error = runtime.lastError;
        if (isInvalidatedContext(error)) {
          retireBridge();
        }
      } catch (error) {
        handleRuntimeError(error);
      }
    });
  } catch (error) {
    handleRuntimeError(error);
  }
}

function isInvalidatedContext(error: unknown): boolean {
  return typeof error === "object" && error !== null && "message" in error &&
    typeof error.message === "string" && error.message.includes("Extension context invalidated");
}

function handleRuntimeError(error: unknown): void {
  if (!isInvalidatedContext(error)) {
    throw error;
  }
  retireBridge();
}

function retireBridge(): void {
  if (!active) {
    return;
  }
  active = false;
  window.removeEventListener("message", onPageMessage);
  window.removeEventListener("pageshow", onPageShow);
  try {
    runtime?.onMessage.removeListener?.(onRuntimeMessage);
  } catch {
    // Chrome can also reject listener removal after invalidating the context.
  }
  for (const cancel of pendingPageRequests) {
    cancel();
  }
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
      pendingPageRequests.delete(cancel);
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

    // Losing the bridge cannot prove whether the page already delivered the
    // Injection. Stop waiting without retrying or claiming a failed delivery.
    const cancel = () => finish(createAcknowledgementUnknownResult(
      requestId,
      panelSessionId,
      "Extension context invalidated while waiting for page reinjection result."
    ));
    pendingPageRequests.add(cancel);
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
