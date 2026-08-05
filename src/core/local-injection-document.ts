import {
  validateCommandDraftAgainstState,
  type CommandState
} from "./command-state";
import {
  draftFieldsMatchSource,
  type DraftFields,
  type DraftFieldValue,
  type ReinjectionDraft
} from "./reinjection-draft";
import {
  expandJsonStringFields,
  jsonStructurallyEqual,
  serializeJsonStringFields,
  type ExpandedJsonStringFieldValue
} from "./json-string-fields";

export type LocalInjectionFields = Record<string, ExpandedJsonStringFieldValue>;

export type LocalInjectionDocument = {
  command: string | null;
  key: string | null;
  isSnapshot: boolean;
  fields: LocalInjectionFields;
};

export type LocalInjectionDiagnosticCategory = "syntax" | "schema" | "semantic" | "target";

export type LocalInjectionDiagnostic = Readonly<{
  category: LocalInjectionDiagnosticCategory;
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
}>;

export type LocalInjectionValidationContext = Readonly<{
  mode: string | null;
  commandSemantics?: "required" | "not-applicable";
  schemaFields: readonly string[];
  /** Captured fields proven to contain a complete encoded JSON object or array. */
  jsonStringFields?: readonly string[];
  commandState: CommandState;
  subscriptionId: string;
  itemName?: string | null;
  itemPosition?: number | null;
}>;

export type LocalInjectionDocumentAnalysis = Readonly<{
  document: LocalInjectionDocument | null;
  diagnostics: readonly LocalInjectionDiagnostic[];
  ready: boolean;
}>;

const TOP_LEVEL_KEYS = ["command", "key", "isSnapshot", "fields"] as const;
const TOP_LEVEL_KEY_SET = new Set<string>(TOP_LEVEL_KEYS);

export function createLocalInjectionDocumentFromDraft(
  draft: ReinjectionDraft
): LocalInjectionDocument {
  return {
    command: draft.command,
    key: draft.key,
    isSnapshot: draft.isSnapshot,
    fields: { ...expandJsonStringFields(draft.fields).fields }
  };
}

export function serializeLocalInjectionDocument(
  document: LocalInjectionDocument
): string {
  return JSON.stringify(document, null, 2);
}

export function analyzeLocalInjectionDocument(
  text: string,
  context: LocalInjectionValidationContext
): LocalInjectionDocumentAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return result(null, [
      diagnostic(
        "syntax",
        "invalid-json",
        error instanceof Error ? error.message : "Invalid JSON."
      )
    ]);
  }

  const duplicateDiagnostics = duplicateJsonKeyDiagnostics(text);
  const parsedDocument = parseDocumentShape(parsed, context.jsonStringFields ?? []);
  const diagnostics = [
    ...duplicateDiagnostics,
    ...parsedDocument.diagnostics
  ];
  if (!parsedDocument.document) return result(null, diagnostics);

  diagnostics.push(...validateLocalInjectionDocument(parsedDocument.document, context));
  return result(parsedDocument.document, diagnostics);
}

export function validateLocalInjectionDocument(
  document: LocalInjectionDocument,
  context: LocalInjectionValidationContext
): LocalInjectionDiagnostic[] {
  const diagnostics: LocalInjectionDiagnostic[] = [];
  const schema = new Set(context.schemaFields);
  const jsonStringFields = new Set(context.jsonStringFields ?? []);
  const fields = Object.keys(document.fields);

  for (const [fieldName, value] of Object.entries(document.fields)) {
    if (fieldName.trim() === "") {
      diagnostics.push(
        diagnostic("schema", "empty-field-name", "Field names must be non-empty.", "fields")
      );
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      diagnostics.push(
        diagnostic(
          "schema",
          "non-finite-number",
          `Field "${fieldName}" must contain a finite number.`,
          `fields.${fieldName}`
        )
      );
    }
    if (isJsonContainer(value) && !jsonStringFields.has(fieldName)) {
      diagnostics.push(
        diagnostic(
          "schema",
          "non-primitive-field",
          `Field "${fieldName}" must contain a string, number, boolean, or null.`,
          `fields.${fieldName}`
        )
      );
    }
    if (jsonStringFields.has(fieldName) && !isJsonContainer(value)) {
      diagnostics.push(
        diagnostic(
          "schema",
          "encoded-json-field-type",
          `Field "${fieldName}" was captured as an encoded JSON string and must remain a JSON object or array.`,
          `fields.${fieldName}`
        )
      );
    }
  }

  const unknown = fields.filter((field) => !schema.has(field));
  const missing = context.schemaFields.filter((field) => !Object.hasOwn(document.fields, field));
  if (unknown.length > 0 || missing.length > 0) {
    diagnostics.push(
      diagnostic(
        "schema",
        "schema-mismatch",
        [
          unknown.length > 0 ? `Unknown fields: ${unknown.join(", ")}.` : null,
          missing.length > 0 ? `Missing fields: ${missing.join(", ")}.` : null
        ].filter(Boolean).join(" "),
        "fields"
      )
    );
  }

  if (
    schema.has("command") &&
    Object.hasOwn(document.fields, "command") &&
    !Object.is(document.fields.command, document.command)
  ) {
    diagnostics.push(
      diagnostic(
        "schema",
        "command-field-mismatch",
        "fields.command must equal the protected top-level command value.",
        "fields.command"
      )
    );
  }
  if (
    schema.has("key") &&
    Object.hasOwn(document.fields, "key") &&
    !Object.is(document.fields.key, document.key)
  ) {
    diagnostics.push(
      diagnostic(
        "schema",
        "key-field-mismatch",
        "fields.key must equal the protected top-level key value.",
        "fields.key"
      )
    );
  }

  const commandSemantics = context.commandSemantics ?? "required";
  if (commandSemantics === "required" && context.mode !== "COMMAND") {
    diagnostics.push(
      diagnostic(
        "semantic",
        "not-command-subscription",
        "Local Injection authoring requires a captured COMMAND Subscription."
      )
    );
  } else if (commandSemantics === "required") {
    const semantic = validateCommandDraftAgainstState(document, context.commandState, {
      subscriptionId: context.subscriptionId,
      itemName: context.itemName,
      itemPosition: context.itemPosition
    });
    diagnostics.push(
      ...semantic.diagnostics.map((entry) =>
        diagnostic(
          "semantic",
          entry.code,
          entry.explanation,
          entry.field
        )
      )
    );
  }

  return diagnostics;
}

export function applyLocalInjectionDocumentToDraft(
  source: ReinjectionDraft,
  document: LocalInjectionDocument
): ReinjectionDraft {
  const expansion = expandJsonStringFields(source.fields);
  const serializedFields = serializeJsonStringFields(expansion, document.fields);
  const draft: ReinjectionDraft = {
    ...source,
    command: document.command,
    key: document.key,
    isSnapshot: document.isSnapshot,
    fields: { ...serializedFields },
    manualChangedFieldsOverride: false
  };
  return {
    ...draft,
    changedFields: draftFieldsMatchSource(draft)
      ? { ...draft.originalChangedFields }
      : changedFields(source.sourceFields, serializedFields)
  };
}

export function localInjectionDocumentsEqual(
  left: LocalInjectionDocument,
  right: LocalInjectionDocument
): boolean {
  return (
    Object.is(left.command, right.command) &&
    Object.is(left.key, right.key) &&
    left.isSnapshot === right.isSnapshot &&
    recordsEqual(left.fields, right.fields)
  );
}

function parseDocumentShape(value: unknown, jsonStringFieldNames: readonly string[]): {
  document: LocalInjectionDocument | null;
  diagnostics: LocalInjectionDiagnostic[];
} {
  if (!isRecord(value)) {
    return {
      document: null,
      diagnostics: [diagnostic("schema", "document-not-object", "Local Injection JSON must be an object.")]
    };
  }

  const diagnostics: LocalInjectionDiagnostic[] = [];
  let fatal = false;
  for (const key of TOP_LEVEL_KEYS) {
    if (!Object.hasOwn(value, key)) {
      fatal = true;
      diagnostics.push(
        diagnostic(
          "schema",
          "missing-top-level-key",
          `Missing required top-level key "${key}".`,
          key
        )
      );
    }
  }
  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_KEY_SET.has(key)) {
      diagnostics.push(
        diagnostic(
          "schema",
          "unknown-top-level-key",
          `Unknown top-level key "${key}".`,
          key
        )
      );
    }
  }

  if (!(typeof value.command === "string" || value.command === null)) {
    fatal = true;
    diagnostics.push(
      diagnostic("schema", "invalid-command-type", "command must be a string or null.", "command")
    );
  }
  if (!(typeof value.key === "string" || value.key === null)) {
    fatal = true;
    diagnostics.push(
      diagnostic("schema", "invalid-key-type", "key must be a string or null.", "key")
    );
  }
  if (typeof value.isSnapshot !== "boolean") {
    fatal = true;
    diagnostics.push(
      diagnostic("schema", "invalid-snapshot-type", "isSnapshot must be a boolean.", "isSnapshot")
    );
  }

  const fieldEntries: Array<readonly [string, ExpandedJsonStringFieldValue]> = [];
  const jsonStringFields = new Set(jsonStringFieldNames);
  if (!isRecord(value.fields)) {
    fatal = true;
    diagnostics.push(
      diagnostic("schema", "invalid-fields-type", "fields must be a JSON object.", "fields")
    );
  } else {
    for (const [fieldName, fieldValue] of Object.entries(value.fields)) {
      if (isJsonContainer(fieldValue) && jsonStringFields.has(fieldName)) {
        fieldEntries.push([fieldName, fieldValue]);
        continue;
      }
      if (!isPrimitive(fieldValue)) {
        diagnostics.push(
          diagnostic(
            "schema",
            "non-primitive-field",
            `Field "${fieldName}" must contain a string, number, boolean, or null.`,
            `fields.${fieldName}`
          )
        );
        continue;
      }
      fieldEntries.push([fieldName, fieldValue]);
    }
  }
  const fields: LocalInjectionFields = Object.fromEntries(fieldEntries);

  if (fatal) return { document: null, diagnostics };
  return {
    document: {
      command: value.command as string | null,
      key: value.key as string | null,
      isSnapshot: value.isSnapshot as boolean,
      fields
    },
    diagnostics
  };
}

function duplicateJsonKeyDiagnostics(text: string): LocalInjectionDiagnostic[] {
  const duplicates: Array<{ key: string; path: string }> = [];
  let cursor = 0;

  const skipWhitespace = () => {
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
  };
  const parseString = (): string => {
    const start = cursor;
    cursor += 1;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === "\\") {
        cursor += 2;
        continue;
      }
      cursor += 1;
      if (char === '"') break;
    }
    return JSON.parse(text.slice(start, cursor)) as string;
  };
  const parseValue = (path: string): void => {
    skipWhitespace();
    const char = text[cursor];
    if (char === "{") {
      parseObject(path);
      return;
    }
    if (char === "[") {
      cursor += 1;
      let index = 0;
      skipWhitespace();
      while (text[cursor] !== "]") {
        parseValue(`${path}[${index}]`);
        index += 1;
        skipWhitespace();
        if (text[cursor] === ",") cursor += 1;
        skipWhitespace();
      }
      cursor += 1;
      return;
    }
    if (char === '"') {
      parseString();
      return;
    }
    while (cursor < text.length && !/[\s,}\]]/.test(text[cursor] ?? "")) cursor += 1;
  };
  const parseObject = (path: string): void => {
    cursor += 1;
    const keys = new Set<string>();
    skipWhitespace();
    while (text[cursor] !== "}") {
      const key = parseString();
      const keyPath = path ? `${path}.${key}` : key;
      if (keys.has(key)) duplicates.push({ key, path: keyPath });
      keys.add(key);
      skipWhitespace();
      cursor += 1; // colon; JSON.parse already established valid syntax.
      parseValue(keyPath);
      skipWhitespace();
      if (text[cursor] === ",") cursor += 1;
      skipWhitespace();
    }
    cursor += 1;
  };

  parseValue("");
  return duplicates.map(({ key, path }) =>
    diagnostic("syntax", "duplicate-key", `Duplicate JSON key "${key}" is not allowed.`, path)
  );
}

function changedFields(source: DraftFields, draft: DraftFields): DraftFields {
  const changed: DraftFields = {};
  for (const [key, value] of Object.entries(draft)) {
    if (!Object.is(source[key], value)) changed[key] = value;
  }
  return changed;
}

function recordsEqual(left: LocalInjectionFields, right: LocalInjectionFields): boolean {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => {
      if (!Object.hasOwn(right, key)) return false;
      const leftValue = left[key]!;
      const rightValue = right[key]!;
      if (isJsonContainer(leftValue) || isJsonContainer(rightValue)) {
        return isJsonContainer(leftValue) &&
          isJsonContainer(rightValue) &&
          jsonStructurallyEqual(leftValue, rightValue);
      }
      return Object.is(leftValue, rightValue);
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is DraftFieldValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isJsonContainer(value: unknown): value is Exclude<ExpandedJsonStringFieldValue, DraftFieldValue> {
  return typeof value === "object" && value !== null;
}

function diagnostic(
  category: LocalInjectionDiagnosticCategory,
  code: string,
  message: string,
  path?: string
): LocalInjectionDiagnostic {
  return Object.freeze({
    category,
    severity: "error" as const,
    code,
    message,
    ...(path ? { path } : {})
  });
}

function result(
  document: LocalInjectionDocument | null,
  diagnostics: readonly LocalInjectionDiagnostic[]
): LocalInjectionDocumentAnalysis {
  return Object.freeze({
    document,
    diagnostics: Object.freeze([...diagnostics]),
    ready: Boolean(document) && diagnostics.every(({ severity }) => severity !== "error")
  });
}
