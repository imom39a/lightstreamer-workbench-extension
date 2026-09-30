import { type EventItem, type EventSubscription, type ItemUpdateFieldValueState, type LightstreamerEventEnvelope } from "./event-envelope";

export type CommandFieldValue = string | number | boolean | null;
export type CommandFields = Record<string, CommandFieldValue>;

export type CommandLifecycleCommand = "ADD" | "UPDATE" | "DELETE";

/**
 * The amount of lifecycle detail intentionally retained in a live projection.
 * Older lifecycle Evidence may remain available through bounded Event History
 * queries, only while its Evidence is retained.
 */
export const COMMAND_RECENT_LIFECYCLE_LIMIT = 32;
/** Global per-projection budgets for auxiliary history; active row values are never evicted. */
export const COMMAND_HISTORICAL_KEY_LIMIT = 2_048;
export const COMMAND_HISTORICAL_KEY_BYTE_LIMIT = 2 * 1024 * 1024;
export const COMMAND_LIFECYCLE_ENTRY_LIMIT = 4_096;
export const COMMAND_LIFECYCLE_BYTE_LIMIT = 8 * 1024 * 1024;
export const COMMAND_DIAGNOSTIC_LIMIT = 512;
export const COMMAND_DIAGNOSTIC_BYTE_LIMIT = 512 * 1024;

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

export type CommandEvidenceIdentity = Readonly<{ intervalId: string; sequence: number; eventId: string; pageId?: string; ownerId?: string }>;

export type CommandProvenance = {
  label: CommandProvenanceLabel;
  eventId: string;
  timestamp: number;
  source: LightstreamerEventEnvelope["source"];
  synthetic: boolean;
  isSnapshot: boolean;
  evidence?: CommandEvidenceIdentity;
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
  fieldValueStates: Record<string, ItemUpdateFieldValueState>;
  fieldProvenance: Record<string, CommandProvenance>;
  origin: CommandProvenance;
  latest: CommandProvenance;
  lifecycle: CommandLifecycleEntry[];
  lifecycleTotal: number;
  lifecycleHasOlder: boolean;
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
  lifecycleTotal: number;
  lifecycleHasOlder: boolean;
};

export type CommandItemGroup = {
  subscriptionId: string;
  itemId: string;
  itemName: string | null;
  itemPosition: number | null;
  activeRows: CommandRow[];
  deletedKeys: DeletedCommandKey[];
  /** Older tombstones were evicted; absence from deletedKeys is not a never-seen claim. */
  deletedKeysHasOlder: boolean;
  lastClearSnapshot: CommandProvenance | null;
  lifecycle: CommandLifecycleEntry[];
  lifecycleTotal: number;
  lifecycleHasOlder: boolean;
  diagnostics: CommandDiagnostic[];
  diagnosticsTotal: number;
  diagnosticsHasOlder: boolean;
};

export type CommandSubscriptionGroup = {
  subscriptionId: string;
  mode: string | null;
  subscription: EventSubscription;
  items: CommandItemGroup[];
  diagnostics: CommandDiagnostic[];
  diagnosticsTotal: number;
  diagnosticsHasOlder: boolean;
};

export type CommandState = {
  subscriptions: CommandSubscriptionGroup[];
  diagnostics: CommandDiagnostic[];
  diagnosticsTotal: number;
  diagnosticsHasOlder: boolean;
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

type MutableCommandRow = Omit<CommandRow, "status" | "lifecycle" | "lifecycleTotal" | "lifecycleHasOlder"> & {
  status: "active";
  fieldCount: number;
  lifecycle: CommandLifecycleEntry[];
  lifecycleTotal: number;
  lifecycleHasOlder: boolean;
};

type MutableDeletedCommandKey = Omit<DeletedCommandKey, "status" | "lifecycle" | "lifecycleTotal" | "lifecycleHasOlder"> & {
  status: "deleted";
  lifecycle: CommandLifecycleEntry[];
  lifecycleTotal: number;
  lifecycleHasOlder: boolean;
};

type BoundedLifecycle = {
  entries: CommandLifecycleEntry[];
  total: number;
};

type ItemAccumulator = {
  subscriptionId: string;
  itemId: string;
  itemName: string | null;
  itemPosition: number | null;
  activeRows: Map<string, MutableCommandRow>;
  deletedKeys: Map<string, MutableDeletedCommandKey>;
  deletedKeysHasOlder: boolean;
  lastClearSnapshot: CommandProvenance | null;
  lifecycleByKey: Map<string, BoundedLifecycle>;
  lifecycle: BoundedLifecycle;
  diagnostics: CommandDiagnostic[];
  diagnosticsTotal: number;
};

type SubscriptionAccumulator = {
  subscriptionId: string;
  mode: string | null;
  subscription: EventSubscription;
  items: Map<string, ItemAccumulator>;
  diagnostics: CommandDiagnostic[];
  diagnosticsTotal: number;
};

type CommandStateAccumulator = {
  subscriptions: Map<string, SubscriptionAccumulator>;
  knownSubscriptions: Map<string, EventSubscription>;
  diagnostics: CommandDiagnostic[];
  diagnosticsTotal: number;
  lifecycleHistory: AuxiliaryHistory<CommandLifecycleEntry>;
  deletedHistory: AuxiliaryHistory<MutableDeletedCommandKey>;
  diagnosticHistory: AuxiliaryHistory<CommandDiagnostic>;
};

type AuxiliaryRecord<T> = { subscriptionId: string; itemId: string; value: T; bytes: number };
type AuxiliaryHistory<T> = { entries: Map<T, AuxiliaryRecord<T>>; bytes: number };

export type CommandStateIndex = {
  apply(event: LightstreamerEventEnvelope, evidence?: CommandEvidenceIdentity): void;
  clear(): void;
  snapshot(): CommandState;
};

export type CommandStateProjection = "observed-server" | "local-effective";

/**
 * Maintains the two COMMAND projections required by Workbench's capture semantics.
 * Captured page events advance both projections; synthetic Local Injected Updates
 * advance only the locally effective projection.
 */
export type CommandStateProjections = {
  apply(event: LightstreamerEventEnvelope, evidence?: CommandEvidenceIdentity): void;
  clear(): void;
  snapshot(projection: CommandStateProjection): CommandState;
  inspect(projection: CommandStateProjection, input: CommandStateInspectionInput): CommandStateInspection;
  /** Direct exact-item/key read; never materializes unrelated rows or subscriptions. */
  readKey(projection: CommandStateProjection, input: CommandStateInspectionInput): CommandKeyStateRead;
};

export type CommandStateInspectionInput = Readonly<{
  subscriptionId: string;
  item: Readonly<{ name: string | null; position: number | null }>;
  key: string;
  field?: string;
}>;

export type CommandKeyStateRead = Readonly<{
  itemFound: boolean;
  row: Readonly<CommandRow> | null;
  deleted: Readonly<DeletedCommandKey> | null;
  fieldsTotal: number;
  lastClearSnapshot: CommandProvenance | null;
  deletedKeysHasOlder: boolean;
  lifecycleHasOlder: boolean;
  diagnosticsHasOlder: boolean;
}>;

export type CommandStateInspection = Readonly<{
  state: "key-present" | "key-absent" | "field-absent" | "concrete" | "ambiguous-server-null" | "redacted" | "unavailable" | "unresolved-wire";
  value?: CommandFieldValue;
  provenance: CommandProvenance | null;
}>;

const AUXILIARY_BYTE_ENCODER = new TextEncoder();
const SUPPORTED_COMMANDS = new Set<CommandLifecycleCommand>(["ADD", "UPDATE", "DELETE"]);
const APPLIED_PROJECTION_EVENT_DEDUP_LIMIT = 4_096;

export function reduceCommandState(events: readonly LightstreamerEventEnvelope[]): CommandState {
  const accumulator = createCommandStateAccumulator();
  for (const event of events) {
    applyCommandEvent(accumulator, event);
  }
  return commandStateFromAccumulator(accumulator);
}

export function createCommandStateIndex(): CommandStateIndex {
  return createCommandStateIndexController().index;
}

type CommandStateIndexController = Readonly<{ index: CommandStateIndex; readKey(input: CommandStateInspectionInput): CommandKeyStateRead }>;

function createCommandStateIndexController(
  initial: CommandStateAccumulator = createCommandStateAccumulator()
): CommandStateIndexController {
  let accumulator = initial;
  let cachedSnapshot: CommandState | null = null;
  const index: CommandStateIndex = {
    apply(event, evidence) {
      applyCommandEvent(accumulator, event, evidence);
      cachedSnapshot = null;
    },

    clear() {
      accumulator = createCommandStateAccumulator();
      cachedSnapshot = null;
    },

    snapshot() {
      cachedSnapshot ??= commandStateFromAccumulator(accumulator);
      return cachedSnapshot;
    }
  };
  return { index, readKey: (input) => readAccumulatorKey(accumulator, input) };
}

export function createCommandStateProjections(): CommandStateProjections {
  const observedServer = createCommandStateIndexController();
  const localEffective = createCommandStateIndexController();
  const appliedEventIds = new Set<string>();

  return {
    apply(event, evidence) {
      if (appliedEventIds.has(event.id)) return;
      appliedEventIds.add(event.id);
      while (appliedEventIds.size > APPLIED_PROJECTION_EVENT_DEDUP_LIMIT) {
        const oldest = appliedEventIds.values().next().value as string | undefined;
        if (oldest === undefined) break;
        appliedEventIds.delete(oldest);
      }
      if (isLocalInjectedEvent(event)) {
        localEffective.index.apply(event, evidence);
      } else {
        observedServer.index.apply(event, evidence);
        localEffective.index.apply(event, evidence);
      }
    },

    clear() {
      observedServer.index.clear();
      localEffective.index.clear();
      appliedEventIds.clear();
    },

    snapshot(projection) {
      return projection === "observed-server"
        ? observedServer.index.snapshot()
        : localEffective.index.snapshot();
    },

    readKey(projection, input) {
      return (projection === "observed-server" ? observedServer : localEffective).readKey(input);
    },

    inspect(projection, input) {
      const state = projection === "observed-server" ? observedServer.index.snapshot() : localEffective.index.snapshot();
      return inspectCommandState(state, input);
    }
  };
}

function isLocalInjectedEvent(event: LightstreamerEventEnvelope): boolean {
  return event.synthetic || event.source === "synthetic";
}

function createCommandStateAccumulator(): CommandStateAccumulator {
  return {
    subscriptions: new Map(),
    knownSubscriptions: new Map(),
    diagnostics: [],
    diagnosticsTotal: 0,
    lifecycleHistory: { entries: new Map(), bytes: 0 },
    deletedHistory: { entries: new Map(), bytes: 0 },
    diagnosticHistory: { entries: new Map(), bytes: 0 }
  };
}

function commandStateFromAccumulator(accumulator: CommandStateAccumulator): CommandState {
  return {
    subscriptions: Array.from(accumulator.subscriptions.values()).map(toSubscriptionGroup),
    diagnostics: [...accumulator.diagnostics],
    diagnosticsTotal: accumulator.diagnosticsTotal,
    diagnosticsHasOlder: accumulator.diagnosticsTotal > accumulator.diagnostics.length
  };
}

function applyCommandEvent(
  accumulator: CommandStateAccumulator,
  event: LightstreamerEventEnvelope,
  evidence?: CommandEvidenceIdentity
): void {
  const subscription = subscriptionForEvent(event, accumulator.knownSubscriptions);
  const subscriptionId = event.subscription?.id;
  if (
    (event.kind === "subscription-ended" || event.kind === "subscription-error") &&
    subscriptionId
  ) {
    releaseSubscriptionAuxiliaryHistory(accumulator, subscriptionId);
    accumulator.subscriptions.delete(subscriptionId);
    accumulator.knownSubscriptions.delete(subscriptionId);
    return;
  }

  if (!subscription || subscription.mode !== "COMMAND") {
    return;
  }

  if (
    event.kind !== "subscription-started" &&
    event.kind !== "subscription-snapshot" &&
    event.kind !== "clear-snapshot" &&
    event.kind !== "item-update"
  ) {
    return;
  }

  const commandEvent = { ...event, subscription };
  const subscriptionAccumulator = getSubscriptionAccumulator(
    accumulator.subscriptions,
    commandEvent
  );
  seedDeclaredSubscriptionItems(subscriptionAccumulator);

  if (event.kind === "subscription-started" || event.kind === "subscription-snapshot") {
    return;
  }

  const item = getItemAccumulator(
    subscriptionAccumulator,
    resolveCommandItemIdentity(commandEvent.subscription, commandEvent.item)
  );
  if (event.kind === "clear-snapshot") {
    for (const deleted of item.deletedKeys.values()) removeAuxiliaryRecord(accumulator.deletedHistory, deleted);
    item.activeRows.clear();
    item.deletedKeys.clear();
    // Clear establishes a fresh empty item basis. Earlier tombstone eviction
    // must not invalidate that basis; item lifecycle history keeps its own limit.
    item.deletedKeysHasOlder = false;
    item.lifecycleByKey.clear();
    item.lastClearSnapshot = Object.freeze(createProvenance(commandEvent, evidence));
    return;
  }
  const command = normalizeCommand(commandValue(commandEvent));
  const key = exactKeyOrNull(commandEvent.update?.key ?? commandEvent.update?.fields?.key);
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
    recordDiagnostics(accumulator, subscriptionAccumulator, item, eventDiagnostics);
    return;
  }

  if (command === "UPDATE" && isSnapshot) {
    recordDiagnostics(accumulator, subscriptionAccumulator, item, eventDiagnostics);
    return;
  }

  const existing = item.activeRows.get(key);
  let effectiveCommand: CommandLifecycleCommand = command;

  if (command === "DELETE" && isSnapshot && !existing) {
    recordDiagnostics(accumulator, subscriptionAccumulator, item, eventDiagnostics);
    return;
  }

  if (command === "UPDATE" && !existing) {
    const diagnostic = createUnknownKeyUpdateDiagnostic(commandEvent, key);
    eventDiagnostics.push(diagnostic);
    effectiveCommand = "ADD";
  }

  if (command === "DELETE" && !existing) {
    const diagnostic = createUnknownKeyDeleteDiagnostic(commandEvent, key);
    eventDiagnostics.push(diagnostic);
    recordDiagnostics(accumulator, subscriptionAccumulator, item, eventDiagnostics);
    return;
  }

  const provenance = Object.freeze(createProvenance(commandEvent, evidence));
  const currentFields = commandEvent.update?.fields ?? {};
  const changedFieldNames = new Set(Object.keys(commandEvent.update?.changedFields ?? {}));
  const incomingFieldStates = commandFieldStates(commandEvent);
  const fieldValueStates = Object.fromEntries(Object.keys(currentFields).map((field) => [
    field,
    !existing || effectiveCommand === "ADD" || changedFieldNames.has(field)
      ? incomingFieldStates[field]
      : existing.fieldValueStates[field] ?? (currentFields[field] === null && (existing.fieldProvenance[field] ?? existing.latest).source === "server" ? "ambiguous-null" : "concrete")
  ]));
  const fieldProvenance = Object.fromEntries(Object.keys(currentFields).map((field) => [
    field,
    !existing || effectiveCommand === "ADD" || changedFieldNames.has(field)
      ? provenance
      : existing.fieldProvenance[field] ?? existing.latest
  ]));
  const lifecycleEntry = Object.freeze({
    eventId: commandEvent.id,
    timestamp: commandEvent.timestamp,
    key,
    originalCommand: command,
    effectiveCommand,
    isSnapshot,
    provenance,
    fields: Object.freeze(cloneFields(commandEvent.update?.fields)) as CommandFields,
    changedFields: Object.freeze(cloneFields(commandEvent.update?.changedFields)) as CommandFields,
    diagnosticCodes: Object.freeze(eventDiagnostics.map((diagnostic) => diagnostic.code)) as CommandDiagnosticCode[]
  }) as CommandLifecycleEntry;

  appendLifecycle(accumulator, item, key, lifecycleEntry);

  if (effectiveCommand === "DELETE") {
    item.activeRows.delete(key);
    const deleted: MutableDeletedCommandKey = {
      subscriptionId: subscriptionAccumulator.subscriptionId,
      itemId: item.itemId,
      itemName: item.itemName,
      itemPosition: item.itemPosition,
      key,
      status: "deleted",
      deletedAt: provenance,
      lifecycle: lifecycleEntries(item.lifecycleByKey.get(key)),
      lifecycleTotal: item.lifecycleByKey.get(key)?.total ?? 0,
      lifecycleHasOlder: hasOlderLifecycle(item.lifecycleByKey.get(key))
    };
    item.deletedKeys.set(key, deleted);
    retainAuxiliaryRecord(accumulator.deletedHistory, item, deleted, COMMAND_HISTORICAL_KEY_LIMIT, COMMAND_HISTORICAL_KEY_BYTE_LIMIT, (record) => {
      const affected = auxiliaryItem(accumulator, record);
      if (affected?.deletedKeys.get(record.value.key) !== record.value) return;
      affected.deletedKeys.delete(record.value.key);
      affected.lifecycleByKey.delete(record.value.key);
      affected.deletedKeysHasOlder = true;
    });
  } else {
    const origin = existing?.origin ?? provenance;
    const keyLifecycle = item.lifecycleByKey.get(key);
    item.activeRows.set(key, {
      subscriptionId: subscriptionAccumulator.subscriptionId,
      itemId: item.itemId,
      itemName: item.itemName,
      itemPosition: item.itemPosition,
      key,
      status: "active",
      fields: cloneFields(commandEvent.update?.fields),
      fieldCount: Object.keys(currentFields).length,
      fieldValueStates,
      fieldProvenance,
      origin,
      latest: provenance,
      lifecycle: lifecycleEntries(keyLifecycle),
      lifecycleTotal: keyLifecycle?.total ?? 0,
      lifecycleHasOlder: hasOlderLifecycle(keyLifecycle)
    });
    const deleted = item.deletedKeys.get(key);
    if (deleted) removeAuxiliaryRecord(accumulator.deletedHistory, deleted);
    item.deletedKeys.delete(key);
  }

  recordDiagnostics(accumulator, subscriptionAccumulator, item, eventDiagnostics);
}

export function inspectCommandState(state: CommandState, input: CommandStateInspectionInput): CommandStateInspection {
  const item = findCommandItem(state, {
    subscriptionId: input.subscriptionId,
    itemName: input.item.name,
    itemPosition: input.item.position
  });
  const row = item?.activeRows.find(({ key }) => key === input.key);
  if (!row) return Object.freeze({
    state: "key-absent",
    provenance: item?.deletedKeys.find(({ key }) => key === input.key)?.deletedAt ?? item?.lastClearSnapshot ?? null
  });
  if (input.field === undefined) return Object.freeze({ state: "key-present", provenance: row.latest });
  if (!Object.prototype.hasOwnProperty.call(row.fields, input.field)) {
    return Object.freeze({ state: "field-absent", provenance: row.latest });
  }
  const value = row.fields[input.field];
  const provenance = row.fieldProvenance[input.field] ?? row.latest;
  const semantic = row.fieldValueStates[input.field] ?? (value === null && provenance.source === "server" ? "ambiguous-null" : "concrete");
  if (semantic === "ambiguous-null") return Object.freeze({ state: "ambiguous-server-null", provenance });
  if (semantic === "redacted") return Object.freeze({ state: "redacted", provenance });
  if (semantic === "unavailable") return Object.freeze({ state: "unavailable", provenance });
  if (semantic === "unresolved-wire-difference") return Object.freeze({ state: "unresolved-wire", provenance });
  return Object.freeze({ state: "concrete", value, provenance });
}

function readAccumulatorKey(accumulator: CommandStateAccumulator, input: CommandStateInspectionInput): CommandKeyStateRead {
  const subscription = accumulator.subscriptions.get(input.subscriptionId);
  const identity = resolveCommandItemIdentity(subscription?.subscription, input.item);
  const candidate = subscription?.items.get(identity.itemId);
  const item = candidate && (input.item.position === null || candidate.itemPosition === input.item.position)
    && (input.item.name === null || candidate.itemName === input.item.name) ? candidate : undefined;
  const row = item?.activeRows.get(input.key) ?? null;
  return Object.freeze({
    itemFound: Boolean(item), row, deleted: item?.deletedKeys.get(input.key) ?? null,
    fieldsTotal: row?.fieldCount ?? 0,
    lastClearSnapshot: item?.lastClearSnapshot ?? null,
    deletedKeysHasOlder: item?.deletedKeysHasOlder ?? false,
    lifecycleHasOlder: hasOlderLifecycle(item?.lifecycle),
    diagnosticsHasOlder: Boolean(item && item.diagnosticsTotal > item.diagnostics.length)
  });
}

function commandFieldStates(event: LightstreamerEventEnvelope): Record<string, ItemUpdateFieldValueState> {
  return Object.fromEntries(Object.entries(event.update?.fields ?? {}).map(([field, value]) => [
    field,
    event.update?.fieldValueStates?.[field] ?? (value === null && !event.synthetic ? "ambiguous-null" : "concrete")
  ]));
}

export function validateCommandDraftAgainstState(
  draft: CommandDraftLike | null,
  state: CommandState,
  context: CommandDraftContext
): CommandDraftValidationResult {
  const diagnostics: CommandDiagnostic[] = [];
  const command = normalizeCommand(draft?.command);
  const key = exactKeyOrNull(draft?.key);
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
    diagnostics: [],
    diagnosticsTotal: 0
  };
  subscriptions.set(subscriptionId, created);
  return created;
}

function getItemAccumulator(
  subscription: SubscriptionAccumulator,
  identity: CommandItemIdentity
): ItemAccumulator {
  const { itemId, itemName, itemPosition } = identity;
  const itemGroup = stringOrNull(subscription.subscription.itemGroup);
  if (itemGroup && itemPosition !== null && itemId.startsWith(`group:${itemGroup}:position:`)) {
    subscription.items.delete(`group:${itemGroup}:pending`);
  }
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
    deletedKeysHasOlder: false,
    lastClearSnapshot: null,
    lifecycleByKey: new Map(),
    lifecycle: createBoundedLifecycle(),
    diagnostics: [],
    diagnosticsTotal: 0
  };
  subscription.items.set(itemId, created);
  return created;
}

function seedDeclaredSubscriptionItems(subscription: SubscriptionAccumulator): void {
  const declaredItems = subscription.subscription.items ?? [];
  for (const [index, itemName] of declaredItems.entries()) {
    getItemAccumulator(subscription, {
      itemId: itemIdentity(itemName, index + 1),
      itemName,
      itemPosition: index + 1
    });
  }

  const itemGroup = stringOrNull(subscription.subscription.itemGroup);
  if (declaredItems.length === 0 && itemGroup) {
    getItemAccumulator(subscription, {
      itemId: `group:${itemGroup}:pending`,
      itemName: itemGroup,
      itemPosition: null
    });
  }
}

function toSubscriptionGroup(subscription: SubscriptionAccumulator): CommandSubscriptionGroup {
  return {
    subscriptionId: subscription.subscriptionId,
    mode: subscription.mode,
    subscription: { ...subscription.subscription },
    items: Array.from(subscription.items.values()).map(toItemGroup),
    diagnostics: [...subscription.diagnostics],
    diagnosticsTotal: subscription.diagnosticsTotal,
    diagnosticsHasOlder: subscription.diagnosticsTotal > subscription.diagnostics.length
  };
}

function toItemGroup(item: ItemAccumulator): CommandItemGroup {
  return {
    subscriptionId: item.subscriptionId,
    itemId: item.itemId,
    itemName: item.itemName,
    itemPosition: item.itemPosition,
    deletedKeysHasOlder: item.deletedKeysHasOlder,
    lastClearSnapshot: item.lastClearSnapshot,
    activeRows: Array.from(item.activeRows.values()).map(({ fieldCount: _fieldCount, ...row }) => ({
      ...row,
      fields: { ...row.fields },
      fieldValueStates: { ...row.fieldValueStates },
      fieldProvenance: { ...row.fieldProvenance },
      lifecycle: row.lifecycle.map(cloneLifecycleEntry),
      lifecycleHasOlder: row.lifecycleTotal > row.lifecycle.length
    })),
    deletedKeys: Array.from(item.deletedKeys.values()).map((deleted) => ({
      ...deleted,
      lifecycle: deleted.lifecycle.map(cloneLifecycleEntry),
      lifecycleHasOlder: deleted.lifecycleTotal > deleted.lifecycle.length
    })),
    lifecycle: item.lifecycle.entries.map(cloneLifecycleEntry),
    lifecycleTotal: item.lifecycle.total,
    lifecycleHasOlder: hasOlderLifecycle(item.lifecycle),
    diagnostics: [...item.diagnostics],
    diagnosticsTotal: item.diagnosticsTotal,
    diagnosticsHasOlder: item.diagnosticsTotal > item.diagnostics.length
  };
}

function appendLifecycle(accumulator: CommandStateAccumulator, item: ItemAccumulator, key: string, entry: CommandLifecycleEntry): void {
  const lifecycle = item.lifecycleByKey.get(key) ?? createBoundedLifecycle();
  const discardedKeyEntry = appendBoundedLifecycle(lifecycle, entry);
  item.lifecycleByKey.set(key, lifecycle);
  const discardedItemEntry = appendBoundedLifecycle(item.lifecycle, entry);
  for (const discarded of [discardedKeyEntry, discardedItemEntry]) {
    if (discarded && !item.lifecycle.entries.includes(discarded) && !item.lifecycleByKey.get(discarded.key)?.entries.includes(discarded)) {
      removeAuxiliaryRecord(accumulator.lifecycleHistory, discarded);
    }
  }
  retainAuxiliaryRecord(accumulator.lifecycleHistory, item, entry, COMMAND_LIFECYCLE_ENTRY_LIMIT, COMMAND_LIFECYCLE_BYTE_LIMIT, (record) => {
    const affected = auxiliaryItem(accumulator, record);
    if (!affected) return;
    removeIdentity(affected.lifecycle.entries, record.value);
    const keyLifecycle = affected.lifecycleByKey.get(record.value.key);
    if (keyLifecycle) removeIdentity(keyLifecycle.entries, record.value);
  });
}

function createBoundedLifecycle(): BoundedLifecycle {
  return { entries: [], total: 0 };
}

function appendBoundedLifecycle(lifecycle: BoundedLifecycle, entry: CommandLifecycleEntry): CommandLifecycleEntry | undefined {
  lifecycle.entries.push(entry);
  lifecycle.total += 1;
  return lifecycle.entries.length > COMMAND_RECENT_LIFECYCLE_LIMIT ? lifecycle.entries.shift() : undefined;
}

function lifecycleEntries(lifecycle: BoundedLifecycle | undefined): CommandLifecycleEntry[] {
  return lifecycle?.entries ?? [];
}

function hasOlderLifecycle(lifecycle: BoundedLifecycle | undefined): boolean {
  return lifecycle !== undefined && lifecycle.total > lifecycle.entries.length;
}

function recordDiagnostics(
  accumulator: CommandStateAccumulator,
  subscription: SubscriptionAccumulator,
  item: ItemAccumulator,
  eventDiagnostics: readonly CommandDiagnostic[]
): void {
  if (eventDiagnostics.length === 0) {
    return;
  }
  accumulator.diagnosticsTotal += eventDiagnostics.length;
  subscription.diagnosticsTotal += eventDiagnostics.length;
  item.diagnosticsTotal += eventDiagnostics.length;
  for (const diagnostic of eventDiagnostics) {
    accumulator.diagnostics.push(diagnostic);
    subscription.diagnostics.push(diagnostic);
    item.diagnostics.push(diagnostic);
    retainAuxiliaryRecord(accumulator.diagnosticHistory, item, diagnostic, COMMAND_DIAGNOSTIC_LIMIT, COMMAND_DIAGNOSTIC_BYTE_LIMIT, (record) => {
      removeIdentity(accumulator.diagnostics, record.value);
      const affectedSubscription = accumulator.subscriptions.get(record.subscriptionId);
      if (affectedSubscription) removeIdentity(affectedSubscription.diagnostics, record.value);
      const affected = auxiliaryItem(accumulator, record);
      if (affected) removeIdentity(affected.diagnostics, record.value);
    });
  }
}

/** Account serialized UTF-8 payload bytes, not an unsupported heap-size estimate. */
function retainAuxiliaryRecord<T>(
  history: AuxiliaryHistory<T>, item: ItemAccumulator, value: T, countLimit: number, byteLimit: number,
  evict: (record: AuxiliaryRecord<T>) => void
): void {
  const bytes = AUXILIARY_BYTE_ENCODER.encode(JSON.stringify({ subscriptionId: item.subscriptionId, itemId: item.itemId, value })).byteLength;
  const record = { subscriptionId: item.subscriptionId, itemId: item.itemId, value, bytes };
  if (bytes > byteLimit) {
    evict(record);
    return;
  }
  history.entries.set(value, record);
  history.bytes += bytes;
  while (history.entries.size > countLimit || history.bytes > byteLimit) {
    const oldest = history.entries.values().next().value as AuxiliaryRecord<T>;
    removeAuxiliaryRecord(history, oldest.value);
    evict(oldest);
  }
}

function removeAuxiliaryRecord<T>(history: AuxiliaryHistory<T>, value: T): void {
  const record = history.entries.get(value);
  if (!record) return;
  history.bytes -= record.bytes;
  history.entries.delete(value);
}

function auxiliaryItem<T>(accumulator: CommandStateAccumulator, record: AuxiliaryRecord<T>): ItemAccumulator | undefined {
  return accumulator.subscriptions.get(record.subscriptionId)?.items.get(record.itemId);
}

function removeIdentity<T>(values: T[], value: T): void {
  const index = values.indexOf(value);
  if (index !== -1) values.splice(index, 1);
}

function releaseSubscriptionAuxiliaryHistory(accumulator: CommandStateAccumulator, subscriptionId: string): void {
  releaseAuxiliarySubscription(accumulator.lifecycleHistory, subscriptionId);
  releaseAuxiliarySubscription(accumulator.deletedHistory, subscriptionId);
  // State diagnostics remain recent historical occurrences after retirement.
  // Their queue owns only bounded payloads/IDs, never a Subscription graph.
}

function releaseAuxiliarySubscription<T>(history: AuxiliaryHistory<T>, subscriptionId: string): void {
  for (const record of history.entries.values()) {
    if (record.subscriptionId === subscriptionId) removeAuxiliaryRecord(history, record.value);
  }
}

function exactKeyOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const key = String(value);
  return key.length > 0 ? key : null;
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
  return entry;
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

function createProvenance(event: LightstreamerEventEnvelope, evidence?: CommandEvidenceIdentity): CommandProvenance {
  const isSnapshot = Boolean(event.update?.isSnapshot);
  const synthetic = event.synthetic || event.source === "synthetic";
  return {
    label: synthetic ? (isSnapshot ? "synthetic-snapshot" : "synthetic-live") : isSnapshot ? "snapshot" : "live",
    eventId: event.id,
    ...(evidence ? { evidence: Object.freeze({ ...evidence }) } : {}),
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

/** Resolves a Subscription item without treating an Item Group as an item name. */
export function findCommandItem(state: CommandState, context: CommandDraftContext): CommandItemGroup | null {
  const subscription = state.subscriptions.find((group) => group.subscriptionId === context.subscriptionId);
  if (!subscription) return null;
  const name = stringOrNull(context.itemName);
  const position = context.itemPosition ?? null;
  const matches = subscription.items.filter((item) => {
    if (position !== null && item.itemPosition !== null && position !== item.itemPosition) return false;
    if (name !== null && item.itemName !== null && name !== item.itemName) return false;
    return (position !== null && position === item.itemPosition) || (name !== null && name === item.itemName);
  });
  // A group label can match several positions. Never borrow another item's key.
  return matches.length === 1 ? matches[0]! : null;
}

function findActiveRow(state: CommandState, context: CommandDraftContext, key: string): CommandRow | null {
  return findCommandItem(state, context)?.activeRows.find((row) => row.key === key) ?? null;
}
