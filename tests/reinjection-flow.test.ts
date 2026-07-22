import { describe, expect, it, vi } from "vitest";

import {
  PAGE_REINJECT_REQUEST,
  type ReinjectionDraftPayload,
  isRuntimeReinjectResultMessage
} from "../src/bridge/messages";
import { createEventStore } from "../src/core/event-store";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { renderPanel } from "../src/extension/panel/main";
import { installLightstreamerInstrumentation } from "../src/injected/lightstreamer-instrumentation";

const SOURCE_MODEL_VALUES = JSON.stringify({
  passenger: {
    selected: false,
    priority: false,
    itinerary: ["ATL", "JAX"]
  },
  metadata: {
    recordLocator: "HTL4K",
    version: 7
  },
  padding: "large JSON fixture value used to exercise the expanded editor without truncation"
});

const MUTATED_MODEL_VALUES = JSON.stringify(
  {
    passenger: {
      selected: true,
      priority: false,
      itinerary: ["ATL", "JAX"]
    },
    metadata: {
      recordLocator: "HTL4K",
      version: 7
    },
    padding: "large JSON fixture value used to exercise the expanded editor without truncation"
  },
  null,
  2
);

describe("curated mutate-and-reinject contract", () => {
  it("carries an edited JSON field through the listener bridge, synthetic event, Timeline detail, and COMMAND state", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }

    const store = createEventStore();
    const receivedDrafts: ReinjectionDraftPayload[] = [];
    const reinjectDraft = vi.fn((draft) => {
      receivedDrafts.push(toPayloadSnapshot(draft));
      return Promise.resolve({
        requestId: "curated-json-mutation",
        ok: true as const,
        status: "success" as const,
        timestamp: 1_784_650_000_000
      });
    });
    const controller = renderPanel(root, undefined, {
      store,
      bridge: { reinjectDraft }
    });
    store.append(sourceEvent());
    await flushPanelRender();

    click(".event-row");
    click(".clone-button");
    click(".mutate-inject-button");

    const jsonEditor = document.querySelector<HTMLTextAreaElement>(
      '.structured-json-input[data-field-name="modelValues"]'
    );
    if (!jsonEditor) {
      throw new Error("missing expanded modelValues editor");
    }
    jsonEditor.value = MUTATED_MODEL_VALUES;
    jsonEditor.dispatchEvent(new Event("input", { bubbles: true }));
    click(".inject-edited-button");

    await flushPromises();
    await flushPanelRender();

    expect(reinjectDraft).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(receivedDrafts[0]?.fields.modelValues))).toMatchObject({
      passenger: { selected: true, priority: false },
      metadata: { recordLocator: "HTL4K", version: 7 }
    });
    expect(receivedDrafts[0]?.fields.modelId).toBe("CUSTOMER_INIT_INFO");
    expect(Object.keys(receivedDrafts[0]?.changedFields ?? {})).toEqual(["modelValues"]);
    expect(JSON.parse(String(receivedDrafts[0]?.changedFields.modelValues))).toMatchObject({
      passenger: { selected: true }
    });

    const synthetic = store.list().at(-1);
    expect(synthetic).toMatchObject({
      id: "synthetic-curated-json-mutation",
      source: "synthetic",
      synthetic: true,
      raw: {
        sourceEventId: "source-json-update",
        executionTarget: "captured-listener",
        deliveredToPage: true
      }
    });
    expect(JSON.parse(String(synthetic?.update?.fields?.modelValues))).toMatchObject({
      passenger: { selected: true }
    });
    expect(JSON.parse(String(synthetic?.update?.changedFields?.modelValues))).toMatchObject({
      passenger: { selected: true }
    });

    expect(selectedTimelineEventId()).toBe("synthetic-curated-json-mutation");
    expect(text(".selected-event-id")).toBe("synthetic-curated-json-mutation");
    const timelineFields = detailSection("Current item fields");
    expect(timelineFields.textContent).toContain('"selected": true');
    expect(timelineFields.textContent).not.toContain('"selected": false');

    clickButtonByText(".view-selector button", "COMMAND State");
    const currentCommandFields = document.querySelector<HTMLElement>(".command-json");
    expect(currentCommandFields?.textContent).toContain('"selected": true');
    expect(currentCommandFields?.textContent).not.toContain('"selected": false');

    controller.dispose();
  });

  it("applies a mutated wire COMMAND JSON value to Workbench state without claiming page delivery", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }

    const sourceModelValues = JSON.stringify({
      messageId: "6675530",
      messageText: "Attention - DDE QA testing.",
      messageType: "TICKER"
    });
    const mutatedModelValues = JSON.stringify(
      {
        messageId: "6675530",
        messageText: "!!!!Attention - DDE QA testing.",
        messageType: "TICKER"
      },
      null,
      2
    );
    const store = createEventStore();
    const controller = renderPanel(root, undefined, { store });
    store.append({
      id: "event-17",
      timestamp: 1_784_737_272_000,
      direction: "inbound",
      source: "server",
      captureSource: "wire",
      synthetic: false,
      kind: "item-update",
      client: {
        id: "client-1",
        serverAddress: "wss://example.test/lightstreamer",
        adapterSet: "PME_ADAPTER"
      },
      subscription: {
        id: "subscription-3",
        mode: "COMMAND",
        items: ["snappHome.SNAPP"],
        fields: ["key", "command", "modelId", "modelValues"],
        dataAdapter: "PME_DATA_PROVIDER",
        requestedSnapshot: "true",
        keyPosition: 1,
        commandPosition: 2
      },
      item: { name: "snappHome.SNAPP", position: 1 },
      update: {
        isSnapshot: true,
        command: "ADD",
        key: "MESSENGER_TICKER_6675530.MESSENGER",
        fields: {
          key: "MESSENGER_TICKER_6675530.MESSENGER",
          command: "ADD",
          modelId: "MESSENGER",
          modelValues: sourceModelValues
        },
        changedFields: {
          key: "MESSENGER_TICKER_6675530.MESSENGER",
          command: "ADD",
          modelId: "MESSENGER",
          modelValues: sourceModelValues
        }
      },
      raw: {
        captureSource: "websocket-tlcp",
        transport: "websocket",
        frameDirection: "inbound",
        frameTag: "U",
        rawSubId: "3",
        itemPosition: 1,
        unsupportedDiffFields: []
      }
    });
    await flushPanelRender();

    click(".event-row");
    click(".clone-button");
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="draft-execution-target"][value="workbench-only"]'
      )?.checked
    ).toBe(true);
    click(".mutate-inject-button");

    const jsonEditor = document.querySelector<HTMLTextAreaElement>(
      '.structured-field-input[data-field-name="modelValues"]'
    );
    if (!jsonEditor) {
      throw new Error("missing wire modelValues editor");
    }
    jsonEditor.value = mutatedModelValues;
    jsonEditor.dispatchEvent(new Event("input", { bubbles: true }));
    click(".inject-edited-button");
    await flushPromises();
    await flushPanelRender();

    const synthetic = store.list().at(-1);
    expect(synthetic).toMatchObject({
      id: expect.stringMatching(/^synthetic-workbench-/),
      client: {
        id: "client-1",
        adapterSet: "PME_ADAPTER"
      },
      subscription: {
        id: "subscription-3",
        mode: "COMMAND",
        items: ["snappHome.SNAPP"],
        fields: ["key", "command", "modelId", "modelValues"],
        keyPosition: 1,
        commandPosition: 2
      },
      raw: {
        sourceEventId: "event-17",
        executionTarget: "workbench-only",
        deliveredToPage: false,
        serverContacted: false
      }
    });
    expect(JSON.parse(String(synthetic?.update?.fields?.modelValues))).toMatchObject({
      messageText: "!!!!Attention - DDE QA testing."
    });
    expect(selectedTimelineEventId()).toBe(synthetic?.id);
    expect(detailSection("Current item fields").textContent).toContain(
      "!!!!Attention - DDE QA testing."
    );

    clickButtonByText(".view-selector button", "COMMAND State");
    expect(text(".command-json")).toContain("!!!!Attention - DDE QA testing.");
    expect(text(".command-json")).not.toContain(
      '"messageText": "Attention - DDE QA testing."'
    );

    controller.dispose();
  });

  it("keeps the injected result and its staged JSON visible while high-volume events continue", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }

    const store = createEventStore();
    const controller = renderPanel(root, undefined, {
      store,
      bridge: {
        reinjectDraft: vi.fn(() =>
          Promise.resolve({
            requestId: "high-volume-json-mutation",
            ok: true as const,
            status: "success" as const,
            timestamp: 1_784_650_100_000
          })
        )
      }
    });
    for (let index = 0; index < 60; index += 1) {
      store.append(sourceEventAt(index));
    }
    await flushPanelRender();

    click(".event-row");
    click(".clone-button");
    clickButtonByText(".replay-action-bar button", "Mutate & Inject…");
    const jsonEditor = document.querySelector<HTMLTextAreaElement>(
      '.structured-json-input[data-field-name="modelValues"]'
    );
    if (!jsonEditor) {
      throw new Error("missing high-volume modelValues editor");
    }
    jsonEditor.value = MUTATED_MODEL_VALUES;
    jsonEditor.dispatchEvent(new Event("input", { bubbles: true }));
    click(".inject-edited-button");
    await flushPromises();
    await flushPanelRender();

    expect(selectedTimelineEventId()).toBe("synthetic-high-volume-json-mutation");
    expect(document.querySelector(".draft-controls")).not.toBeNull();
    expect(text(".reinjection-message")).toContain(
      "Edited draft delivered to the original app listener"
    );
    expect(
      document.querySelector<HTMLTextAreaElement>(
        '.structured-json-input[data-field-name="modelValues"]'
      )?.value
    ).toContain('"selected": true');

    store.append(sourceEventAt(60));
    await flushPanelRender();

    expect(selectedTimelineEventId()).toBe("synthetic-high-volume-json-mutation");
    expect(text(".selected-event-id")).toBe("synthetic-high-volume-json-mutation");
    expect(detailSection("Current item fields").textContent).toContain('"selected": true');
    expect(
      document.querySelector<HTMLTextAreaElement>(
        '.structured-json-input[data-field-name="modelValues"]'
      )?.value
    ).toContain('"selected": true');

    controller.dispose();
  });

  it("delivers both source replay and edited JSON through positional ItemUpdate APIs", () => {
    document.body.innerHTML = '<output id="application-view">not updated</output>';
    const messages: unknown[] = [];
    const messageListeners: Array<(event: MessageEvent) => void> = [];
    const target = {
      LightstreamerClient: FakeLightstreamerClient,
      Subscription: FakeSubscription,
      addEventListener(type: "message", listener: (event: MessageEvent) => void) {
        if (type === "message") {
          messageListeners.push(listener);
        }
      }
    };
    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message);
    });

    const client = new target.LightstreamerClient("http://localhost:8080", "TEST");
    const subscription = new target.Subscription(
      "COMMAND",
      ["customerDetail"],
      ["command", "key", "modelId", "modelValues"]
    );
    const receivedModelPositions: number[] = [];
    const receivedSelections: boolean[] = [];
    subscription.addListener({
      onItemUpdate(update: SyntheticUpdateView) {
        update.forEachChangedField((fieldName, fieldPos) => {
          if (fieldName !== "modelValues") {
            return;
          }
          const model = JSON.parse(String(update.getValue(fieldPos))) as {
            passenger: { selected: boolean };
          };
          expect(update.isValueChanged(fieldPos)).toBe(true);
          receivedModelPositions.push(fieldPos);
          receivedSelections.push(model.passenger.selected);
          const applicationView = document.querySelector<HTMLOutputElement>("#application-view");
          if (applicationView) {
            applicationView.value = model.passenger.selected ? "selected" : "not selected";
          }
        });
      }
    });
    client.subscribe(subscription);

    messageListeners[0]?.({
      source: target,
      data: {
        type: PAGE_REINJECT_REQUEST,
        requestId: "curated-source-replay",
        draft: {
          ...pageDraft(),
          fields: {
            ...pageDraft().fields,
            modelValues: SOURCE_MODEL_VALUES
          },
          changedFields: {
            modelValues: SOURCE_MODEL_VALUES
          }
        }
      }
    } as unknown as MessageEvent);

    expect(document.querySelector<HTMLOutputElement>("#application-view")?.value).toBe(
      "not selected"
    );

    messageListeners[0]?.({
      source: target,
      data: {
        type: PAGE_REINJECT_REQUEST,
        requestId: "curated-page-delivery",
        draft: pageDraft()
      }
    } as unknown as MessageEvent);

    expect(receivedModelPositions).toEqual([4, 4]);
    expect(receivedSelections).toEqual([false, true]);
    expect(document.querySelector<HTMLOutputElement>("#application-view")?.value).toBe("selected");
    expect(
      messages.some(
        (message) =>
          isRuntimeReinjectResultMessage(message) &&
          message.result.requestId === "curated-page-delivery" &&
          message.result.status === "success"
      )
    ).toBe(true);
  });
});

type SyntheticUpdateView = {
  forEachChangedField(
    iterator: (fieldName: string, fieldPos: number, value: unknown) => void
  ): void;
  getValue(fieldNameOrPos: string | number): unknown;
  isValueChanged(fieldNameOrPos: string | number): boolean;
};

class FakeLightstreamerClient {
  constructor(
    readonly serverAddress: string,
    readonly adapterSet: string
  ) {}

  subscribe(subscription: unknown): unknown {
    return subscription;
  }
}

class FakeSubscription {
  readonly listeners: unknown[] = [];

  constructor(
    readonly mode: string,
    readonly items: string[],
    readonly fields: string[]
  ) {}

  addListener(listener: unknown): unknown {
    this.listeners.push(listener);
    return listener;
  }

  removeListener(listener: unknown): unknown {
    return listener;
  }

  getMode(): string {
    return this.mode;
  }

  getItems(): string[] {
    return this.items;
  }

  getFields(): string[] {
    return this.fields;
  }

  getRequestedSnapshot(): string {
    return "yes";
  }
}

function sourceEvent(): LightstreamerEventEnvelope {
  return {
    id: "source-json-update",
    timestamp: 1_784_640_000_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    captureSource: "listener",
    subscription: { id: "subscription-1", mode: "COMMAND" },
    listener: { id: "listener-1" },
    item: { name: "customerDetail", position: 1 },
    update: {
      isSnapshot: false,
      command: "ADD",
      key: "customer-1",
      fields: {
        command: "ADD",
        key: "customer-1",
        modelId: "CUSTOMER_INIT_INFO",
        modelValues: SOURCE_MODEL_VALUES
      },
      changedFields: {
        command: "ADD",
        key: "customer-1",
        modelId: "CUSTOMER_INIT_INFO",
        modelValues: SOURCE_MODEL_VALUES
      }
    },
    raw: { callback: "onItemUpdate" }
  };
}

function sourceEventAt(index: number): LightstreamerEventEnvelope {
  const event = sourceEvent();
  const key = `customer-${index}`;
  return {
    ...event,
    id: `source-json-update-${index}`,
    timestamp: event.timestamp + index,
    update: {
      ...event.update,
      key,
      fields: {
        ...event.update?.fields,
        key
      },
      changedFields: {
        ...event.update?.changedFields,
        key
      }
    }
  };
}

function pageDraft(): ReinjectionDraftPayload {
  return {
    sourceEventId: "source-json-update",
    executionTarget: "captured-listener",
    target: {
      subscriptionId: "subscription-1",
      listenerId: "listener-1"
    },
    item: {
      name: "customerDetail",
      position: 1
    },
    command: "ADD",
    key: "customer-1",
    fields: {
      command: "ADD",
      key: "customer-1",
      modelId: "CUSTOMER_INIT_INFO",
      modelValues: MUTATED_MODEL_VALUES
    },
    changedFields: {
      modelValues: MUTATED_MODEL_VALUES
    },
    isSnapshot: false,
    provenance: {
      source: "clone",
      sourceEventKind: "item-update",
      sourceSynthetic: false
    }
  };
}

function toPayloadSnapshot(draft: ReinjectionDraftPayload): ReinjectionDraftPayload {
  return structuredClone(draft);
}

function click(selector: string): void {
  const element = document.querySelector<HTMLButtonElement>(selector);
  if (!element) {
    throw new Error(`missing button ${selector}`);
  }
  element.click();
}

function clickButtonByText(selector: string, label: string): void {
  const element = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find(
    (candidate) => candidate.textContent === label && !candidate.disabled
  );
  if (!element) {
    throw new Error(`missing enabled ${label} button in ${selector}`);
  }
  element.click();
}

function detailSection(label: string): HTMLDetailsElement {
  const section = Array.from(document.querySelectorAll<HTMLDetailsElement>(".detail-section")).find(
    (candidate) =>
      candidate.querySelector<HTMLElement>(".detail-section-heading")?.textContent === label
  );
  if (!section) {
    throw new Error(`missing detail section ${label}`);
  }
  return section;
}

function selectedTimelineEventId(): string | undefined {
  return document.querySelector<HTMLButtonElement>('.event-row[data-selected="true"]')?.dataset.eventId;
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? "";
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushPanelRender(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
