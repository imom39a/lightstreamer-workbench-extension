import {
  type CaptureKind,
  type CapturePayload,
  RUNTIME_REINJECT_RESULT,
  type ReinjectionDraftPayload,
  type ReinjectionResult,
  createCaptureMessage,
  isPageReinjectRequestMessage
} from "../bridge/messages";
import { createStableIdAllocator, type StableIdAllocator } from "../core/ids";
import {
  type LightstreamerClientLike,
  type LightstreamerHost,
  type LightstreamerListenerLike,
  type LightstreamerSubscriptionLike
} from "../core/lightstreamer-types";

type InstrumentationState = {
  clientIds: StableIdAllocator;
  subscriptionIds: StableIdAllocator;
  listenerIds: StableIdAllocator;
  wrappedClients: WeakSet<object>;
  wrappedSubscriptions: WeakSet<object>;
  wrappedListeners: WeakSet<object>;
  subscriptionClients: WeakMap<object, object>;
  listenerTargets: Map<string, ReinjectionListenerTarget>;
  originalItemUpdateCallbacks: WeakMap<object, (update: SyntheticItemUpdate) => unknown>;
  emit(kind: CaptureKind, payload: CapturePayload): void;
};

type MethodOwner = Record<string, unknown>;
type ReinjectionListenerTarget = {
  subscriptionId: string;
  listenerId: string;
  callback(update: SyntheticItemUpdate): unknown;
};

type SyntheticItemUpdate = {
  forEachField(iterator: (fieldName: string, fieldPos: number, value: unknown) => void): void;
  forEachChangedField(iterator: (fieldName: string, fieldPos: number, value: unknown) => void): void;
  getItemName(): string | null;
  getItemPos(): number | null;
  getValue(fieldName: string): unknown;
  getValueAsJSONPatchIfAvailable(fieldName: string): null;
  isSnapshot(): boolean;
  isValueChanged(fieldName: string): boolean;
};

type WireConnectionState = {
  clientId: string;
  url: string;
  sessionId: string | null;
  adapterSet: string | null;
  subscriptions: Map<string, WireSubscriptionState>;
};

type WireSubscriptionState = {
  id: string;
  rawSubId: string;
  mode: string | null;
  itemNames: string[] | null;
  fieldNames: string[];
  dataAdapter: string | null;
  requestedSnapshot: string | null;
  keyPosition: number | null;
  commandPosition: number | null;
  itemStates: Map<string, WireItemState>;
  snapshotEndedItems: Set<string>;
  firstUpdateItems: Set<string>;
};

type WireItemState = {
  fields: Record<string, string | number | boolean | null>;
};

type DecodedWireFields = {
  fields: Record<string, string | number | boolean | null>;
  changedFields: Record<string, string | number | boolean | null>;
  jsonPatches: CapturePayload;
  unsupportedDiffFields: string[];
};

const CALLBACKS_TO_CAPTURE = [
  "onEndOfSnapshot",
  "onItemLostUpdates",
  "onClearSnapshot",
  "onItemUpdate",
  "onSubscription",
  "onUnsubscription",
  "onSubscriptionError"
] as const;

export function installLightstreamerInstrumentation(
  host: LightstreamerHost = window,
  postMessage: (message: unknown) => void = (message) => host.postMessage?.(message, "*")
): boolean {
  if (host.__LSEW_INSTRUMENTED__) {
    return false;
  }

  const state: InstrumentationState = {
    clientIds: createStableIdAllocator("client"),
    subscriptionIds: createStableIdAllocator("subscription"),
    listenerIds: createStableIdAllocator("listener"),
    wrappedClients: new WeakSet<object>(),
    wrappedSubscriptions: new WeakSet<object>(),
    wrappedListeners: new WeakSet<object>(),
    subscriptionClients: new WeakMap<object, object>(),
    listenerTargets: new Map<string, ReinjectionListenerTarget>(),
    originalItemUpdateCallbacks: new WeakMap<object, (update: SyntheticItemUpdate) => unknown>(),
    emit(kind, payload) {
      postMessage(createCaptureMessage(kind, payload));
    }
  };
  installReinjectionHandler(host, postMessage, state);
  installWebSocketFallback(host, state);

  let installed = false;

  const wrapClientConstructor = (OriginalClient: NonNullable<LightstreamerHost["LightstreamerClient"]>) => {
    function InstrumentedLightstreamerClient(
      this: LightstreamerClientLike,
      ...args: unknown[]
    ): LightstreamerClientLike {
      const instance = Reflect.construct(
        OriginalClient,
        args,
        new.target ?? InstrumentedLightstreamerClient
      ) as LightstreamerClientLike;
      const clientId = state.clientIds.getId(instance);

      host.__LSEW_PRIMARY_ACTIVE__ = true;
      wrapClient(instance, state);
      state.emit("client-created", {
        client: {
          id: clientId,
          serverAddress: toJsonValue(args[0]),
          adapterSet: toJsonValue(args[1]),
          status: readGetter(instance, "getStatus")
        }
      });

      return instance;
    }

    InstrumentedLightstreamerClient.prototype = OriginalClient.prototype;
    Object.setPrototypeOf(InstrumentedLightstreamerClient, OriginalClient);
    return InstrumentedLightstreamerClient as typeof OriginalClient;
  };

  installed =
    installConstructorHook(host, "LightstreamerClient", wrapClientConstructor) || installed;

  const wrapSubscriptionConstructor = (
    OriginalSubscription: NonNullable<LightstreamerHost["Subscription"]>
  ) => {
    function InstrumentedSubscription(
      this: LightstreamerSubscriptionLike,
      ...args: unknown[]
    ): LightstreamerSubscriptionLike {
      const instance = Reflect.construct(
        OriginalSubscription,
        args,
        new.target ?? InstrumentedSubscription
      ) as LightstreamerSubscriptionLike;
      const subscriptionId = state.subscriptionIds.getId(instance);

      host.__LSEW_PRIMARY_ACTIVE__ = true;
      wrapSubscription(instance, state);
      state.emit("subscription-created", {
        subscription: {
          id: subscriptionId,
          ...readSubscriptionMetadata(instance, args)
        }
      });

      return instance;
    }

    InstrumentedSubscription.prototype = OriginalSubscription.prototype;
    Object.setPrototypeOf(InstrumentedSubscription, OriginalSubscription);
    return InstrumentedSubscription as typeof OriginalSubscription;
  };

  installed = installConstructorHook(host, "Subscription", wrapSubscriptionConstructor) || installed;

  installed =
    installNamespaceHook(host, wrapClientConstructor, wrapSubscriptionConstructor) || installed;

  host.__LSEW_INSTRUMENTED__ = installed;
  return installed;
}

function installNamespaceHook(
  host: LightstreamerHost,
  wrapClientConstructor: (
    constructor: NonNullable<LightstreamerHost["LightstreamerClient"]>
  ) => NonNullable<LightstreamerHost["LightstreamerClient"]>,
  wrapSubscriptionConstructor: (
    constructor: NonNullable<LightstreamerHost["Subscription"]>
  ) => NonNullable<LightstreamerHost["Subscription"]>
): boolean {
  const hookNamespace = (namespace: unknown): boolean => {
    if (!isObject(namespace)) {
      return false;
    }

    let namespaceInstalled = false;
    namespaceInstalled =
      installConstructorHook(namespace, "LightstreamerClient", wrapClientConstructor) ||
      namespaceInstalled;
    namespaceInstalled =
      installConstructorHook(namespace, "Subscription", wrapSubscriptionConstructor) ||
      namespaceInstalled;
    return namespaceInstalled;
  };

  let installed = hookNamespace(host.Lightstreamer);

  try {
    let current = host.Lightstreamer;
    Object.defineProperty(host, "Lightstreamer", {
      configurable: true,
      enumerable: true,
      get() {
        return current;
      },
      set(value) {
        current = value;
        hookNamespace(current);
      }
    });
    return true;
  } catch (_error) {
    return installed;
  }
}

function installConstructorHook<K extends "LightstreamerClient" | "Subscription">(
  host: Pick<LightstreamerHost, "LightstreamerClient" | "Subscription">,
  property: K,
  wrap: (constructor: NonNullable<LightstreamerHost[K]>) => NonNullable<LightstreamerHost[K]>
): boolean {
  if (typeof host[property] === "function") {
    host[property] = wrap(host[property] as NonNullable<LightstreamerHost[K]>);
    return true;
  }

  try {
    let current = host[property];
    Object.defineProperty(host, property, {
      configurable: true,
      enumerable: true,
      get() {
        return current;
      },
      set(value) {
        current = typeof value === "function" ? wrap(value as NonNullable<LightstreamerHost[K]>) : value;
      }
    });
    return true;
  } catch (_error) {
    return false;
  }
}

function installWebSocketFallback(host: LightstreamerHost, state: InstrumentationState): boolean {
  if (host.__LSEW_WS_FALLBACK__ || typeof host.WebSocket !== "function") {
    return false;
  }

  const OriginalWebSocket = host.WebSocket;

  function InstrumentedWebSocket(this: WebSocket, ...args: ConstructorParameters<typeof WebSocket>) {
    const socket = Reflect.construct(
      OriginalWebSocket,
      args,
      new.target ?? InstrumentedWebSocket
    ) as WebSocket;
    const url = webSocketUrlToString(args[0]);

    if (!host.__LSEW_PRIMARY_ACTIVE__ && isLightstreamerWebSocketUrl(url)) {
      installWireCaptureForSocket(host, socket, url, state);
    }

    return socket;
  }

  InstrumentedWebSocket.prototype = OriginalWebSocket.prototype;
  Object.setPrototypeOf(InstrumentedWebSocket, OriginalWebSocket);
  host.WebSocket = InstrumentedWebSocket as typeof WebSocket;
  host.__LSEW_WS_FALLBACK__ = true;
  return true;
}

function installWireCaptureForSocket(
  host: LightstreamerHost,
  socket: WebSocket,
  url: string,
  state: InstrumentationState
): void {
  const wire: WireConnectionState = {
    clientId: state.clientIds.getId(socket),
    url,
    sessionId: null,
    adapterSet: null,
    subscriptions: new Map<string, WireSubscriptionState>()
  };

  state.emit("client-created", {
    client: {
      id: wire.clientId,
      serverAddress: url
    },
    raw: wireRaw({
      frameDirection: "constructor",
      url
    })
  });

  wrapWireSend(host, socket, wire, state);

  if (typeof socket.addEventListener !== "function") {
    return;
  }

  socket.addEventListener("message", (event) => {
    if (host.__LSEW_PRIMARY_ACTIVE__) {
      return;
    }
    const text = textWirePayload(event.data);
    if (text === null) {
      return;
    }
    handleWireInboundFrame(text, wire, state);
  });
}

function wrapWireSend(
  host: LightstreamerHost,
  socket: WebSocket,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const originalSend = socket.send;
  if (typeof originalSend !== "function") {
    return;
  }

  try {
    socket.send = function wrappedWireSend(this: WebSocket, ...args: Parameters<WebSocket["send"]>) {
      if (!host.__LSEW_PRIMARY_ACTIVE__) {
        const text = textWirePayload(args[0]);
        if (text !== null) {
          handleWireOutboundFrame(text, wire, state);
        }
      }
      return originalSend.apply(this, args);
    };
  } catch (_error) {
    // Some browser implementations may make send non-writable; message capture still works.
  }
}

function handleWireOutboundFrame(
  frame: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  for (const params of parseTlcpParameterLines(frame)) {
    wire.adapterSet = params.get("LS_adapter_set") ?? wire.adapterSet;
    const operation = params.get("LS_op");
    if (operation === "add") {
      handleWireSubscriptionAdd(params, wire, state);
    } else if (operation === "delete") {
      handleWireSubscriptionDelete(params, wire, state);
    }
  }
}

function handleWireSubscriptionAdd(
  params: URLSearchParams,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const rawSubId = params.get("LS_subId");
  if (!rawSubId) {
    return;
  }

  const subscription = createWireSubscription(rawSubId, params);
  wire.subscriptions.set(rawSubId, subscription);
  state.emit("subscription-created", {
    client: { id: wire.clientId },
    subscription: wireSubscriptionPayload(subscription),
    raw: wireRaw({
      frameDirection: "outbound",
      operation: "add",
      request: paramsToJson(params)
    })
  });
}

function handleWireSubscriptionDelete(
  params: URLSearchParams,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const rawSubId = params.get("LS_subId");
  if (!rawSubId) {
    return;
  }

  const subscription = ensureWireSubscription(wire, rawSubId);
  state.emit("subscription-ended", {
    client: { id: wire.clientId },
    subscription: { id: subscription.id },
    raw: wireRaw({
      frameDirection: "outbound",
      operation: "delete",
      request: paramsToJson(params)
    })
  });
  wire.subscriptions.delete(rawSubId);
}

function handleWireInboundFrame(
  frame: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  for (const line of splitTlcpLines(frame)) {
    if (line.startsWith("CONOK,")) {
      handleWireConok(line, wire, state);
    } else if (line.startsWith("SUBOK,")) {
      handleWireSubscriptionOk(line, wire, state, false);
    } else if (line.startsWith("SUBCMD,")) {
      handleWireSubscriptionOk(line, wire, state, true);
    } else if (line.startsWith("UNSUB,")) {
      handleWireUnsub(line, wire, state);
    } else if (line.startsWith("EOS,")) {
      handleWireEndOfSnapshot(line, wire, state);
    } else if (line.startsWith("CS,")) {
      handleWireClearSnapshot(line, wire, state);
    } else if (line.startsWith("OV,")) {
      handleWireOverflow(line, wire, state);
    } else if (line.startsWith("U,")) {
      handleWireUpdate(line, wire, state);
    }
  }
}

function handleWireConok(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const parts = line.split(",");
  wire.sessionId = parts[1] ?? wire.sessionId;
  state.emit("client-status", {
    client: {
      id: wire.clientId,
      status: "CONNECTED:WS-STREAMING",
      adapterSet: wire.adapterSet
    },
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: "CONOK",
      sessionId: wire.sessionId
    })
  });
}

function handleWireSubscriptionOk(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState,
  commandMode: boolean
): void {
  const parts = line.split(",");
  const rawSubId = parts[1];
  if (!rawSubId) {
    return;
  }

  const subscription = ensureWireSubscription(wire, rawSubId);
  const fieldCount = toPositiveInteger(parts[3]);
  if (fieldCount !== null) {
    ensureWireFieldCount(subscription, fieldCount);
  }

  if (commandMode) {
    subscription.mode = "COMMAND";
    subscription.keyPosition = toPositiveInteger(parts[4]);
    subscription.commandPosition = toPositiveInteger(parts[5]);
    applyCommandFieldAliases(subscription);
  }

  state.emit("subscription-started", {
    client: { id: wire.clientId },
    subscription: wireSubscriptionPayload(subscription),
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: commandMode ? "SUBCMD" : "SUBOK",
      rawSubId
    })
  });
}

function handleWireUnsub(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const rawSubId = line.split(",")[1];
  if (!rawSubId) {
    return;
  }

  const subscription = ensureWireSubscription(wire, rawSubId);
  state.emit("subscription-ended", {
    client: { id: wire.clientId },
    subscription: { id: subscription.id },
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: "UNSUB",
      rawSubId
    })
  });
  wire.subscriptions.delete(rawSubId);
}

function handleWireEndOfSnapshot(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const parts = line.split(",");
  const rawSubId = parts[1];
  const itemPosition = toPositiveInteger(parts[2]);
  if (!rawSubId || itemPosition === null) {
    return;
  }

  const subscription = ensureWireSubscription(wire, rawSubId);
  const itemKey = String(itemPosition);
  subscription.snapshotEndedItems.add(itemKey);
  state.emit("end-of-snapshot", {
    client: { id: wire.clientId },
    subscription: { id: subscription.id },
    item: wireItemPayload(subscription, itemPosition),
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: "EOS",
      rawSubId,
      itemPosition
    })
  });
}

function handleWireClearSnapshot(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const parts = line.split(",");
  const rawSubId = parts[1];
  const itemPosition = toPositiveInteger(parts[2]);
  if (!rawSubId || itemPosition === null) {
    return;
  }

  const subscription = ensureWireSubscription(wire, rawSubId);
  subscription.itemStates.delete(String(itemPosition));
  state.emit("clear-snapshot", {
    client: { id: wire.clientId },
    subscription: { id: subscription.id },
    item: wireItemPayload(subscription, itemPosition),
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: "CS",
      rawSubId,
      itemPosition
    })
  });
}

function handleWireOverflow(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const parts = line.split(",");
  const rawSubId = parts[1];
  const itemPosition = toPositiveInteger(parts[2]);
  const lostUpdates = toPositiveInteger(parts[3]);
  if (!rawSubId || itemPosition === null) {
    return;
  }

  const subscription = ensureWireSubscription(wire, rawSubId);
  state.emit("lost-updates", {
    client: { id: wire.clientId },
    subscription: { id: subscription.id },
    item: wireItemPayload(subscription, itemPosition),
    update: compactJsonObject({ lostUpdates }),
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: "OV",
      rawSubId,
      itemPosition
    })
  });
}

function handleWireUpdate(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const parsed = parseWireUpdateLine(line);
  if (!parsed) {
    return;
  }

  const subscription = ensureWireSubscription(wire, parsed.rawSubId);
  const itemKey = String(parsed.itemPosition);
  const itemState = getWireItemState(subscription, itemKey);
  const decoded = decodeWireFields(subscription, parsed.fieldData, itemState.fields);
  const isSnapshot = inferWireSnapshot(subscription, itemKey);
  const command = readCommandField(subscription, decoded.fields);
  const key = readKeyField(subscription, decoded.fields);

  itemState.fields = decoded.fields;
  subscription.firstUpdateItems.add(itemKey);

  state.emit("item-update", {
    client: { id: wire.clientId },
    subscription: wireSubscriptionPayload(subscription),
    item: wireItemPayload(subscription, parsed.itemPosition),
    update: compactJsonObject({
      isSnapshot,
      fields: decoded.fields,
      changedFields: decoded.changedFields,
      jsonPatches: decoded.jsonPatches,
      command,
      key
    }),
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: "U",
      rawSubId: parsed.rawSubId,
      itemPosition: parsed.itemPosition,
      unsupportedDiffFields: decoded.unsupportedDiffFields
    })
  });
}

function createWireSubscription(
  rawSubId: string,
  params: URLSearchParams
): WireSubscriptionState {
  const fieldNames = splitWireList(params.get("LS_schema")) ?? [];
  const subscription: WireSubscriptionState = {
    id: wireSubscriptionId(rawSubId),
    rawSubId,
    mode: params.get("LS_mode"),
    itemNames: splitWireList(params.get("LS_group")),
    fieldNames,
    dataAdapter: params.get("LS_data_adapter"),
    requestedSnapshot: params.get("LS_snapshot"),
    keyPosition: null,
    commandPosition: null,
    itemStates: new Map<string, WireItemState>(),
    snapshotEndedItems: new Set<string>(),
    firstUpdateItems: new Set<string>()
  };

  return subscription;
}

function ensureWireSubscription(
  wire: WireConnectionState,
  rawSubId: string
): WireSubscriptionState {
  const existing = wire.subscriptions.get(rawSubId);
  if (existing) {
    return existing;
  }

  const subscription: WireSubscriptionState = {
    id: wireSubscriptionId(rawSubId),
    rawSubId,
    mode: null,
    itemNames: null,
    fieldNames: [],
    dataAdapter: null,
    requestedSnapshot: null,
    keyPosition: null,
    commandPosition: null,
    itemStates: new Map<string, WireItemState>(),
    snapshotEndedItems: new Set<string>(),
    firstUpdateItems: new Set<string>()
  };
  wire.subscriptions.set(rawSubId, subscription);
  return subscription;
}

function getWireItemState(subscription: WireSubscriptionState, itemKey: string): WireItemState {
  const existing = subscription.itemStates.get(itemKey);
  if (existing) {
    return existing;
  }

  const itemState = { fields: {} };
  subscription.itemStates.set(itemKey, itemState);
  return itemState;
}

function decodeWireFields(
  subscription: WireSubscriptionState,
  fieldData: string,
  previousFields: Record<string, string | number | boolean | null>
): DecodedWireFields {
  const fields = { ...previousFields };
  const changedFields: Record<string, string | number | boolean | null> = {};
  const jsonPatches: CapturePayload = {};
  const unsupportedDiffFields: string[] = [];
  let pointer = 0;

  for (const token of fieldData.split("|")) {
    if (token === "") {
      pointer += 1;
      continue;
    }

    if (/^\^\d+$/.test(token)) {
      pointer += Number(token.slice(1));
      continue;
    }

    const fieldName = fieldNameAt(subscription, pointer);
    if (token === "#") {
      fields[fieldName] = null;
      changedFields[fieldName] = null;
      pointer += 1;
      continue;
    }

    if (token === "$") {
      fields[fieldName] = "";
      changedFields[fieldName] = "";
      pointer += 1;
      continue;
    }

    if (/^\^[A-Za-z]/.test(token)) {
      const diffFormat = token[1];
      const diffValue = decodeTlcpValue(token.slice(2));
      if (diffFormat === "P") {
        jsonPatches[fieldName] = parseJsonPatch(diffValue);
      }
      unsupportedDiffFields.push(fieldName);
      changedFields[fieldName] = diffValue;
      if (!Object.prototype.hasOwnProperty.call(fields, fieldName)) {
        fields[fieldName] = diffValue;
      }
      pointer += 1;
      continue;
    }

    const value = decodeTlcpValue(token);
    fields[fieldName] = value;
    changedFields[fieldName] = value;
    pointer += 1;
  }

  return {
    fields,
    changedFields,
    jsonPatches,
    unsupportedDiffFields
  };
}

function inferWireSnapshot(subscription: WireSubscriptionState, itemKey: string): boolean {
  if (!isSnapshotRequested(subscription.requestedSnapshot)) {
    return false;
  }

  if (subscription.mode === "MERGE") {
    return !subscription.firstUpdateItems.has(itemKey);
  }

  if (subscription.mode === "RAW") {
    return false;
  }

  return !subscription.snapshotEndedItems.has(itemKey);
}

function isSnapshotRequested(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized !== "false" && normalized !== "no";
}

function wireSubscriptionPayload(subscription: WireSubscriptionState): CapturePayload {
  return compactJsonObject({
    id: subscription.id,
    mode: subscription.mode,
    items: subscription.itemNames,
    fields: subscription.fieldNames.length > 0 ? subscription.fieldNames : undefined,
    dataAdapter: subscription.dataAdapter,
    requestedSnapshot: subscription.requestedSnapshot,
    keyPosition: subscription.keyPosition,
    commandPosition: subscription.commandPosition
  });
}

function wireItemPayload(subscription: WireSubscriptionState, itemPosition: number): CapturePayload {
  return compactJsonObject({
    name: subscription.itemNames?.[itemPosition - 1] ?? null,
    position: itemPosition
  });
}

function wireRaw(source: Record<string, unknown>): CapturePayload {
  return compactJsonObject({
    captureSource: "websocket-tlcp",
    transport: "websocket",
    ...source
  });
}

function parseWireUpdateLine(
  line: string
): { rawSubId: string; itemPosition: number; fieldData: string } | null {
  const first = line.indexOf(",");
  const second = first >= 0 ? line.indexOf(",", first + 1) : -1;
  const third = second >= 0 ? line.indexOf(",", second + 1) : -1;
  if (first < 0 || second < 0 || third < 0) {
    return null;
  }

  const rawSubId = line.slice(first + 1, second);
  const itemPosition = toPositiveInteger(line.slice(second + 1, third));
  if (!rawSubId || itemPosition === null) {
    return null;
  }

  return {
    rawSubId,
    itemPosition,
    fieldData: line.slice(third + 1)
  };
}

function parseTlcpParameterLines(frame: string): URLSearchParams[] {
  return splitTlcpLines(frame)
    .filter((line) => line.includes("="))
    .map((line) => new URLSearchParams(line))
    .filter((params) => params.has("LS_op") || params.has("LS_adapter_set"));
}

function splitTlcpLines(frame: string): string[] {
  return frame
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function paramsToJson(params: URLSearchParams): CapturePayload {
  const payload: CapturePayload = {};
  for (const [key, value] of params.entries()) {
    payload[key] = value;
  }
  return payload;
}

function splitWireList(value: string | null): string[] | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  return value.split(/\s+/).filter(Boolean);
}

function ensureWireFieldCount(subscription: WireSubscriptionState, count: number): void {
  while (subscription.fieldNames.length < count) {
    subscription.fieldNames.push(`field-${subscription.fieldNames.length + 1}`);
  }
}

function fieldNameAt(subscription: WireSubscriptionState, index: number): string {
  ensureWireFieldCount(subscription, index + 1);
  return subscription.fieldNames[index] ?? `field-${index + 1}`;
}

function applyCommandFieldAliases(subscription: WireSubscriptionState): void {
  const keyIndex = subscription.keyPosition === null ? -1 : subscription.keyPosition - 1;
  const commandIndex =
    subscription.commandPosition === null ? -1 : subscription.commandPosition - 1;

  if (keyIndex >= 0) {
    ensureWireFieldCount(subscription, keyIndex + 1);
    if (/^field-\d+$/.test(subscription.fieldNames[keyIndex])) {
      subscription.fieldNames[keyIndex] = "key";
    }
  }

  if (commandIndex >= 0) {
    ensureWireFieldCount(subscription, commandIndex + 1);
    if (/^field-\d+$/.test(subscription.fieldNames[commandIndex])) {
      subscription.fieldNames[commandIndex] = "command";
    }
  }
}

function readCommandField(
  subscription: WireSubscriptionState,
  fields: Record<string, string | number | boolean | null>
): string | null {
  return readPositionedField(subscription, fields, subscription.commandPosition) ?? readNamedField(fields, "command");
}

function readKeyField(
  subscription: WireSubscriptionState,
  fields: Record<string, string | number | boolean | null>
): string | null {
  return readPositionedField(subscription, fields, subscription.keyPosition) ?? readNamedField(fields, "key");
}

function readPositionedField(
  subscription: WireSubscriptionState,
  fields: Record<string, string | number | boolean | null>,
  position: number | null
): string | null {
  if (position === null) {
    return null;
  }
  const fieldName = subscription.fieldNames[position - 1];
  return fieldName ? asNullableString(fields[fieldName]) : null;
}

function readNamedField(
  fields: Record<string, string | number | boolean | null>,
  fieldName: string
): string | null {
  return asNullableString(fields[fieldName]);
}

function decodeTlcpValue(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch (_error) {
    return value.replace(/\+/g, " ");
  }
}

function parseJsonPatch(value: string): CapturePayload[string] {
  try {
    return toJsonValue(JSON.parse(value));
  } catch (_error) {
    return value;
  }
}

function webSocketUrlToString(value: string | URL): string {
  return String(value);
}

function isLightstreamerWebSocketUrl(url: string): boolean {
  return url.toLowerCase().includes("/lightstreamer");
}

function textWirePayload(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function wireSubscriptionId(rawSubId: string): string {
  return `subscription-${rawSubId}`;
}

function toPositiveInteger(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function wrapClient(client: LightstreamerClientLike, state: InstrumentationState): void {
  if (!isObject(client) || state.wrappedClients.has(client)) {
    return;
  }
  state.wrappedClients.add(client);

  wrapMethod(client, "connect", function afterConnect(target) {
    state.emit("client-status", {
      client: {
        id: state.clientIds.getId(target),
        status: readGetter(target, "getStatus") ?? "connect-called"
      }
    });
  });

  wrapMethod(client, "disconnect", function afterDisconnect(target) {
    state.emit("client-status", {
      client: {
        id: state.clientIds.getId(target),
        status: readGetter(target, "getStatus") ?? "disconnect-called"
      }
    });
  });

  wrapMethod(client, "subscribe", function afterSubscribe(target, args) {
    const subscription = args[0];
    if (!isObject(subscription)) {
      return;
    }
    wrapSubscription(subscription as LightstreamerSubscriptionLike, state);
    state.subscriptionClients.set(subscription, target);
    state.emit("subscription-started", {
      client: { id: state.clientIds.getId(target) },
      subscription: {
        id: state.subscriptionIds.getId(subscription),
        ...readSubscriptionMetadata(subscription as LightstreamerSubscriptionLike)
      }
    });
  });

  wrapMethod(client, "unsubscribe", function afterUnsubscribe(target, args) {
    const subscription = args[0];
    state.emit("subscription-ended", {
      client: { id: state.clientIds.getId(target) },
      subscription: isObject(subscription)
        ? { id: state.subscriptionIds.getId(subscription) }
        : { id: "unknown" }
    });
  });

  wrapMethod(client, "addListener", function afterAddListener(target, args) {
    const listener = args[0];
    if (!isObject(listener)) {
      return;
    }
    wrapClientListener(target, listener as LightstreamerListenerLike, state);
    state.emit("listener-added", {
      client: { id: state.clientIds.getId(target) },
      listener: { id: state.listenerIds.getId(listener) }
    });
  });

  wrapMethod(client, "removeListener", function afterRemoveListener(target, args) {
    const listener = args[0];
    state.emit("listener-removed", {
      client: { id: state.clientIds.getId(target) },
      listener: isObject(listener) ? { id: state.listenerIds.getId(listener) } : { id: "unknown" }
    });
  });
}

function wrapSubscription(
  subscription: LightstreamerSubscriptionLike,
  state: InstrumentationState
): void {
  if (!isObject(subscription) || state.wrappedSubscriptions.has(subscription)) {
    return;
  }
  state.wrappedSubscriptions.add(subscription);

  wrapMethod(subscription, "addListener", function afterAddListener(target, args) {
    const listener = args[0];
    if (!isObject(listener)) {
      return;
    }
    wrapSubscriptionListener(target, listener as LightstreamerListenerLike, state);
    registerReinjectionTarget(target, listener as LightstreamerListenerLike, state);
    state.emit("listener-added", {
      subscription: { id: state.subscriptionIds.getId(target) },
      listener: { id: state.listenerIds.getId(listener) }
    });
  });

  wrapMethod(subscription, "removeListener", function afterRemoveListener(target, args) {
    const listener = args[0];
    if (isObject(listener)) {
      unregisterReinjectionTarget(target, listener, state);
    }
    state.emit("listener-removed", {
      subscription: { id: state.subscriptionIds.getId(target) },
      listener: isObject(listener) ? { id: state.listenerIds.getId(listener) } : { id: "unknown" }
    });
  });
}

function wrapClientListener(
  client: object,
  listener: LightstreamerListenerLike,
  state: InstrumentationState
): void {
  if (state.wrappedListeners.has(listener)) {
    return;
  }
  state.wrappedListeners.add(listener);

  wrapCallback(listener, "onStatusChange", function beforeStatusChange(args) {
    state.emit("client-status", {
      client: {
        id: state.clientIds.getId(client),
        status: toJsonValue(args[0])
      },
      listener: { id: state.listenerIds.getId(listener) }
    });
  });
}

function wrapSubscriptionListener(
  subscription: object,
  listener: LightstreamerListenerLike,
  state: InstrumentationState
): void {
  if (state.wrappedListeners.has(listener)) {
    return;
  }
  state.wrappedListeners.add(listener);

  const originalItemUpdate = listener.onItemUpdate;
  if (typeof originalItemUpdate === "function") {
    state.originalItemUpdateCallbacks.set(
      listener,
      originalItemUpdate.bind(listener) as (update: SyntheticItemUpdate) => unknown
    );
  }

  for (const callback of CALLBACKS_TO_CAPTURE) {
    wrapCallback(listener, callback, function beforeLifecycleCallback(args) {
      const kind = callbackToKind(callback);
      if (!kind) {
        return;
      }
      const itemPayload = kind === "item-update" ? readItemUpdatePayload(args[0]) : {};
      const itemRaw = isObject(itemPayload.raw) ? itemPayload.raw : {};

      state.emit(kind, {
        client: readSubscriptionClient(subscription, state),
        subscription: {
          id: state.subscriptionIds.getId(subscription),
          ...readSubscriptionMetadata(subscription as LightstreamerSubscriptionLike)
        },
        listener: { id: state.listenerIds.getId(listener) },
        ...itemPayload,
        raw: {
          ...itemRaw,
          callback,
          args: kind === "item-update" ? ["[ItemUpdate]"] : args.map((entry) => toJsonValue(entry))
        }
      });
    });
  }
}

function registerReinjectionTarget(
  subscription: object,
  listener: LightstreamerListenerLike,
  state: InstrumentationState
): void {
  const callback = state.originalItemUpdateCallbacks.get(listener);
  if (!callback) {
    return;
  }

  const subscriptionId = state.subscriptionIds.getId(subscription);
  const listenerId = state.listenerIds.getId(listener);
  state.listenerTargets.set(targetKey(subscriptionId, listenerId), {
    subscriptionId,
    listenerId,
    callback
  });
}

function unregisterReinjectionTarget(
  subscription: object,
  listener: object,
  state: InstrumentationState
): void {
  state.listenerTargets.delete(
    targetKey(state.subscriptionIds.getId(subscription), state.listenerIds.getId(listener))
  );
}

function installReinjectionHandler(
  host: LightstreamerHost,
  postMessage: (message: unknown) => void,
  state: InstrumentationState
): void {
  if (typeof host.addEventListener !== "function") {
    return;
  }

  host.addEventListener("message", (event) => {
    if (event.source !== host || !isPageReinjectRequestMessage(event.data)) {
      return;
    }

    postMessage({
      type: RUNTIME_REINJECT_RESULT,
      result: reinjectDraft(event.data.requestId, event.data.draft, state)
    });
  });
}

function reinjectDraft(
  requestId: string,
  draft: ReinjectionDraftPayload,
  state: InstrumentationState
): ReinjectionResult {
  const target = state.listenerTargets.get(
    targetKey(draft.target.subscriptionId, draft.target.listenerId)
  );

  if (!target) {
    return {
      requestId,
      ok: false,
      status: "stale-target",
      timestamp: Date.now(),
      error: "Original subscription listener is no longer available."
    };
  }

  try {
    target.callback(createSyntheticItemUpdate(draft));
    return {
      requestId,
      ok: true,
      status: "success",
      timestamp: Date.now()
    };
  } catch (error) {
    return {
      requestId,
      ok: false,
      status: "listener-error",
      timestamp: Date.now(),
      error: error instanceof Error ? error.message.slice(0, 500) : "Listener callback failed."
    };
  }
}

function createSyntheticItemUpdate(draft: ReinjectionDraftPayload): SyntheticItemUpdate {
  const fields = {
    ...draft.fields,
    command: draft.command,
    key: draft.key
  };
  const changedFields = { ...draft.changedFields };
  const fieldEntries = Object.entries(fields);
  const changedFieldEntries = Object.entries(changedFields);

  return {
    forEachField(iterator) {
      fieldEntries.forEach(([fieldName, value], index) => {
        iterator(fieldName, index + 1, value);
      });
    },
    forEachChangedField(iterator) {
      changedFieldEntries.forEach(([fieldName, value], index) => {
        iterator(fieldName, index + 1, value);
      });
    },
    getItemName() {
      return draft.item.name ?? null;
    },
    getItemPos() {
      return draft.item.position ?? null;
    },
    getValue(fieldName) {
      return Object.prototype.hasOwnProperty.call(fields, fieldName) ? fields[fieldName] : null;
    },
    getValueAsJSONPatchIfAvailable() {
      return null;
    },
    isSnapshot() {
      return draft.isSnapshot;
    },
    isValueChanged(fieldName) {
      return Object.prototype.hasOwnProperty.call(changedFields, fieldName);
    }
  };
}

function targetKey(subscriptionId: string, listenerId: string): string {
  return `${subscriptionId}:${listenerId}`;
}

function wrapMethod<T extends MethodOwner>(
  target: T,
  name: string,
  after: (target: T, args: unknown[], result: unknown) => void
): void {
  const original = target[name];
  if (typeof original !== "function") {
    return;
  }

  target[name] = function wrappedMethod(this: T, ...args: unknown[]) {
    const result = original.apply(this, args);
    after(this, args, result);
    return result;
  };
}

function wrapCallback(
  listener: LightstreamerListenerLike,
  name: string,
  before: (args: unknown[]) => void
): void {
  const original = listener[name];
  if (typeof original !== "function") {
    return;
  }

  listener[name] = function wrappedCallback(this: LightstreamerListenerLike, ...args: unknown[]) {
    before(args);
    return original.apply(this, args);
  };
}

function callbackToKind(callback: string): CaptureKind | null {
  switch (callback) {
    case "onEndOfSnapshot":
      return "end-of-snapshot";
    case "onItemLostUpdates":
      return "lost-updates";
    case "onClearSnapshot":
      return "clear-snapshot";
    case "onItemUpdate":
      return "item-update";
    case "onSubscription":
      return "subscription-started";
    case "onUnsubscription":
      return "subscription-ended";
    case "onSubscriptionError":
      return "subscription-error";
    default:
      return null;
  }
}

function readSubscriptionClient(subscription: object, state: InstrumentationState) {
  const client = state.subscriptionClients.get(subscription);
  return client ? { id: state.clientIds.getId(client) } : undefined;
}

function readItemUpdatePayload(update: unknown): CapturePayload {
  if (!isObject(update)) {
    return {
      item: {},
      update: {},
      raw: {
        extractionErrors: ["ItemUpdate callback argument was not an object"]
      }
    };
  }

  const extractionErrors: string[] = [];
  const fields = readUpdateFields(update, "forEachField", extractionErrors);
  const changedFields = readUpdateFields(update, "forEachChangedField", extractionErrors);
  const jsonPatches = readJsonPatches(update, fields, changedFields, extractionErrors);
  const command = asNullableString(fields.command ?? changedFields.command);
  const key = asNullableString(fields.key ?? changedFields.key);

  return {
    item: compactJsonObject({
      name: readUpdateGetter(update, "getItemName", extractionErrors),
      position: readUpdateGetter(update, "getItemPos", extractionErrors)
    }),
    update: compactJsonObject({
      isSnapshot: readUpdateGetter(update, "isSnapshot", extractionErrors),
      fields,
      changedFields,
      jsonPatches,
      command,
      key
    }),
    raw: compactJsonObject({
      extractionErrors: extractionErrors.slice(0, 8),
      fieldCount: Object.keys(fields).length,
      changedFieldCount: Object.keys(changedFields).length
    })
  };
}

function readUpdateFields(
  update: Record<string, unknown>,
  methodName: "forEachField" | "forEachChangedField",
  extractionErrors: string[]
): CapturePayload {
  const fields: CapturePayload = {};
  const iterator = update[methodName];
  if (typeof iterator !== "function") {
    return fields;
  }

  try {
    iterator.call(update, (...args: unknown[]) => {
      const fieldName = args[0];
      const value = args.length >= 3 ? args[2] : args[1];
      if (fieldName !== undefined && fieldName !== null) {
        fields[String(fieldName)] = toJsonValue(value);
      }
    });
  } catch (error) {
    extractionErrors.push(`${methodName}:${error instanceof Error ? error.message : "unknown"}`);
  }

  return fields;
}

function readJsonPatches(
  update: Record<string, unknown>,
  fields: CapturePayload,
  changedFields: CapturePayload,
  extractionErrors: string[]
): CapturePayload {
  const patches: CapturePayload = {};
  const getter = update.getValueAsJSONPatchIfAvailable;
  if (typeof getter !== "function") {
    return patches;
  }

  for (const fieldName of new Set([...Object.keys(fields), ...Object.keys(changedFields)])) {
    try {
      const patch = getter.call(update, fieldName);
      if (patch !== null && patch !== undefined) {
        patches[fieldName] = toJsonValue(patch);
      }
    } catch (error) {
      extractionErrors.push(
        `getValueAsJSONPatchIfAvailable:${fieldName}:${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }
  }

  return patches;
}

function readUpdateGetter(
  update: Record<string, unknown>,
  methodName: "getItemName" | "getItemPos" | "isSnapshot",
  extractionErrors: string[]
) {
  const getter = update[methodName];
  if (typeof getter !== "function") {
    return undefined;
  }

  try {
    return toJsonValue(getter.call(update));
  } catch (error) {
    extractionErrors.push(`${methodName}:${error instanceof Error ? error.message : "unknown"}`);
    return undefined;
  }
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function readSubscriptionMetadata(
  subscription: LightstreamerSubscriptionLike,
  constructorArgs: unknown[] = []
): CapturePayload {
  return compactJsonObject({
    mode: readGetter(subscription, "getMode") ?? toJsonValue(constructorArgs[0]),
    items: readGetter(subscription, "getItems") ?? toJsonValue(constructorArgs[1]),
    itemGroup: readGetter(subscription, "getItemGroup"),
    fields: readGetter(subscription, "getFields") ?? toJsonValue(constructorArgs[2]),
    fieldSchema: readGetter(subscription, "getFieldSchema"),
    dataAdapter: readGetter(subscription, "getDataAdapter"),
    requestedSnapshot: readGetter(subscription, "getRequestedSnapshot"),
    keyPosition: readGetter(subscription, "getKeyPosition"),
    commandPosition: readGetter(subscription, "getCommandPosition")
  });
}

function readGetter(target: object, name: string) {
  const getter = (target as Record<string, unknown>)[name];
  if (typeof getter !== "function") {
    return undefined;
  }

  try {
    return toJsonValue(getter.call(target));
  } catch (error) {
    return `getter-error:${error instanceof Error ? error.message : "unknown"}`;
  }
}

function toJsonValue(value: unknown): CapturePayload[string] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }

  if (isObject(value)) {
    return compactJsonObject(value);
  }

  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return null;
  }

  return String(value);
}

function compactJsonObject(source: Record<string, unknown>): CapturePayload {
  const result: CapturePayload = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      result[key] = toJsonValue(value);
    }
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

if (typeof window !== "undefined") {
  installLightstreamerInstrumentation(window);
}
