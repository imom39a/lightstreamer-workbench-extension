import type { EventSemanticValueState } from "../../core/event-envelope";
import type { AgentScopeOptions } from "./agent-runtime";
import type { TopologySelectionTarget } from "./topology-view-model";

/** Configured Lightstreamer facts for investigation, independent of whether a
 * target is live, injectable, or has produced any retained Item Updates. */
export function describeAgentSourceContext(scopeId: string, target: TopologySelectionTarget | null, options: AgentScopeOptions = {}) {
  if (!target || !("subscription" in target)) return null;
  const { subscription, client, session } = target;
  const schema = describeFields(subscription.fields, subscription.fieldSchema, subscription.semanticValueStates?.fields, subscription.semanticValueStates?.fieldSchema, options);
  const secondLevelSchema = subscription.commandSecondLevelFields !== undefined || subscription.commandSecondLevelFieldSchema != null || subscription.commandSecondLevelDataAdapter != null
    ? describeFields(subscription.commandSecondLevelFields, subscription.commandSecondLevelFieldSchema, subscription.semanticValueStates?.commandSecondLevelFields, subscription.semanticValueStates?.commandSecondLevelFieldSchema, options)
    : null;
  const item = "item" in target && target.item ? { name: target.item.name, position: target.item.position } : null;
  return {
    version: 1, scopeId,
    source: { clientId: client?.id ?? null, sessionId: session?.id ?? subscription.lastSessionId,
      subscriptionId: subscription.id, mode: safeString(subscription.mode, subscription.semanticValueStates?.mode),
      adapterSet: safeString(client?.adapterSet, client?.semanticValueStates?.adapterSet),
      dataAdapter: safeString(subscription.dataAdapter, subscription.semanticValueStates?.dataAdapter),
      secondLevelDataAdapter: safeString(subscription.commandSecondLevelDataAdapter, subscription.semanticValueStates?.commandSecondLevelDataAdapter) },
    item,
    schema, secondLevelSchema,
    limitations: ["Configured fields do not establish application key or payload meaning; inspect application context and sampled Evidence.",
      ...(schema.basis === "declared-field-list" && (!secondLevelSchema || secondLevelSchema.basis === "declared-field-list") ? [] : ["Resolved field names are unavailable for at least one schema. A named server schema or observed payload name is not a declared field list; inspect the application Subscription setup or schema mapping before field predicates."])]
  };
}

function describeFields(list: readonly string[] | undefined, name: string | null | undefined, listState: EventSemanticValueState | undefined, nameState: EventSemanticValueState | undefined, options: AgentScopeOptions) {
  const declared = available(listState) ? list : undefined;
  const schemaName = safeString(name, nameState);
  const offset = options.fieldOffset ?? 0;
  const limit = options.fieldLimit ?? 32;
  const fields = declared?.slice(offset, offset + limit) ?? [];
  return { basis: declared ? "declared-field-list" : schemaName ? "named-field-schema" : "unavailable",
    name: schemaName, fields, totalFields: declared?.length ?? null, offset,
    nextOffset: declared && offset + fields.length < declared.length ? offset + fields.length : null };
}

function available(state?: EventSemanticValueState): boolean {
  return !state || !["unknown", "unavailable", "redacted", "not-applicable"].includes(state.state);
}
function safeString(value: string | null | undefined, state?: EventSemanticValueState): string | null {
  return available(state) && typeof value === "string" ? value : null;
}
