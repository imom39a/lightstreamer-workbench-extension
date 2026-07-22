import { ItemUpdate, LightstreamerClient, Subscription } from "lightstreamer-client-web";

const ITEM = "scenario.mutate-reinject";
// Match the reported production COMMAND schema exactly: key precedes command.
const FIELDS = ["key", "command", "modelId", "modelValues"];

type FixtureModel = {
  messageId: string;
  messageText: string;
  messageType: string;
};

type FixtureWindow = Window & {
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

function setConnectionState(value: string): void {
  if (connectionState) {
    connectionState.textContent = value;
  }
}

function renderUpdate(update: ItemUpdate): void {
  receivedUpdates += 1;
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

const client = new LightstreamerClient(window.location.origin, "LSEW_FIXTURE");
client.connectionOptions.setForcedTransport("WS-STREAMING");
client.addListener({
  onStatusChange(status) {
    setConnectionState(status);
  },
  onServerError(code, message) {
    setConnectionState(`server error ${code}: ${message}`);
  }
});

const subscription = new Subscription("COMMAND", [ITEM], FIELDS);
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
