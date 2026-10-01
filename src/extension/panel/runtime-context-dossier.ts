import type { TopologySelectionTarget } from "./topology-view-model";
import type { WorkbenchContextSnapshot, WorkbenchSnapshot } from "./workbench-runtime";

/** Presents one selected runtime object; History ownership stays in the runtime. */
export function runtimeObjectDossier(
  target: TopologySelectionTarget | null,
  title: string,
  topologyCoverage: WorkbenchSnapshot["scope"]["coverage"]
): WorkbenchContextSnapshot {
  const fields: Array<readonly [string, string]> = [];
  const add = (name: string, value: unknown): void => {
    fields.push(Object.freeze([name, dossierValue(value)] as const));
  };

  if (!target) {
    add("Scope type", "Unknown");
    add("Identity", "Unknown");
  } else {
    switch (target.kind) {
      case "page":
        add("Scope type", "Page");
        add("Clients", target.state.clientCount);
        add("Active sessions", target.state.activeSessionCount);
        add("Historical sessions", target.state.historicalSessionCount);
        add("Subscriptions", target.state.subscriptionCount);
        add("Items", target.state.itemCount);
        add("Listeners", target.state.listenerCount);
        add("Observing since", dossierTimestamp(target.state.observingSince));
        break;
      case "client":
        add("Scope type", "Client");
        add("Client ID", target.client.id);
        add("Status", target.client.status);
        add("Normalized status", target.client.normalizedStatus);
        add("Current Session ID", target.client.sessionId);
        add("Server address", target.client.serverAddress);
        add("Adapter set", target.client.adapterSet);
        add("Library version", target.client.libraryVersion);
        add("Transport", target.client.transport);
        add("Active sessions", target.client.sessions.filter(({ active, historical }) => active && !historical).length);
        add("Historical sessions", target.client.sessions.filter(({ historical }) => historical).length);
        add("Waiting Subscriptions", target.client.waitingSubscriptions.length);
        break;
      case "session":
        add("Scope type", "Session");
        add("Session ID", target.session.id);
        add("Client ID", target.client.id);
        add("Status", target.session.normalizedStatus);
        add("Client status", target.session.status);
        add("Active", yesNo(target.session.active));
        add("Historical", yesNo(target.session.historical));
        add("Transport", target.session.transport);
        add("Subscriptions", target.session.subscriptions.length);
        add("Connection epochs", target.session.connectionEpochCount);
        add("Recoveries", target.session.recoveryCount);
        break;
      case "subscription":
        addSubscriptionDossier(fields, target);
        break;
      case "item":
        add("Scope type", "Item");
        add("Item name", target.item.name);
        add("Position", target.item.position);
        add("Resolution", target.item.resolution);
        add("Subscription ID", target.subscription.id);
        add("Client ID", target.client?.id);
        add("Session ID", target.session?.id);
        add("Historical", yesNo(target.subscription.historical));
        add("Snapshot phase", target.item.snapshotPhase);
        add("Updates", target.item.updateCount);
        add("Synthetic updates", target.item.syntheticUpdateCount);
        add("Deliveries", target.item.deliveryCount);
        add("Lost updates", target.item.lostUpdateCount);
        add("Listeners", target.item.listenerIds.length);
        add("Last COMMAND operation", target.item.lastCommand);
        add("Active COMMAND keys", target.item.activeCommandKeyCount);
        add("Deleted COMMAND keys", target.item.deletedCommandKeysHasOlder
          ? `${target.item.deletedCommandKeyCount} retained (older identities not retained)`
          : target.item.deletedCommandKeyCount);
        break;
      case "listener":
        add("Scope type", "Listener");
        add("Listener ID", target.listener.id);
        add("Subscription ID", target.subscription.id);
        add("Item", target.item?.name);
        add("Client ID", target.client?.id);
        add("Session ID", target.session?.id);
        add("Active", yesNo(target.listener.active));
        add("Callbacks", dossierList(target.listener.callbacks));
        add("Registration count", target.listener.registrationCount);
        add("Metric owner", yesNo(target.listener.metricOwner));
        add("Deliveries", target.listener.deliveryCount);
        add("First delivery", dossierTimestamp(target.listener.firstDeliveryAt));
        add("Last delivery", dossierTimestamp(target.listener.lastDeliveryAt));
        break;
      case "generation":
      case "inferred-child":
        // COMMAND generations are Evidence attached to structural Scope, never Scope peers.
        add("Scope type", "Unknown");
        add("Identity", "Unknown");
        break;
    }
  }

  add(
    "Topology coverage",
    `${topologyCoverage.semantic ? "Semantic" : "Legacy"} · ${topologyCoverage.status}`
  );
  const settings = new Set(["Server address", "Adapter set", "Library version", "Transport", "Requested snapshot", "Requested buffer size", "Requested max frequency", "Real max frequency", "Data Adapter", "Selector", "Callbacks"]);
  const counters = new Set(["Active sessions", "Historical sessions", "Waiting Subscriptions", "Subscriptions", "Connection epochs", "Recoveries", "Items", "Listeners", "Updates", "Synthetic updates", "Deliveries", "Lost updates", "COMMAND generations", "Registration count", "Metric owner", "First delivery", "Last delivery", "Active COMMAND keys", "Deleted COMMAND keys"]);
  const metadata = new Set(["Topology coverage", "Observing since"]);
  const groups: Array<Readonly<{ title: string; fields: readonly (readonly [string, string])[] }>> = [];
  const secondary = target?.kind !== "page";
  for (const [title, names] of [["Settings", settings], ["Counters", counters], ["Metadata", metadata]] as const) {
    const grouped = fields.filter(([name]) => names.has(name) && (secondary || title === "Metadata"));
    if (grouped.length) groups.push(Object.freeze({ title, fields: Object.freeze(grouped) }));
  }
  const primary = fields.filter(([name]) => !metadata.has(name) && !(secondary && (settings.has(name) || counters.has(name))));
  if (!topologyCoverage.semantic || topologyCoverage.status === "LIMITED") {
    primary.push(Object.freeze(["Topology limitation", topologyCoverage.detail] as const));
  }

  return Object.freeze({
    kind: "runtime",
    title,
    fields: Object.freeze(primary),
    groups: Object.freeze(groups),
    selectedUpdate: null,
    filterActions: Object.freeze([])
  });
}

function addSubscriptionDossier(
  fields: Array<readonly [string, string]>,
  target: Extract<TopologySelectionTarget, { kind: "subscription" }>
): void {
  const add = (name: string, value: unknown): void => {
    fields.push(Object.freeze([name, dossierValue(value)] as const));
  };
  const subscription = target.subscription;
  add("Scope type", "Subscription");
  add("Subscription ID", subscription.id);
  add("Client ID", target.client?.id);
  add("Session ID", target.session?.id);
  add("Mode", subscription.mode);
  add("Status", subscription.statusLabel);
  add("Active", yesNo(subscription.active));
  add("Server established", yesNo(subscription.serverEstablished));
  add("Historical", yesNo(subscription.historical));
  add("Configured items", dossierList(subscription.configuredItems));
  add("Fields", dossierList(subscription.fields));
  add("Requested snapshot", subscription.requestedSnapshot);
  add("Requested buffer size", subscription.requestedBufferSize);
  add("Requested max frequency", subscription.requestedMaxFrequency);
  add("Real max frequency", subscription.realMaxFrequency);
  add("Data Adapter", subscription.dataAdapter);
  add("Selector", subscription.selector);
  add("Snapshot phase", dossierSnapshotPhases(subscription.items));
  add("Items", subscription.items.length);
  add("Listeners", subscription.listenerCount);
  add("Updates", subscription.updateCount);
  add("Synthetic updates", subscription.syntheticUpdateCount);
  add("Deliveries", subscription.deliveryCount);
  add("Lost updates", subscription.lostUpdateCount);
  add("COMMAND generations", subscription.commandGenerations.length);
}

function dossierValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Unknown";
  return String(value);
}

function dossierList(values: readonly unknown[] | undefined): string {
  return values && values.length > 0 ? values.map(String).join(", ") : "Unknown";
}

function dossierSnapshotPhases(items: readonly { snapshotPhase: string }[]): string {
  const phases = [...new Set(items.map(({ snapshotPhase }) => snapshotPhase))];
  return phases.length > 0 ? phases.join(", ") : "Unknown";
}

function dossierTimestamp(value: number | null): string {
  return value === null ? "Unknown" : new Date(value).toISOString();
}

function yesNo(value: boolean): "Yes" | "No" {
  return value ? "Yes" : "No";
}
