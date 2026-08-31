import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  WorkbenchRuntime,
  WorkbenchServerInjectionSnapshot
} from "../src/extension/panel/workbench-runtime";
import { ServerInjectionDocument } from "../src/extension/panel/react/server-injection-document";

describe("Server Injection document", () => {
  let container: HTMLDivElement;
  let root: Root;
  const dispatch = vi.fn();
  const runtime = { dispatch } as unknown as WorkbenchRuntime;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    dispatch.mockReset();
  });

  it("keeps target and server boundary visible beside the editable send arguments", () => {
    act(() => root.render(createElement(ServerInjectionDocument, {
      runtime,
      serverInjection: snapshot("edit")
    })));

    expect(container.getAttribute("aria-label")).toBeNull();
    expect(container.textContent).toContain("LightstreamerClient.sendMessage");
    expect(container.textContent).toContain("does not inject an inbound Item Update");
    expect(container.querySelector<HTMLTextAreaElement>("#workbench-server-message")?.value).toBe("message-body");
    expect(container.querySelector<HTMLInputElement>("#workbench-server-sequence")?.value).toBe("orders");
    expect(container.querySelector<HTMLInputElement>("#workbench-server-timeout")?.placeholder).toBe("Server default");

    act(() => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "review-server-injection" });
  });

  it("explains an empty authored body and applies one inspected-application Message Recipe deliberately", () => {
    const base = snapshot("edit");
    const authored = {
      ...base,
      draft: {
        ...base.draft,
        value: { ...base.draft.value, sourceEventId: null, message: "" },
        ready: false,
        source: { kind: "authored", eventId: "event-1" },
        recipes: {
          status: "available",
          detail: null,
          items: [{
            id: "fixture.update-fields.v1",
            label: "Update fields for beta",
            description: "Starts from the selected COMMAND key and its current version.",
            message: '{"type":"update-fields","item":"scenario.snapshot-basic","key":"beta","expectedVersion":"1","fields":{"qty":"20"}}',
            sequence: "LSEW_FIXTURE_FIELD_UPDATES",
            delayTimeout: null,
            enqueueWhileDisconnected: false
          }]
        }
      }
    } as unknown as WorkbenchServerInjectionSnapshot;

    act(() => root.render(createElement(ServerInjectionDocument, {
      runtime,
      serverInjection: authored
    })));

    expect(container.textContent).toContain("accepted by this application's Metadata Adapter");
    expect(container.textContent).toContain("Workbench cannot infer a Client Message from an inbound Item Update");
    expect(container.textContent).toContain("Application Message Recipe");
    const recipe = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Use Update fields for beta"
    )!;
    act(() => recipe.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "apply-server-injection-recipe",
      recipeId: "fixture.update-fields.v1"
    });
  });

  it("makes the exactly-once action and no-retry consequence explicit at review", () => {
    act(() => root.render(createElement(ServerInjectionDocument, {
      runtime,
      serverInjection: snapshot("review")
    })));

    expect(container.textContent).toContain("Review exact sendMessage call");
    expect(container.textContent).toContain("No automatic retry occurs");
    const send = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Send Client Message once"
    )!;
    act(() => send.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "execute-server-injection" });
  });

  it("labels an uncertain terminal state and requires a separate deliberate Repeat", () => {
    const base = snapshot("outcome");
    const value: WorkbenchServerInjectionSnapshot = {
      ...base,
      draft: {
        ...base.draft,
        outcome: {
          requestId: "request-1",
          ok: false,
          status: "unknown",
          timestamp: 100,
          error: "The message may have reached the server."
        }
      }
    };
    act(() => root.render(createElement(ServerInjectionDocument, {
      runtime,
      serverInjection: value
    })));

    expect(container.textContent).toContain("Outcome Unknown");
    expect(container.textContent).toContain("may duplicate server-side effects");
    const repeat = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Prepare separate Repeat…"
    )!;
    act(() => repeat.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "prepare-server-injection-repeat" });
  });

  it("requires inline confirmation before discarding an edited Draft", () => {
    const base = snapshot("edit");
    act(() => root.render(createElement(ServerInjectionDocument, {
      runtime,
      serverInjection: base
    })));
    const discard = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Discard draft…"
    )!;
    act(() => discard.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "request-discard-server-injection" });

    act(() => root.render(createElement(ServerInjectionDocument, {
      runtime,
      serverInjection: {
        ...base,
        draft: { ...base.draft, discardConfirmation: true }
      }
    })));
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("cannot be recovered");
    const confirm = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Confirm discard"
    )!;
    act(() => confirm.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "confirm-discard-server-injection" });
  });
});

function snapshot(
  phase: NonNullable<WorkbenchServerInjectionSnapshot["draft"]>["phase"]
): WorkbenchServerInjectionSnapshot & { draft: NonNullable<WorkbenchServerInjectionSnapshot["draft"]> } {
  return {
    state: "active",
    availability: {
      cloneSelected: { available: true, reason: null },
      authorSelectedClient: { available: true, reason: null }
    },
    entryError: null,
    draft: {
      id: "server-draft-1",
      phase,
      value: {
        sourceEventId: "event-1",
        target: {
          pageEpoch: "page-1",
          clientId: "client-1",
          sessionId: "session-1"
        },
        message: "message-body",
        sequence: "orders",
        delayTimeout: null,
        enqueueWhileDisconnected: false
      },
      delayTimeoutText: "",
      diagnostics: [],
      ready: true,
      source: { kind: "captured-message", eventId: "event-1" },
      reviewedFingerprint: phase === "review" ? "fingerprint" : null,
      outcome: null,
      repeatWarning: false,
      discardConfirmation: false,
      recipes: {
        status: "unavailable",
        items: [],
        detail: "Captured Client Messages already provide their exact body."
      }
    }
  };
}
