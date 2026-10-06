type SchemaRecord = Record<string, unknown> & {
  type?: string | string[]; properties?: Record<string, SchemaRecord>;
  patternProperties?: Record<string, SchemaRecord>; required?: string[];
  enum?: unknown[]; oneOf?: SchemaRecord[]; anyOf?: SchemaRecord[];
  propertyNames?: SchemaRecord; additionalProperties?: boolean | SchemaRecord;
};

/** Intern repeated JSON Schema fragments within each independently resolvable
 * tool schema. Definitions are lazy, so only reachable fragments are shipped. */
export function compactAgentSchema<T extends object>(schema: T): T & { $defs?: Record<string, unknown> } {
  const grouped = groupEquivalentProperties(normalizeSchema(schema), true);
  const counts = countSchemaFragments(grouped);
  const { root, definitions } = internRepeatedSchemas(grouped, counts);
  const compact = optimizeSchema(Object.keys(definitions).length ? { ...root, $defs: definitions } : root);

  // Interning is optional. Keep the normalized and grouped representation unless the
  // complete independently resolvable graph becomes smaller when serialized.
  return JSON.stringify(compact).length < JSON.stringify(grouped).length ? compact as T & { $defs?: Record<string, unknown> } : grouped as T & { $defs?: Record<string, unknown> };
}

/** Count structurally identical objects before interning. Counts include all
 * object nodes, while only schema-shaped nodes are eligible for references. */
function countSchemaFragments(schema: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value)) {
      const key = JSON.stringify(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(schema);
  return counts;
}

/** Apply local schema simplifications and factor repeated properties shared by
 * object-union branches. Factoring is valid only when the complete candidate
 * serialization is shorter; branch key admission remains explicit. */
function normalizeSchema(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeSchema);
  const record = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeSchema(child)])) as SchemaRecord;
  if (Array.isArray(record.required) && record.required.length === 0) delete record.required;
  if (record.enum || Object.hasOwn(record, "const")) delete record.type;
  if (record.enum?.length === 1) { record.const = record.enum[0]; delete record.enum; }
  if (!Object.hasOwn(record, "type") && record.oneOf?.every(branch => Object.keys(branch).length === 1 && typeof branch.type === "string")) {
    const types = record.oneOf.map(branch => branch.type as string);
    // Integer values also satisfy number: oneOf excludes that intersection,
    // whereas a type array admits it. Only disjoint type choices can collapse.
    if (new Set(types).size === types.length && !(types.includes("number") && types.includes("integer"))) { record.type = types; delete record.oneOf; }
  }
  if (record.additionalProperties === true) delete record.additionalProperties;
  return factorSharedObjectUnion(record);
}

/** Move properties common to simple closed object-union branches to the parent.
 * Reconstructing branches cannot preserve additional applicators or object
 * constraints, so leave those unions intact rather than discard their rules.
 * The branch discriminator is a finite key-name enum, which preserves exact
 * acceptance even when an optional property's validator differs by branch. */
function factorSharedObjectUnion(record: SchemaRecord): SchemaRecord {
  const parentKeys = new Set(["type", "oneOf"]);
  const branchKeys = new Set(["type", "properties", "required", "additionalProperties"]);
  if ((record.oneOf?.length ?? 0) <= 1
    || (record.type !== undefined && record.type !== "object")
    || Object.keys(record).some(key => !parentKeys.has(key))
    || !record.oneOf!.every(branch => branch.type === "object" && branch.properties && branch.additionalProperties === false
      && Object.keys(branch).every(key => branchKeys.has(key)))) return record;
  const branches = record.oneOf!;
  const keys = [...new Set<string>(branches.flatMap(branch => Object.keys(branch.properties ?? {})))];
  const properties: Record<string, SchemaRecord> = {};
  const varying = new Set<string>();
  for (const key of keys) {
    const versions = [...new Map(branches.filter(branch => Object.hasOwn(branch.properties ?? {}, key)).map(branch => [JSON.stringify(branch.properties![key]), branch.properties![key]])).values()];
    if (versions.length === 1) properties[key] = versions[0];
    else { properties[key] = {}; varying.add(key); }
  }
  const required = (branches[0].required ?? []).filter(key => branches.every(branch => branch.required?.includes(key)));
  const factored = { type: "object", properties, required, additionalProperties: false, oneOf: branches.map(branch => ({
    properties: Object.fromEntries(Object.entries(branch.properties ?? {}).filter(([key]) => varying.has(key))),
    required: (branch.required ?? []).filter(key => !required.includes(key)),
    propertyNames: { enum: Object.keys(branch.properties ?? {}) }
  })) };
  return JSON.stringify(factored).length < JSON.stringify(record).length ? factored : record;
}

/** Group identical named validators below non-root objects. Escaping every key
 * and anchoring the pattern preserves finite property-name matching. */
function groupEquivalentProperties(value: unknown, root = false): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(entry => groupEquivalentProperties(entry));
  const record = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, groupEquivalentProperties(child)])) as SchemaRecord;
  if (!root && record.properties) {
    const groups = new Map<string, string[]>();
    for (const [key, child] of Object.entries(record.properties)) {
      const shape = JSON.stringify(child);
      groups.set(shape, [...(groups.get(shape) ?? []), key]);
    }
    for (const [shape, keys] of groups) {
      if (keys.length < 2) continue;
      const escapedKeys = keys.map(key => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const pattern = `^(${escapedKeys.join("|")})$`;
      const before = keys.reduce((total, key) => total + key.length + shape.length + 4, 0);
      if (pattern.length + shape.length + 25 >= before) continue;
      record.patternProperties ??= {};
      record.patternProperties[pattern] = JSON.parse(shape);
      for (const key of keys) delete record.properties[key];
    }
    if (!Object.keys(record.properties).length) delete record.properties;
  }
  return record;
}

/** Intern repeated schema nodes, then inline definitions whose final graph
 * references do not repay their serialized definition and reference cost. */
function internRepeatedSchemas(schema: unknown, counts: Map<string, number>): { root: Record<string, unknown>; definitions: Record<string, unknown> } {
  const names = new Map<string, string>();
  const definitions: Record<string, unknown> = {};
  const rewrite = (value: unknown, root = false): unknown => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(entry => rewrite(entry));
    const key = JSON.stringify(value);
    // Only schema objects can be referenced: property maps and arrays are not schemas.
    const isSchema = ["type", "oneOf", "anyOf", "enum", "const"].some(key => Object.hasOwn(value, key));
    if (!root && isSchema && key.length >= 40 && (counts.get(key) ?? 0) > 1) {
      let name = names.get(key);
      if (!name) {
        name = `s${names.size}`;
        names.set(key, name);
        definitions[name] = rewrite(value, true);
      }
      return { $ref: `#/$defs/${name}` };
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
  };
  const root = rewrite(schema, true) as Record<string, unknown>;
  inlineUnprofitableDefinitions(root, definitions);
  return { root, definitions };
}

/** Count references across root and definitions. Inline one-use or non-saving
 * definitions; repeat until parent inlining cannot expose another such node. */
function inlineUnprofitableDefinitions(root: Record<string, unknown>, definitions: Record<string, unknown>): void {
  const referenceCounts = (): Map<string, number> => {
    const counts = new Map<string, number>();
    const scan = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (!Array.isArray(value) && "$ref" in value && typeof value.$ref === "string") counts.set(value.$ref, (counts.get(value.$ref) ?? 0) + 1);
      for (const child of Object.values(value)) scan(child);
    };
    scan(root); scan(definitions);
    return counts;
  };
  for (;;) {
    const counts = referenceCounts();
    const entry = Object.entries(definitions).find(([name, definition]) => {
      const uses = counts.get(`#/$defs/${name}`) ?? 0;
      const size = JSON.stringify(definition).length;
      return uses < 2 || (uses - 1) * size <= uses * JSON.stringify({ $ref: `#/$defs/${name}` }).length + name.length + 4;
    });
    if (!entry) return;
    const [name, definition] = entry;
    const inline = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      for (const [key, child] of Object.entries(record)) {
        if (child && typeof child === "object" && "$ref" in child && child.$ref === `#/$defs/${name}`) record[key] = definition;
        else inline(child);
      }
    };
    inline(root); inline(definitions); delete definitions[name];
  }
}

/** Apply semantics-preserving compact encodings. Nullable unions are rewritten
 * only for plain typed branches; applicators such as `not` and `if` stay intact.
 * Finite closed-object guards may use cardinality or forbidden-key complements
 * only where the equivalent condition is explicit in the source union. */
function optimizeSchema(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(entry => optimizeSchema(entry, depth));
  let record = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, optimizeSchema(child, depth + 1)])) as SchemaRecord;
  record = compactNullableTypedUnion(record);
  compactFiniteClosedObjectGuards(record);
  if (!record.required?.length) delete record.required;
  if (record.properties && !Object.keys(record.properties).length && depth > 0) delete record.properties;
  return record;
}

/** JSON Schema's typed keywords ignore null, so a plain typed nullable union
 * can use a type array. General applicators are excluded because they may reject null. */
function compactNullableTypedUnion(record: SchemaRecord): SchemaRecord {
  if (Object.hasOwn(record, "type")) return record;
  const union = record.oneOf ?? record.anyOf;
  if (union?.length !== 2 || !union.some(branch => branch.type === "null" && Object.keys(branch).length === 1)) return record;
  const branch = union.find(branch => branch.type !== "null")!;
  if (typeof branch.type !== "string" || branch.enum || Object.hasOwn(branch, "const") || branch.oneOf || branch.anyOf || Object.hasOwn(branch, "allOf") || Object.hasOwn(branch, "not") || Object.hasOwn(branch, "if")) return record;
  const next = { ...record, ...branch, type: [branch.type, "null"] };
  delete next.oneOf; delete next.anyOf;
  return JSON.stringify(next).length < JSON.stringify(record).length ? next : record;
}

/** Replace verbose required/complement guards only for finite key sets emitted
 * by the object-union factoring pass. */
function compactFiniteClosedObjectGuards(record: SchemaRecord): void {
  if (record.type !== "object" || record.additionalProperties !== false) return;
  const patterns = Object.keys(record.patternProperties ?? {});
  const finitePatterns = patterns.every(pattern => /^\^\([A-Za-z0-9_|-]+\)\$$/.test(pattern));
  const keys = [...Object.keys(record.properties ?? {}), ...patterns.flatMap(pattern => pattern.slice(2, -2).split("|"))];
  if (finitePatterns && record.required?.length === keys.length && keys.every(key => record.required!.includes(key))) {
    const minimum = typeof record.minProperties === "number" ? Math.max(record.minProperties, keys.length) : keys.length;
    const next: Record<string, unknown> = { ...record, minProperties: minimum }; delete next.required;
    if (JSON.stringify(next).length < JSON.stringify(record).length) { Object.assign(record, next); delete record.required; }
  }
  if (finitePatterns && record.oneOf && keys.length) record.oneOf = record.oneOf.map(branch => {
    if (!branch.propertyNames?.enum) return branch;
    const forbidden = keys.filter(key => !branch.propertyNames!.enum!.includes(key));
    const next = { ...branch };
    if (!forbidden.length) delete next.propertyNames;
    else next.propertyNames = { not: forbidden.length === 1 ? { const: forbidden[0] } : { enum: forbidden } };
    if (!next.required?.length) delete next.required;
    if (next.properties && !Object.keys(next.properties).length) delete next.properties;
    return JSON.stringify(next).length < JSON.stringify(branch).length ? next : branch;
  });
}
