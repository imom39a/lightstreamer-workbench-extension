import { type CaptureKind, type JsonObject } from "../bridge/messages";

export type EventDirection = "inbound" | "outbound";
export type EventSource = "server" | "synthetic";
export type EventCaptureSource = "listener" | "wire";

export type EventClient = {
  id: string;
  status?: string;
  serverAddress?: string | null;
  adapterSet?: string | null;
};

export type EventSubscription = {
  id: string;
  mode?: string | null;
  items?: string[];
  itemGroup?: string | null;
  fields?: string[];
  fieldSchema?: string | null;
  dataAdapter?: string | null;
  requestedSnapshot?: string | boolean | null;
  keyPosition?: number | string | null;
  commandPosition?: number | string | null;
};

export type EventListener = {
  id: string;
};

export type EventItem = {
  name?: string | null;
  position?: number | null;
};

export type EventUpdate = {
  isSnapshot?: boolean;
  fields?: Record<string, string | number | boolean | null>;
  changedFields?: Record<string, string | number | boolean | null>;
  jsonPatches?: Record<string, unknown>;
  command?: string | null;
  key?: string | null;
};

export type LightstreamerEventEnvelope = {
  id: string;
  timestamp: number;
  direction: EventDirection;
  source: EventSource;
  captureSource?: EventCaptureSource;
  synthetic: boolean;
  kind: CaptureKind;
  client?: EventClient;
  subscription?: EventSubscription;
  listener?: EventListener;
  item?: EventItem;
  update?: EventUpdate;
  raw?: JsonObject;
};
