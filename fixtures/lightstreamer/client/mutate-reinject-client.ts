import { ItemUpdate, LightstreamerClient, Subscription } from "lightstreamer-client-web";
import {
  PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_GLOBAL,
  PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_VERSION
} from "../../../src/bridge/messages";
import type { ClientMessageRecipeContext } from "../../../src/core/client-message-recipe";

const parameters = new URLSearchParams(window.location.search);
const RECIPE_MODE = parameters.get("recipe") === "qty";
const ITEM = RECIPE_MODE
  ? "scenario.snapshot-basic"
  : parameters.has("server-injection")
  ? "scenario.server-injection"
  : "scenario.mutate-reinject";
// Match the reported production COMMAND schema exactly: key precedes command.
const FIELDS = RECIPE_MODE
  ? ["command", "key", "name", "qty", "status", "version"]
  : ["key", "command", "modelId", "modelValues"];

type FixtureModel = {
  messageId: string;
  messageText: string;
  messageType: string;
};

type FixtureWindow = Window & {
  LightstreamerClient?: typeof LightstreamerClient;
  Subscription?: typeof Subscription;
  LSEW_MUTATE_FIXTURE?: {
    client: LightstreamerClient;
    subscription: Subscription;
  };
};

const connectionState = document.querySelector<HTMLElement>("#connection-state");
const messageText = document.querySelector<HTMLElement>("#message-text");
const updateCount = document.querySelector<HTMLElement>("#update-count");
const renderedModel = document.querySelector<HTMLElement>("#rendered-model");
const events = document.querySelector<HTMLOListElement>("#application-events");

let receivedUpdates = 0;

function installProductionFeedbackInterference(): void {
  if (
    new URLSearchParams(window.location.search).get("feedback") !==
    "block-window-result"
  ) {
    return;
  }

  const originalPostMessage = window.postMessage;
  window.postMessage = ((...args: unknown[]) => {
    const [message] = args;
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { type?: unknown }).type === "lsew:runtime-reinject-result"
    ) {
      return;
    }
    Reflect.apply(originalPostMessage, window, args);
  }) as typeof window.postMessage;
}

function fixtureConstructors(): {
  LightstreamerClient: typeof LightstreamerClient;
  Subscription: typeof Subscription;
} {
  if (parameters.get("capture") !== "listener") {
    return { LightstreamerClient, Subscription };
  }

  const fixtureWindow = window as FixtureWindow;
  fixtureWindow.LightstreamerClient = LightstreamerClient;
  fixtureWindow.Subscription = Subscription;
  return {
    LightstreamerClient: fixtureWindow.LightstreamerClient,
    Subscription: fixtureWindow.Subscription
  };
}

installProductionFeedbackInterference();
installMessageRecipeAdapter();

function setConnectionState(value: string): void {
  if (connectionState) {
    connectionState.textContent = value;
  }
}

function renderUpdate(update: ItemUpdate): void {
  receivedUpdates += 1;
  if (RECIPE_MODE) {
    const rendered = {
      command: update.getValue("command"),
      key: update.getValue("key"),
      name: update.getValue("name"),
      qty: update.getValue("qty"),
      status: update.getValue("status"),
      version: update.getValue("version")
    };
    if (messageText) messageText.textContent = `${rendered.key} qty ${rendered.qty}`;
    if (updateCount) updateCount.textContent = String(receivedUpdates);
    if (renderedModel) renderedModel.textContent = JSON.stringify(rendered, null, 2);
    if (events) {
      const row = document.createElement("li");
      row.textContent = [
        update.isSnapshot() ? "snapshot" : "live",
        update.getItemName(),
        rendered.command,
        rendered.key,
        `qty ${rendered.qty}`,
        `version ${rendered.version}`
      ].join(" | ");
      events.prepend(row);
    }
    return;
  }
  const rawModel = update.getValue("modelValues");
  const parsedModel = parseModel(rawModel);

  if (messageText) {
    messageText.textContent = parsedModel?.messageText ?? "invalid modelValues";
  }
  if (updateCount) {
    updateCount.textContent = String(receivedUpdates);
  }
  if (renderedModel) {
    renderedModel.textContent = parsedModel
      ? JSON.stringify(parsedModel, null, 2)
      : String(rawModel ?? "");
  }
  if (events) {
    const row = document.createElement("li");
    row.textContent = [
      update.isSnapshot() ? "snapshot" : "live",
      update.getItemName(),
      update.getValue("command"),
      update.getValue("key"),
      parsedModel?.messageText ?? "invalid modelValues"
    ].join(" | ");
    events.prepend(row);
  }
}

function installMessageRecipeAdapter(): void {
  if (!RECIPE_MODE) return;
  const host = globalThis as typeof globalThis & Record<string, unknown>;
  host[PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_GLOBAL] = Object.freeze({
    version: PAGE_CLIENT_MESSAGE_RECIPE_ADAPTER_VERSION,
    list(context: ClientMessageRecipeContext) {
      if (
        context.client.adapterSet !== "LSEW_FIXTURE" ||
        context.item.name !== "scenario.snapshot-basic" ||
        context.update?.key !== "beta"
      ) return [];
      const version = context.update.fields.version;
      const qty = context.update.fields.qty;
      if (typeof version !== "string" || typeof qty !== "string") return [];
      return [{
        id: "fixture.update-fields.v1",
        label: "Update fields for beta",
        description: "Starts from the selected COMMAND key and its current version.",
        message: JSON.stringify({
          type: "update-fields",
          item: context.item.name,
          key: context.update.key,
          expectedVersion: version,
          fields: { qty }
        }, null, 2),
        sequence: "LSEW_FIXTURE_FIELD_UPDATES",
        delayTimeout: null,
        enqueueWhileDisconnected: false
      }];
    }
  });
}

function parseModel(value: unknown): FixtureModel | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<FixtureModel>;
    if (
      typeof parsed.messageId === "string" &&
      typeof parsed.messageText === "string" &&
      typeof parsed.messageType === "string"
    ) {
      return parsed as FixtureModel;
    }
  } catch {
    // The visible invalid state makes malformed reinjection fail the browser assertion.
  }
  return null;
}

const constructors = fixtureConstructors();
const client = new constructors.LightstreamerClient(window.location.origin, "LSEW_FIXTURE");
client.connectionOptions.setForcedTransport("WS-STREAMING");
client.addListener({
  onStatusChange(status) {
    setConnectionState(status);
  },
  onServerError(code, message) {
    setConnectionState(`server error ${code}: ${message}`);
  }
});

const subscription = new constructors.Subscription("COMMAND", [ITEM], FIELDS);
subscription.setRequestedSnapshot("yes");
subscription.addListener({
  onSubscription() {
    setConnectionState("SUBSCRIBED");
  },
  onItemUpdate(update) {
    renderUpdate(update);
  },
  onSubscriptionError(code, message) {
    setConnectionState(`subscription error ${code}: ${message}`);
  }
});

(window as FixtureWindow).LSEW_MUTATE_FIXTURE = { client, subscription };
client.subscribe(subscription);
client.connect();
