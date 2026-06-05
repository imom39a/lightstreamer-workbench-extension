import {
  reduceCommandState,
  validateCommandDraftAgainstState,
  type CommandDiagnostic,
  type CommandState
} from "./command-state";
import {
  type EventItem,
  type LightstreamerEventEnvelope
} from "./event-envelope";

export type DraftFieldValue = string | number | boolean | null;
export type DraftFields = Record<string, DraftFieldValue>;

export type ReinjectionDraft = {
  sourceEventId: string;
  target: {
    subscriptionId: string | null;
    listenerId: string | null;
  };
  item: EventItem;
  command: string | null;
  key: string | null;
  fields: DraftFields;
  sourceFields: DraftFields;
  changedFields: DraftFields;
  originalChangedFields: DraftFields;
  isSnapshot: boolean;
  manualChangedFieldsOverride: boolean;
  provenance: {
    source: "clone" | "new-command";
    sourceEventKind: string;
    sourceSynthetic: boolean;
  };
};

export type CommandItemContext = {
  subscriptionId?: string | null;
  mode?: string | null;
  listenerId?: string | null;
  itemName?: string | null;
  itemPosition?: number | null;
  fields?: string[] | null;
};

export type NewCommandDraftDiagnosticCode =
  | CommandDiagnostic["code"]
  | "missing-context"
  | "invalid-field-name";

export type NewCommandDraftDiagnostic = Omit<CommandDiagnostic, "code" | "severity"> & {
  severity: "error" | "warning";
  code: NewCommandDraftDiagnosticCode;
};

export type NewCommandDraftValidationResult = {
  valid: boolean;
  diagnostics: NewCommandDraftDiagnostic[];
};

export type DraftValidationResult = {
  valid: boolean;
  errors: string[];
};

export function createDraftFromEvent(event: LightstreamerEventEnvelope): ReinjectionDraft | null {
  if (event.kind !== "item-update") {
    return null;
  }

  const fields = normalizeFields(event.update?.fields);
  const changedFields = normalizeFields(event.update?.changedFields);
  const command = stringOrNull(event.update?.command ?? fields.command);
  const key = stringOrNull(event.update?.key ?? fields.key);

  return {
    sourceEventId: event.id,
    target: {
      subscriptionId: event.subscription?.id ?? null,
      listenerId: event.listener?.id ?? null
    },
    item: {
      name: event.item?.name ?? null,
      position: event.item?.position ?? null
    },
    command,
    key,
    fields,
    sourceFields: { ...fields },
    changedFields: { ...changedFields },
    originalChangedFields: { ...changedFields },
    isSnapshot: Boolean(event.update?.isSnapshot),
    manualChangedFieldsOverride: false,
    provenance: {
      source: "clone",
      sourceEventKind: event.kind,
      sourceSynthetic: event.synthetic
    }
  };
}

export function createNewCommandDraftFromContext(context: CommandItemContext): ReinjectionDraft | null {
  const contextValidation = validateCommandItemContext(context);
  if (!contextValidation.valid || !contextValidation.subscriptionId || !contextValidation.listenerId) {
    return null;
  }

  const item = {
    name: contextValidation.itemName,
    position: contextValidation.itemPosition
  };
  const fields = schemaFields(contextValidation.fields);

  return {
    sourceEventId: newCommandSourceEventId(contextValidation.subscriptionId, contextValidation.listenerId, item),
    target: {
      subscriptionId: contextValidation.subscriptionId,
      listenerId: contextValidation.listenerId
    },
    item,
    command: null,
    key: null,
    fields,
    sourceFields: { ...fields },
    changedFields: {},
    originalChangedFields: {},
    isSnapshot: false,
    manualChangedFieldsOverride: false,
    provenance: {
      source: "new-command",
      sourceEventKind: "item-update",
      sourceSynthetic: true
    }
  };
}

export function updateDraftField(
  draft: ReinjectionDraft,
  fieldName: string,
  value: DraftFieldValue
): ReinjectionDraft {
  const fields = {
    ...draft.fields,
    [fieldName]: value
  };
  const next = {
    ...draft,
    fields,
    command: fieldName === "command" ? stringOrNull(value) : draft.command,
    key: fieldName === "key" ? stringOrNull(value) : draft.key
  };

  return refreshChangedFields(next);
}

export function updateDraftCommand(draft: ReinjectionDraft, command: string): ReinjectionDraft {
  return refreshChangedFields({
    ...draft,
    command: command || null,
    fields: {
      ...draft.fields,
      command: command || null
    }
  });
}

export function updateDraftKey(draft: ReinjectionDraft, key: string): ReinjectionDraft {
  return refreshChangedFields({
    ...draft,
    key: key || null,
    fields: {
      ...draft.fields,
      key: key || null
    }
  });
}

export function updateDraftSnapshot(draft: ReinjectionDraft, isSnapshot: boolean): ReinjectionDraft {
  return {
    ...draft,
    isSnapshot
  };
}

export function setManualChangedFieldsOverride(
  draft: ReinjectionDraft,
  changedFields: DraftFields
): ReinjectionDraft {
  return {
    ...draft,
    changedFields,
    manualChangedFieldsOverride: true
  };
}

export function deriveChangedFields(sourceFields: DraftFields, draftFields: DraftFields): DraftFields {
  const changedFields: DraftFields = {};
  for (const [fieldName, value] of Object.entries(draftFields)) {
    if (!Object.is(sourceFields[fieldName], value)) {
      changedFields[fieldName] = value;
    }
  }
  return changedFields;
}

export function validateReinjectionDraft(draft: ReinjectionDraft | null): DraftValidationResult {
  const result = validateEditableDraft(draft);
  if (!draft) {
    return result;
  }

  const errors = [...result.errors];
  if (!draft.target.listenerId) {
    errors.push("Missing original listener target.");
  }
  if (!draft.command) {
    errors.push("Missing COMMAND command value.");
  }
  if (!draft.key) {
    errors.push("Missing COMMAND key value.");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateEditableDraft(draft: ReinjectionDraft | null): DraftValidationResult {
  if (!draft) {
    return {
      valid: false,
      errors: ["Draft source must be a captured item update."]
    };
  }

  const errors: string[] = [];
  if (!draft.target.subscriptionId) {
    errors.push("Missing captured subscription target.");
  }
  if (!draft.item.name && draft.item.position === null) {
    errors.push("Missing item context.");
  }
  if (Object.keys(draft.fields).length === 0) {
    errors.push("Draft must include at least one field.");
  }
  for (const fieldName of Object.keys(draft.fields)) {
    if (fieldName.trim() === "") {
      errors.push("Field names must be non-empty.");
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateNewCommandDraft(
  draft: ReinjectionDraft | null,
  state: CommandState,
  context: CommandItemContext
): NewCommandDraftValidationResult {
  const diagnostics: NewCommandDraftDiagnostic[] = [];
  const contextValidation = validateCommandItemContext(context);

  diagnostics.push(...contextValidation.diagnostics);

  if (!draft) {
    diagnostics.push({
      severity: "error",
      code: "missing-context",
      explanation: "New COMMAND updates must start from a captured COMMAND subscription, item, listener, and field schema.",
      suggestion: "Select a captured COMMAND item update with an attached listener before creating a synthetic update."
    });
    return toNewCommandDraftValidationResult(diagnostics);
  }

  const editable = validateEditableDraft(draft);
  for (const error of editable.errors) {
    diagnostics.push({
      severity: "error",
      code: error === "Field names must be non-empty." ? "invalid-field-name" : "missing-context",
      explanation: error,
      suggestion:
        error === "Field names must be non-empty."
          ? "Remove empty field names from the draft before injecting."
          : "Create the draft from a captured COMMAND subscription and item context."
    });
  }

  if (!draft.target.listenerId) {
    diagnostics.push({
      severity: "error",
      code: "missing-context",
      explanation: "A captured listener target is required for backend-free local listener-path injection.",
      suggestion: "Capture a COMMAND update after the page listener is attached, then create the synthetic update again."
    });
  }

  diagnostics.push(...validateDraftFieldsAgainstSchema(draft, contextValidation.fields));

  if (contextValidation.subscriptionId) {
    const semanticState =
      state.subscriptions.length > 0
        ? state
        : reduceCommandState([]);
    const semantic = validateCommandDraftAgainstState(semanticDraft(draft), semanticState, {
      subscriptionId: contextValidation.subscriptionId,
      itemName: contextValidation.itemName,
      itemPosition: contextValidation.itemPosition
    });
    diagnostics.push(...semantic.diagnostics);
  }

  return toNewCommandDraftValidationResult(diagnostics);
}

function refreshChangedFields(draft: ReinjectionDraft): ReinjectionDraft {
  if (draft.manualChangedFieldsOverride) {
    return draft;
  }

  return {
    ...draft,
    changedFields: deriveChangedFields(draft.sourceFields, draft.fields)
  };
}

function normalizeFields(
  fields: Record<string, string | number | boolean | null> | undefined
): DraftFields {
  return fields ? { ...fields } : {};
}

type ValidatedCommandItemContext = {
  valid: boolean;
  subscriptionId: string | null;
  listenerId: string | null;
  itemName: string | null;
  itemPosition: number | null;
  fields: string[];
  diagnostics: NewCommandDraftDiagnostic[];
};

function validateCommandItemContext(context: CommandItemContext): ValidatedCommandItemContext {
  const subscriptionId = nonEmptyString(context.subscriptionId);
  const listenerId = nonEmptyString(context.listenerId);
  const itemName = nonEmptyString(context.itemName);
  const itemPosition =
    typeof context.itemPosition === "number" && Number.isInteger(context.itemPosition)
      ? context.itemPosition
      : null;
  const fields = normalizeSchemaFieldNames(context.fields);
  const diagnostics: NewCommandDraftDiagnostic[] = [];

  if (!subscriptionId) {
    diagnostics.push(missingContextDiagnostic("captured subscription id"));
  }
  if (context.mode !== "COMMAND") {
    diagnostics.push({
      severity: "error",
      code: "missing-context",
      explanation: "New synthetic updates can only be created for captured COMMAND subscriptions.",
      suggestion: "Select a captured item from a COMMAND-mode subscription."
    });
  }
  if (!listenerId) {
    diagnostics.push(missingContextDiagnostic("captured listener target"));
  }
  if (!itemName && itemPosition === null) {
    diagnostics.push(missingContextDiagnostic("captured item name or position"));
  }
  if (fields.length === 0 || !fields.includes("command") || !fields.includes("key")) {
    diagnostics.push({
      severity: "error",
      code: "missing-context",
      explanation: "Captured COMMAND field schema must include command and key fields.",
      suggestion: "Capture a COMMAND subscription with its field schema before creating a synthetic update."
    });
  }

  return {
    valid: diagnostics.length === 0,
    subscriptionId,
    listenerId,
    itemName,
    itemPosition,
    fields,
    diagnostics
  };
}

function missingContextDiagnostic(missing: string): NewCommandDraftDiagnostic {
  return {
    severity: "error",
    code: "missing-context",
    explanation: `Missing ${missing}; arbitrary COMMAND event fabrication is not allowed.`,
    suggestion: "Select an existing captured COMMAND subscription and item context before creating a synthetic update."
  };
}

function normalizeSchemaFieldNames(fields: string[] | null | undefined): string[] {
  const normalized: string[] = [];
  for (const field of fields ?? []) {
    const name = field.trim();
    if (name && !normalized.includes(name)) {
      normalized.push(name);
    }
  }
  return normalized;
}

function schemaFields(fieldNames: readonly string[]): DraftFields {
  return Object.fromEntries(fieldNames.map((fieldName) => [fieldName, null])) as DraftFields;
}

function validateDraftFieldsAgainstSchema(
  draft: ReinjectionDraft,
  schemaFieldNames: readonly string[]
): NewCommandDraftDiagnostic[] {
  const diagnostics: NewCommandDraftDiagnostic[] = [];
  const allowed = new Set(schemaFieldNames);
  for (const fieldName of Object.keys(draft.fields)) {
    if (fieldName.trim() === "") {
      diagnostics.push({
        severity: "error",
        code: "invalid-field-name",
        field: "command",
        explanation: "Draft field names must be non-empty.",
        suggestion: "Remove empty field names from the draft."
      });
    } else if (!allowed.has(fieldName)) {
      diagnostics.push({
        severity: "error",
        code: "invalid-field-name",
        explanation: `Field "${fieldName}" is not part of the captured COMMAND subscription schema.`,
        suggestion: "Use only field names captured from this subscription schema."
      });
    }
  }
  return diagnostics;
}

function semanticDraft(draft: ReinjectionDraft): { command: string | null; key: string | null; isSnapshot: boolean } {
  return {
    command: draft.command,
    key: draft.key,
    isSnapshot: draft.isSnapshot
  };
}

function toNewCommandDraftValidationResult(
  diagnostics: NewCommandDraftDiagnostic[]
): NewCommandDraftValidationResult {
  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics
  };
}

function newCommandSourceEventId(
  subscriptionId: string,
  listenerId: string,
  item: EventItem
): string {
  const itemLabel = item.name ?? `position-${item.position ?? "unknown"}`;
  return `new-command:${subscriptionId}:${listenerId}:${itemLabel}`;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return String(value);
}
