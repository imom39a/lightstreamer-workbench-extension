import { type EventItem, type EventSubscription, type LightstreamerEventEnvelope } from "./event-envelope";

export type CommandFieldValue = string | number | boolean | null;
export type CommandFields = Record<string, CommandFieldValue>;

export type CommandLifecycleCommand = "ADD" | "UPDATE" | "DELETE";

export type CommandDiagnosticCode =
  | "missing-command"
  | "missing-key"
  | "unsupported-command"
  | "unknown-key-delete"
  | "unknown-key-update"
  | "snapshot-update"
  | "snapshot-delete";

export type CommandDiagnosticSeverity = "error" | "warning";

export type CommandDiagnostic = {
  severity: CommandDiagnosticSeverity;
  code: CommandDiagnosticCode;
  eventId?: string;
  field?: "command" | "key";
  key?: string;
  command?: string | null;
  serverLikeMessage?: string;
  explanation: string;
  suggestion: string;
};

export type CommandProvenanceLabel = "snapshot" | "live" | "synthetic-live" | "synthetic-snapshot";

export type CommandProvenance = {
  label: CommandProvenanceLabel;
  eventId: string;
  timestamp: number;
  source: LightstreamerEventEnvelope["source"];
  synthetic: boolean;
  isSnapshot: boolean;
};

export type CommandLifecycleEntry = {
  eventId: string;
  timestamp: number;
  key: string;
  originalCommand: string | null;
  effectiveCommand: CommandLifecycleCommand | null;
  isSnapshot: boolean;
  provenance: CommandProvenance;
  fields: CommandFields;
  changedFields: CommandFields;
  diagnosticCodes: CommandDiagnosticCode[];
};

export type CommandRow = {
  subscriptionId: string;
  itemId: string;
  itemName: string | null;
  itemPosition: number | null;
  key: string;
  status: "active";
  fields: CommandFields;
  origin: CommandProvenance;
  latest: CommandProvenance;
  lifecycle: CommandLifecycleEntry[];
};

export type DeletedCommandKey = {
  subscriptionId: string;
  itemId: string;
  itemName: string | null;
  itemPosition: number | null;
  key: string;
  status: "deleted";
  deletedAt: CommandProvenance;
  lifecycle: CommandLifecycleEntry[];
};

export type CommandItemGroup = {
  subscriptionId: string;
  itemId: string;
  itemName: string | null;
  itemPosition: number | null;
  activeRows: CommandRow[];
  deletedKeys: DeletedCommandKey[];
  lifecycle: CommandLifecycleEntry[];
  diagnostics: CommandDiagnostic[];
};

export type CommandSubscriptionGroup = {
  subscriptionId: string;
  mode: string | null;
  subscription: EventSubscription;
  items: CommandItemGroup[];
  diagnostics: CommandDiagnostic[];
};

export type CommandState = {
  subscriptions: CommandSubscriptionGroup[];
  diagnostics: CommandDiagnostic[];
};

export type CommandItemIdentity = {
  itemId: string;
  itemName: string | null;
  itemPosition: number | null;
};

export type CommandDraftLike = {
  command?: string | null;
  key?: string | null;
  isSnapshot?: boolean;
};

export type CommandDraftContext = {
  subscriptionId: string;
  itemName?: string | null;
  itemPosition?: number | null;
};

export type CommandDraftValidationResult = {
  valid: boolean;
  diagnostics: CommandDiagnostic[];
};

type MutableCommandRow = Omit<CommandRow, "status" | "lifecycle"> & {
  status: "active";
  lifecycle: CommandLifecycleEntry[];
};

type MutableDeletedCommandKey = Omit<DeletedCommandKey, "status" | "lifecycle"> & {
  status: "deleted";
  lifecycle: CommandLifecycleEntry[];
};

type ItemAccumulator = {
  subscriptionId: string;
  itemId: string;
  itemName: string | null;
  itemPosition: number | null;
  activeRows: Map<string, MutableCommandRow>;
  deletedKeys: Map<string, MutableDeletedCommandKey>;
  lifecycleByKey: Map<string, CommandLifecycleEntry[]>;
  lifecycle: CommandLifecycleEntry[];
  diagnostics: CommandDiagnostic[];
};

type SubscriptionAccumulator = {
  subscriptionId: string;
  mode: string | null;
  subscription: EventSubscription;
  items: Map<string, ItemAccumulator>;
  diagnostics: CommandDiagnostic[];
};

const SUPPORTED_COMMANDS = new Set<CommandLifecycleCommand>(["ADD", "UPDATE", "DELETE"]);

export function reduceCommandState(events: readonly LightstreamerEventEnvelope[]): CommandState {
  const subscriptions = new Map<string, SubscriptionAccumulator>();
  const knownSubscriptions = new Map<string, EventSubscription>();
  const diagnostics: CommandDiagnostic[] = [];

  for (const event of events) {
    const subscription = subscriptionForEvent(event, knownSubscriptions);
    if (event.kind !== "item-update" || subscription?.mode !== "COMMAND") {
      continue;
    }

    const commandEvent = { ...event, subscription };
    const subscriptionAccumulator = getSubscriptionAccumulator(subscriptions, commandEvent);
    const item = getItemAccumulator(
      subscriptionAccumulator,
      resolveCommandItemIdentity(commandEvent.subscription, commandEvent.item)
    );
    const command = normalizeCommand(commandValue(commandEvent));
    const key = stringOrNull(commandEvent.update?.key ?? commandEvent.update?.fields?.key);
    const isSnapshot = Boolean(commandEvent.update?.isSnapshot);
    const eventDiagnostics: CommandDiagnostic[] = [];

    if (!command) {
      eventDiagnostics.push(createMissingCommandDiagnostic(commandEvent, key));
    } else if (!isSupportedCommand(command)) {
      eventDiagnostics.push(createUnsupportedCommandDiagnostic(commandEvent, command, key));
    }

    if (!key) {
      eventDiagnostics.push(createMissingKeyDiagnostic(commandEvent, command));
    }

    if (command === "UPDATE" && isSnapshot) {
      eventDiagnostics.push(createSnapshotUpdateDiagnostic(commandEvent, key));
    }

    if (command === "DELETE" && isSnapshot) {
      eventDiagnostics.push(createSnapshotDeleteDiagnostic(commandEvent, key));
    }

    if (hasBlockingDiagnostic(eventDiagnostics) || !key || !command || !isSupportedCommand(command)) {
      recordDiagnostics(diagnostics, subscriptionAccumulator, item, eventDiagnostics);
      continue;
    }

    if (command === "UPDATE" && isSnapshot) {
      recordDiagnostics(diagnostics, subscriptionAccumulator, item, eventDiagnostics);
      continue;
    }

    const existing = item.activeRows.get(key);
    let effectiveCommand: CommandLifecycleCommand = command;

    if (command === "DELETE" && isSnapshot && !existing) {
      recordDiagnostics(diagnostics, subscriptionAccumulator, item, eventDiagnostics);
      continue;
    }

    if (command === "UPDATE" && !existing) {
      const diagnostic = createUnknownKeyUpdateDiagnostic(commandEvent, key);
      eventDiagnostics.push(diagnostic);
      effectiveCommand = "ADD";
    }

    if (command === "DELETE" && !existing) {
      const diagnostic = createUnknownKeyDeleteDiagnostic(commandEvent, key);
      eventDiagnostics.push(diagnostic);
      recordDiagnostics(diagnostics, subscriptionAccumulator, item, eventDiagnostics);
      continue;
    }

    const provenance = createProvenance(commandEvent);
    const lifecycleEntry: CommandLifecycleEntry = {
      eventId: commandEvent.id,
      timestamp: commandEvent.timestamp,
      key,
      originalCommand: command,
      effectiveCommand,
      isSnapshot,
      provenance,
      fields: cloneFields(commandEvent.update?.fields),
      changedFields: cloneFields(commandEvent.update?.changedFields),
      diagnosticCodes: eventDiagnostics.map((diagnostic) => diagnostic.code)
    };

    appendLifecycle(item, key, lifecycleEntry);

    if (effectiveCommand === "DELETE") {
      item.activeRows.delete(key);
      item.deletedKeys.set(key, {
        subscriptionId: subscriptionAccumulator.subscriptionId,
        itemId: item.itemId,
        itemName: item.itemName,
        itemPosition: item.itemPosition,
        key,
        status: "deleted",
        deletedAt: provenance,
        lifecycle: [...(item.lifecycleByKey.get(key) ?? [])]
      });
    } else {
      const origin = existing?.origin ?? provenance;
      item.activeRows.set(key, {
        subscriptionId: subscriptionAccumulator.subscriptionId,
        itemId: item.itemId,
        itemName: item.itemName,
        itemPosition: item.itemPosition,
        key,
        status: "active",
        fields: cloneFields(commandEvent.update?.fields),
        origin,
        latest: provenance,
        lifecycle: [...(item.lifecycleByKey.get(key) ?? [])]
      });
      item.deletedKeys.delete(key);
    }

    recordDiagnostics(diagnostics, subscriptionAccumulator, item, eventDiagnostics);
  }

  return {
    subscriptions: Array.from(subscriptions.values()).map(toSubscriptionGroup),
    diagnostics
  };
}

export function validateCommandDraftAgainstState(
  draft: CommandDraftLike | null,
  state: CommandState,
  context: CommandDraftContext
): CommandDraftValidationResult {
  const diagnostics: CommandDiagnostic[] = [];
  const command = normalizeCommand(draft?.command);
  const key = stringOrNull(draft?.key);
  const syntheticEvent = validationEvent(draft, context);

  if (!command) {
    diagnostics.push(createMissingCommandDiagnostic(syntheticEvent, key));
  } else if (!isSupportedCommand(command)) {
    diagnostics.push(createUnsupportedCommandDiagnostic(syntheticEvent, command, key));
  }

  if (!key) {
    diagnostics.push(createMissingKeyDiagnostic(syntheticEvent, command));
  }

  if (command === "UPDATE" && draft?.isSnapshot) {
    diagnostics.push(createSnapshotUpdateDiagnostic(syntheticEvent, key));
  }

  if (command === "DELETE" && draft?.isSnapshot) {
    diagnostics.push(createSnapshotDeleteDiagnostic(syntheticEvent, key));
  }

  if (key && command === "UPDATE" && !findActiveRow(state, context, key)) {
    diagnostics.push(createUnknownKeyUpdateDiagnostic(syntheticEvent, key));
  }

  if (key && command === "DELETE" && !findActiveRow(state, context, key)) {
    diagnostics.push(createUnknownKeyDeleteDiagnostic(syntheticEvent, key));
  }

  return {
    valid: !hasBlockingDiagnostic(diagnostics),
    diagnostics
  };
}

export function resolveCommandItemIdentity(
  subscription: EventSubscription | undefined,
  item: EventItem | undefined
): CommandItemIdentity {
  const itemPosition = item?.position ?? null;
  const explicitItemName = stringOrNull(item?.name);
  const listedItemName = itemNameFromSubscriptionItems(subscription, itemPosition);
  const itemGroup = stringOrNull(subscription?.itemGroup);
  const itemName = explicitItemName ?? listedItemName ?? itemGroup;
  const itemId =
    explicitItemName || listedItemName
      ? itemIdentity(itemName, itemPosition)
      : itemGroupIdentity(itemGroup, itemPosition);

  return {
    itemId,
    itemName,
    itemPosition
  };
}

function subscriptionForEvent(
  event: LightstreamerEventEnvelope,
  knownSubscriptions: Map<string, EventSubscription>
): EventSubscription | undefined {
  const current = event.subscription;
  if (!current?.id) {
    return undefined;
  }

  const merged = mergeSubscriptionMetadata(knownSubscriptions.get(current.id), current);
  knownSubscriptions.set(current.id, merged);
  return merged;
}

function mergeSubscriptionMetadata(
  known: EventSubscription | undefined,
  current: EventSubscription
): EventSubscription {
  return {
    id: current.id,
    mode: current.mode ?? known?.mode,
    items: copyArray(current.items ?? known?.items),
    itemGroup: current.itemGroup ?? known?.itemGroup,
    fields: copyArray(current.fields ?? known?.fields),
    fieldSchema: current.fieldSchema ?? known?.fieldSchema,
    dataAdapter: current.dataAdapter ?? known?.dataAdapter,
    requestedSnapshot: current.requestedSnapshot ?? known?.requestedSnapshot,
    keyPosition: current.keyPosition ?? known?.keyPosition,
    commandPosition: current.commandPosition ?? known?.commandPosition
  };
}

function copyArray(value: string[] | undefined): string[] | undefined {
  return value ? [...value] : undefined;
}

function getSubscriptionAccumulator(
  subscriptions: Map<string, SubscriptionAccumulator>,
  event: LightstreamerEventEnvelope
): SubscriptionAccumulator {
  const subscriptionId = event.subscription?.id ?? "unknown-subscription";
  const existing = subscriptions.get(subscriptionId);
  if (existing) {
    const merged = event.subscription
      ? mergeSubscriptionMetadata(existing.subscription, event.subscription)
      : existing.subscription;
    existing.subscription = merged;
    existing.mode = merged.mode ?? existing.mode;
    return existing;
  }

  const subscription: EventSubscription = event.subscription ?? { id: subscriptionId, mode: null };
  const created: SubscriptionAccumulator = {
    subscriptionId,
    mode: subscription.mode ?? null,
    subscription,
    items: new Map(),
    diagnostics: []
  };
  subscriptions.set(subscriptionId, created);
  return created;
}

function getItemAccumulator(
  subscription: SubscriptionAccumulator,
  identity: CommandItemIdentity
): ItemAccumulator {
  const { itemId, itemName, itemPosition } = identity;
  const existing = subscription.items.get(itemId);
  if (existing) {
    return existing;
  }

  const created: ItemAccumulator = {
    subscriptionId: subscription.subscriptionId,
    itemId,
    itemName,
    itemPosition,
    activeRows: new Map(),
    deletedKeys: new Map(),
    lifecycleByKey: new Map(),
    lifecycle: [],
    diagnostics: []
  };
  subscription.items.set(itemId, created);
  return created;
}

function toSubscriptionGroup(subscription: SubscriptionAccumulator): CommandSubscriptionGroup {
  return {
    subscriptionId: subscription.subscriptionId,
    mode: subscription.mode,
    subscription: { ...subscription.subscription },
    items: Array.from(subscription.items.values()).map(toItemGroup),
    diagnostics: [...subscription.diagnostics]
  };
}

function toItemGroup(item: ItemAccumulator): CommandItemGroup {
  return {
    subscriptionId: item.subscriptionId,
    itemId: item.itemId,
    itemName: item.itemName,
    itemPosition: item.itemPosition,
    activeRows: Array.from(item.activeRows.values()).map((row) => ({
      ...row,
      fields: { ...row.fields },
      lifecycle: row.lifecycle.map(cloneLifecycleEntry)
    })),
    deletedKeys: Array.from(item.deletedKeys.values()).map((deleted) => ({
      ...deleted,
      lifecycle: deleted.lifecycle.map(cloneLifecycleEntry)
    })),
    lifecycle: item.lifecycle.map(cloneLifecycleEntry),
    diagnostics: [...item.diagnostics]
  };
}

function appendLifecycle(item: ItemAccumulator, key: string, entry: CommandLifecycleEntry): void {
  const lifecycle = item.lifecycleByKey.get(key) ?? [];
  lifecycle.push(entry);
  item.lifecycleByKey.set(key, lifecycle);
  item.lifecycle.push(entry);
}

function recordDiagnostics(
  stateDiagnostics: CommandDiagnostic[],
  subscription: SubscriptionAccumulator,
  item: ItemAccumulator,
  eventDiagnostics: readonly CommandDiagnostic[]
): void {
  if (eventDiagnostics.length === 0) {
    return;
  }
  stateDiagnostics.push(...eventDiagnostics);
  subscription.diagnostics.push(...eventDiagnostics);
  item.diagnostics.push(...eventDiagnostics);
}

function hasBlockingDiagnostic(diagnostics: readonly CommandDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function commandValue(event: LightstreamerEventEnvelope): string | number | boolean | null | undefined {
  return event.update?.command ?? event.update?.fields?.command;
}

function normalizeCommand(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
}

function stringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function itemNameFromSubscriptionItems(
  subscription: EventSubscription | undefined,
  itemPosition: number | null
): string | null {
  if (itemPosition === null) {
    return null;
  }
  return stringOrNull(subscription?.items?.[itemPosition - 1]);
}

function isSupportedCommand(command: string): command is CommandLifecycleCommand {
  return SUPPORTED_COMMANDS.has(command as CommandLifecycleCommand);
}

function cloneFields(fields: CommandFields | undefined): CommandFields {
  return fields ? { ...fields } : {};
}

function cloneLifecycleEntry(entry: CommandLifecycleEntry): CommandLifecycleEntry {
  return {
    ...entry,
    fields: { ...entry.fields },
    changedFields: { ...entry.changedFields },
    diagnosticCodes: [...entry.diagnosticCodes]
  };
}

function itemIdentity(itemName: string | null, itemPosition: number | null): string {
  if (itemName) {
    return `name:${itemName}`;
  }
  if (itemPosition !== null) {
    return `position:${itemPosition}`;
  }
  return "unknown-item";
}

function itemGroupIdentity(itemGroup: string | null, itemPosition: number | null): string {
  if (itemGroup && itemPosition !== null) {
    return `group:${itemGroup}:position:${itemPosition}`;
  }
  return itemIdentity(itemGroup, itemPosition);
}

function createProvenance(event: LightstreamerEventEnvelope): CommandProvenance {
  const isSnapshot = Boolean(event.update?.isSnapshot);
  const synthetic = event.synthetic || event.source === "synthetic";
  return {
    label: synthetic ? (isSnapshot ? "synthetic-snapshot" : "synthetic-live") : isSnapshot ? "snapshot" : "live",
    eventId: event.id,
    timestamp: event.timestamp,
    source: event.source,
    synthetic,
    isSnapshot
  };
}

function createMissingCommandDiagnostic(event: LightstreamerEventEnvelope, key: string | null): CommandDiagnostic {
  return {
    severity: "error",
    code: "missing-command",
    eventId: event.id,
    field: "command",
    key: key ?? undefined,
    serverLikeMessage: `Missing mandatory parameter in command event for key ${key ?? "null"}`,
    explanation: "COMMAND mode updates must include a command value so the keyed row can be added, updated, or deleted.",
    suggestion: "Set command to ADD, UPDATE, or DELETE before reducing or injecting this update."
  };
}

function createMissingKeyDiagnostic(
  event: LightstreamerEventEnvelope,
  command: string | null
): CommandDiagnostic {
  return {
    severity: "error",
    code: "missing-key",
    eventId: event.id,
    field: "key",
    command,
    serverLikeMessage: "Missing mandatory parameter in command event for key null",
    explanation: "COMMAND mode updates must include a key value so the update can target one table row.",
    suggestion: "Set the COMMAND key to the row identifier expected by this subscription."
  };
}

function createUnsupportedCommandDiagnostic(
  event: LightstreamerEventEnvelope,
  command: string,
  key: string | null
): CommandDiagnostic {
  return {
    severity: "error",
    code: "unsupported-command",
    eventId: event.id,
    command,
    key: key ?? undefined,
    explanation: `Unsupported COMMAND value "${command}" cannot be applied to Lightstreamer COMMAND state.`,
    suggestion: "Use ADD, UPDATE, or DELETE."
  };
}

function createUnknownKeyDeleteDiagnostic(event: LightstreamerEventEnvelope, key: string): CommandDiagnostic {
  return {
    severity: "warning",
    code: "unknown-key-delete",
    eventId: event.id,
    key,
    command: "DELETE",
    serverLikeMessage: `Unexpected DELETE event for key ${key}; event discarded`,
    explanation: "A DELETE for a missing key does not remove any current COMMAND row.",
    suggestion: "Check whether the key was already deleted, filtered out, or should have been added before DELETE."
  };
}

function createUnknownKeyUpdateDiagnostic(event: LightstreamerEventEnvelope, key: string): CommandDiagnostic {
  return {
    severity: "warning",
    code: "unknown-key-update",
    eventId: event.id,
    key,
    command: "UPDATE",
    serverLikeMessage: `Unexpected UPDATE event for key ${key}; update propagated as ADD`,
    explanation: "An UPDATE for a missing key is treated with effective ADD semantics after it appears in captured history.",
    suggestion: "Use ADD when intentionally creating a new key, or verify why the prior ADD is absent."
  };
}

function createSnapshotUpdateDiagnostic(event: LightstreamerEventEnvelope, key: string | null): CommandDiagnostic {
  return {
    severity: "warning",
    code: "snapshot-update",
    eventId: event.id,
    key: key ?? undefined,
    command: "UPDATE",
    serverLikeMessage: key ? `Illegal UPDATE command in snapshot ignored for key ${key}` : undefined,
    explanation: "COMMAND snapshots represent current table state as ADD rows; UPDATE inside a snapshot is inconsistent.",
    suggestion: "Use ADD for snapshot rows, or send UPDATE only after the snapshot phase."
  };
}

function createSnapshotDeleteDiagnostic(event: LightstreamerEventEnvelope, key: string | null): CommandDiagnostic {
  return {
    severity: "warning",
    code: "snapshot-delete",
    eventId: event.id,
    key: key ?? undefined,
    command: "DELETE",
    explanation: "COMMAND snapshots should not be used as raw delete history; they are current-state rows.",
    suggestion: "Use ADD rows for snapshot state and use DELETE in live updates when a key is removed."
  };
}

function validationEvent(
  draft: CommandDraftLike | null,
  context: CommandDraftContext
): LightstreamerEventEnvelope {
  return {
    id: "draft",
    timestamp: 0,
    direction: "inbound",
    source: "synthetic",
    synthetic: true,
    kind: "item-update",
    subscription: { id: context.subscriptionId, mode: "COMMAND" },
    item: { name: context.itemName ?? null, position: context.itemPosition ?? null },
    update: {
      isSnapshot: Boolean(draft?.isSnapshot),
      command: draft?.command ?? null,
      key: draft?.key ?? null
    }
  };
}

function findActiveRow(state: CommandState, context: CommandDraftContext, key: string): CommandRow | null {
  const subscription = state.subscriptions.find((group) => group.subscriptionId === context.subscriptionId);
  if (!subscription) {
    return null;
  }

  const itemId = itemIdentity(context.itemName ?? null, context.itemPosition ?? null);
  const item =
    subscription.items.find((group) => group.itemId === itemId) ??
    subscription.items.find((group) => group.itemName === context.itemName && group.itemPosition === context.itemPosition);

  return item?.activeRows.find((row) => row.key === key) ?? null;
}
