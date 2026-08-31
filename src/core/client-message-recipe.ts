import type { LightstreamerEventEnvelope } from "./event-envelope";
import type { ServerInjectionDraft } from "./server-injection";

export const CLIENT_MESSAGE_RECIPE_LIMITS = Object.freeze({
  count: 12,
  idLength: 128,
  labelLength: 120,
  descriptionLength: 320,
  messageLength: 1_048_576,
  sequenceLength: 256
});

export type ClientMessageRecipeContext = Readonly<{
  source: Readonly<{
    eventId: string;
    kind: string;
    direction: string;
    provenance: string;
  }>;
  target: Readonly<{
    pageEpoch: string;
    clientId: string;
    sessionId: string;
  }>;
  client: Readonly<{
    adapterSet: string | null;
  }>;
  subscription: Readonly<{
    id: string | null;
    mode: string | null;
    dataAdapter: string | null;
  }>;
  item: Readonly<{
    name: string | null;
    position: number | null;
  }>;
  update: Readonly<{
    command: string | null;
    key: string | null;
    isSnapshot: boolean | null;
    fields: Readonly<Record<string, string | number | boolean | null>>;
    changedFields: Readonly<Record<string, string | number | boolean | null>>;
  }> | null;
}>;

export type ClientMessageRecipe = Readonly<{
  id: string;
  label: string;
  description: string;
  message: string;
  sequence: string;
  delayTimeout: number | null;
  enqueueWhileDisconnected: boolean;
}>;

export type ClientMessageRecipeResolution = Readonly<{
  status: "loading" | "available" | "unavailable" | "error";
  items: readonly ClientMessageRecipe[];
  detail: string | null;
}>;

export type ClientMessageRecipeProvider = Readonly<{
  resolve(context: ClientMessageRecipeContext): Promise<ClientMessageRecipeResolution>;
}>;

export function createClientMessageRecipeContext(
  event: LightstreamerEventEnvelope,
  target: ServerInjectionDraft["target"]
): ClientMessageRecipeContext {
  return Object.freeze({
    source: Object.freeze({
      eventId: event.id,
      kind: event.kind,
      direction: event.direction,
      provenance: event.source
    }),
    target: Object.freeze({ ...target }),
    client: Object.freeze({ adapterSet: event.client?.adapterSet ?? null }),
    subscription: Object.freeze({
      id: event.subscription?.id ?? null,
      mode: event.subscription?.mode ?? null,
      dataAdapter: event.subscription?.dataAdapter ?? null
    }),
    item: Object.freeze({
      name: event.item?.name ?? null,
      position: event.item?.position ?? null
    }),
    update: event.update
      ? Object.freeze({
          command: event.update.command ?? null,
          key: event.update.key ?? null,
          isSnapshot: event.update.isSnapshot ?? null,
          fields: Object.freeze({ ...(event.update.fields ?? {}) }),
          changedFields: Object.freeze({ ...(event.update.changedFields ?? {}) })
        })
      : null
  });
}

export function loadingClientMessageRecipes(): ClientMessageRecipeResolution {
  return Object.freeze({ status: "loading", items: Object.freeze([]), detail: null });
}

export function unavailableClientMessageRecipes(detail: string): ClientMessageRecipeResolution {
  return Object.freeze({ status: "unavailable", items: Object.freeze([]), detail });
}

export function errorClientMessageRecipes(detail: string): ClientMessageRecipeResolution {
  return Object.freeze({ status: "error", items: Object.freeze([]), detail });
}

export function normalizeClientMessageRecipes(value: unknown): ClientMessageRecipeResolution {
  if (!Array.isArray(value)) {
    return errorClientMessageRecipes("The inspected application returned an invalid Message Recipe list.");
  }
  if (value.length > CLIENT_MESSAGE_RECIPE_LIMITS.count) {
    return errorClientMessageRecipes(
      `The inspected application returned more than ${CLIENT_MESSAGE_RECIPE_LIMITS.count} Message Recipes.`
    );
  }
  const recipes: ClientMessageRecipe[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    const recipe = normalizeRecipe(candidate);
    if (!recipe) {
      return errorClientMessageRecipes("The inspected application returned an invalid Message Recipe.");
    }
    if (ids.has(recipe.id)) {
      return errorClientMessageRecipes(`The inspected application returned duplicate Message Recipe id ${recipe.id}.`);
    }
    ids.add(recipe.id);
    recipes.push(recipe);
  }
  if (recipes.length === 0) {
    return unavailableClientMessageRecipes(
      "The inspected application did not offer a Message Recipe for the selected Evidence."
    );
  }
  return Object.freeze({
    status: "available",
    items: Object.freeze(recipes),
    detail: null
  });
}

function normalizeRecipe(value: unknown): ClientMessageRecipe | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const recipe = value as Record<string, unknown>;
  const id = boundedNonEmptyString(recipe.id, CLIENT_MESSAGE_RECIPE_LIMITS.idLength);
  const label = boundedNonEmptyString(recipe.label, CLIENT_MESSAGE_RECIPE_LIMITS.labelLength);
  const description = boundedNonEmptyString(
    recipe.description,
    CLIENT_MESSAGE_RECIPE_LIMITS.descriptionLength
  );
  const message = boundedNonEmptyString(recipe.message, CLIENT_MESSAGE_RECIPE_LIMITS.messageLength);
  const sequence = boundedNonEmptyString(
    recipe.sequence,
    CLIENT_MESSAGE_RECIPE_LIMITS.sequenceLength
  );
  const delayTimeout = recipe.delayTimeout;
  if (
    id === null ||
    label === null ||
    description === null ||
    message === null ||
    sequence === null ||
    !(
      delayTimeout === null ||
      (typeof delayTimeout === "number" && Number.isSafeInteger(delayTimeout) && delayTimeout >= 0)
    ) ||
    typeof recipe.enqueueWhileDisconnected !== "boolean"
  ) return null;
  return Object.freeze({
    id,
    label,
    description,
    message,
    sequence,
    delayTimeout: delayTimeout as number | null,
    enqueueWhileDisconnected: recipe.enqueueWhileDisconnected
  });
}

function boundedNonEmptyString(value: unknown, maximum: number): string | null {
  const string = boundedString(value, maximum);
  return string !== null && string.trim().length > 0 ? string : null;
}

function boundedString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length <= maximum ? value : null;
}
