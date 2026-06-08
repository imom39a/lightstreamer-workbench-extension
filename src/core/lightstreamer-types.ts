export type Constructor<T> = new (...args: never[]) => T;

export type LightstreamerClientLike = {
  connect?: (...args: unknown[]) => unknown;
  disconnect?: (...args: unknown[]) => unknown;
  subscribe?: (...args: unknown[]) => unknown;
  unsubscribe?: (...args: unknown[]) => unknown;
  addListener?: (...args: unknown[]) => unknown;
  removeListener?: (...args: unknown[]) => unknown;
  getStatus?: () => unknown;
  getSubscriptions?: () => unknown;
};

export type LightstreamerSubscriptionLike = {
  addListener?: (...args: unknown[]) => unknown;
  removeListener?: (...args: unknown[]) => unknown;
  getMode?: () => unknown;
  getItems?: () => unknown;
  getItemGroup?: () => unknown;
  getFields?: () => unknown;
  getFieldSchema?: () => unknown;
  getDataAdapter?: () => unknown;
  getRequestedSnapshot?: () => unknown;
  getKeyPosition?: () => unknown;
  getCommandPosition?: () => unknown;
};

export type LightstreamerListenerLike = Record<string, unknown>;

export type LightstreamerHost = {
  LightstreamerClient?: Constructor<LightstreamerClientLike>;
  Subscription?: Constructor<LightstreamerSubscriptionLike>;
  Lightstreamer?: {
    LightstreamerClient?: Constructor<LightstreamerClientLike>;
    Subscription?: Constructor<LightstreamerSubscriptionLike>;
  };
  WebSocket?: typeof WebSocket;
  postMessage?: (message: unknown, targetOrigin: string) => void;
  addEventListener?: (type: "message", listener: (event: MessageEvent) => void) => void;
  __LSEW_INSTRUMENTED__?: boolean;
  __LSEW_PRIMARY_ACTIVE__?: boolean;
  __LSEW_WS_FALLBACK__?: boolean;
};
