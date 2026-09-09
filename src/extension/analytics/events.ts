/** Closed vocabulary. Never pass a Capture, Draft, command, or Error to transport. */
const enumValues = <const T extends readonly string[]>(...values: T) => values;
export const ANALYTICS_SCREENS = enumValues("evidence", "context", "raw_evidence", "session_operations", "export", "local_injection", "server_injection", "scenario", "notifications");
const injectionTypes = enumValues("local", "server");
const featureActions = enumValues("open", "select", "apply", "reset", "next", "previous", "older", "newer", "oldest", "newest", "freeze", "follow", "back", "forward", "prepare", "cancel", "clear", "compare", "park", "resume", "discard", "repeat", "recipe", "inspect", "dismiss", "dark", "light", "auto");
const schemas = {
  panel_opened: {},
  panel_closed: {},
  panel_engagement: {},
  page_view: { screen: ANALYTICS_SCREENS },
  capture_ready: { coverage: enumValues("USEFUL", "LIMITED", "UNAVAILABLE"), storage_mode: enumValues("indexeddb", "memory") },
  extension_problem: { problem: enumValues("no_activity", "bridge_disconnected", "coverage_limited", "coverage_unavailable", "storage_fallback", "query_failed", "history_failed", "panel_error", "unhandled_rejection") },
  feature_used: {
    feature: enumValues("scope", "evidence", "find", "filter", "context", "raw_evidence", "export", "clipboard", "history", "local_injection", "server_injection", "notifications", "activity", "theme", "documentation", "privacy", "support"),
    action: featureActions
  },
  injection_started: { injection_type: injectionTypes, source_kind: enumValues("captured", "authored") },
  injection_attempted: { injection_type: injectionTypes },
  injection_result: { injection_type: injectionTypes, outcome: enumValues("delivered", "blocked", "failed", "partial", "acknowledgement-unknown", "processed", "denied", "discarded", "aborted", "unknown", "stale-target", "bridge-error") },
  scenario_action: { action: enumValues("create", "review", "play", "pause", "stop", "step", "run_again", "add_step", "checkpoint") },
  scenario_result: { outcome: enumValues("complete", "stopped") },
  filter_result: { outcome: enumValues("applied", "empty", "invalid", "stale", "failed") },
  find_result: { result: enumValues("none", "one", "many") },
  export_result: { format: enumValues("json", "html", "clipboard", "raw", "scope"), outcome: enumValues("success", "failed", "unavailable", "cancelled", "refused") }
} as const;

export type AnalyticsEventName = keyof typeof schemas;
type Parameters<N extends AnalyticsEventName> = { [K in keyof typeof schemas[N]]: typeof schemas[N][K] extends readonly string[] ? typeof schemas[N][K][number] : never };
export type AnalyticsEvent = { [N in AnalyticsEventName]: Readonly<{ name: N; params: Parameters<N>; engagement_time_msec?: number }> }[AnalyticsEventName];
export type AnalyticsScreen = typeof ANALYTICS_SCREENS[number];
export type AnalyticsTrack = (event: AnalyticsEvent) => void;

/** Synthetic vocabulary samples for the maintainer's Measurement Protocol validator. */
export function analyticsValidationEvents(): readonly AnalyticsEvent[] {
  return Object.entries(schemas).map(([name, parameters]) => ({ name, params: Object.fromEntries(Object.entries(parameters).map(([key, values]) => [key, values[0]])), engagement_time_msec: 100 })) as AnalyticsEvent[];
}

/** Reconstruct from allowlisted primitives at both ends of the extension bridge. */
export function sanitizeAnalyticsEvent(input: unknown): AnalyticsEvent | null {
  if (!isRecord(input) || typeof input.name !== "string" || !Object.hasOwn(schemas, input.name)) return null;
  if (Object.keys(input).some(key => !["name", "params", "engagement_time_msec"].includes(key)) || !isRecord(input.params)) return null;
  const schema = schemas[input.name as AnalyticsEventName] as Record<string, readonly string[]>;
  if (Object.keys(input.params).length !== Object.keys(schema).length) return null;
  const params: Record<string, string> = {};
  for (const [key, values] of Object.entries(schema)) {
    const value = input.params[key];
    if (typeof value !== "string" || !values.includes(value)) return null;
    params[key] = value;
  }
  const engagement = input.engagement_time_msec;
  if (engagement !== undefined && (typeof engagement !== "number" || !Number.isInteger(engagement) || engagement < 0 || engagement > 60_000)) return null;
  return { name: input.name, params, ...(engagement === undefined ? {} : { engagement_time_msec: engagement }) } as AnalyticsEvent;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const ANALYTICS_MESSAGE = "lsew:usage-analytics:v1";
export const ANALYTICS_PREFERENCE_KEY = "lsew.usage.enabled.v1";
export const ANALYTICS_CLIENT_KEY = "lsew.usage.client.v1";
export const ANALYTICS_SESSION_KEY = "lsew.usage.session.v1";
