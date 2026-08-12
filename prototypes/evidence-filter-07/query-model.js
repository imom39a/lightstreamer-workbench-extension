// PROTOTYPE — pure integrated Evidence query and Filter mutation model.

export const FACETS = Object.freeze([
  "client",
  "session",
  "subscription",
  "mode",
  "kind",
  "item",
  "listener",
  "key",
  "operation",
  "phase",
  "provenance",
  "observationPath"
]);

export const FACET_LABELS = Object.freeze({
  client: "Client",
  session: "Session",
  subscription: "Subscription",
  mode: "Subscription mode",
  kind: "Evidence kind",
  item: "Item",
  listener: "Listener",
  key: "COMMAND key",
  operation: "COMMAND operation",
  phase: "Update phase",
  provenance: "Provenance",
  observationPath: "Observation path"
});

export function typedValue(facet, type, value, label = String(value)) {
  return Object.freeze({
    facet,
    type,
    value,
    label,
    identity: JSON.stringify(["v1", facet, type, value])
  });
}

function eventFacetValues(sequence, kind, subscription, mode, item, listener, key, operation, phase, provenance, observationPath) {
  const client = typedValue("client", "client", "client-main", "Client client-main");
  const session = typedValue("session", "session", "session-9f2a", "Session session-9f2a");
  return Object.freeze({
    client,
    session,
    ...(subscription ? { subscription: typedValue("subscription", "subscription", subscription, `Subscription ${subscription}`) } : {}),
    ...(mode ? { mode: typedValue("mode", "enum", mode, mode) } : {}),
    kind: typedValue("kind", "enum", kind, titleCase(kind)),
    ...(item ? { item: typedValue("item", "item", `${subscription}:${item}`, item) } : {}),
    ...(listener ? { listener: typedValue("listener", "listener", listener, `Listener ${listener}`) } : {}),
    ...(key ? { key: typedValue("key", "string", key, key) } : {}),
    ...(operation ? { operation: typedValue("operation", "enum", operation, operation) } : {}),
    ...(phase ? { phase: typedValue("phase", "enum", phase, titleCase(phase)) } : {}),
    ...(provenance ? { provenance: typedValue("provenance", "enum", provenance, provenance) } : {}),
    ...(observationPath ? { observationPath: typedValue("observationPath", "enum", observationPath, titleCase(observationPath)) } : {})
  });
}

export function createEvidenceFixture(count = 10_000) {
  const baseTime = Date.UTC(2026, 7, 12, 18, 0, 0);
  let commandKeyOrdinal = 0;
  return Object.freeze(Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    const status = sequence % 97 === 0;
    const delivery = !status && sequence % 41 === 0;
    const subscription = status ? null : sequence <= 120 ? "sub-retired-0" : sequence % 5 === 0 ? "sub-merge-2" : "sub-command-1";
    const mode = status ? null : subscription === "sub-merge-2" ? "MERGE" : "COMMAND";
    const kind = status ? "session-status" : delivery ? "update-delivery" : "item-update";
    const item = status ? null : subscription === "sub-retired-0" ? "orders.retired" : subscription === "sub-command-1" ? (sequence % 2 ? "orders.eu" : "orders.us") : "quotes.primary";
    const listener = delivery ? (sequence % 2 ? "listener-view" : "listener-metrics") : null;
    const operation = status || delivery || mode !== "COMMAND" ? null : sequence % 29 === 0 ? "DELETE" : sequence % 11 === 0 ? "ADD" : "UPDATE";
    const key = operation
      ? `order-${String(((commandKeyOrdinal++) % 3_842) + 1).padStart(5, "0")}`
      : null;
    const phase = status || delivery ? null : sequence <= 180 ? "SNAPSHOT" : "LIVE";
    const provenance = status || delivery ? null : sequence % 23 === 0 ? "LOCAL" : "SERVER";
    const observationPath = provenance === "SERVER" || delivery ? (sequence % 7 === 0 ? "WIRE" : "LISTENER") : null;
    const timestamp = baseTime + Math.floor(sequence / 2) * 7;
    const summary = status
      ? "Session connected and runtime lifecycle observed"
      : delivery
        ? `Update delivered to ${listener}`
        : `${item} ${key ?? "quote"} ${provenance === "LOCAL" ? "state mismatch after local test" : "state update"} qty ${(sequence * 13) % 500}`;
    const facets = eventFacetValues(sequence, kind, subscription, mode, item, listener, key, operation, phase, provenance, observationPath);
    return Object.freeze({
      intervalId: "H7",
      sequence,
      eventId: `event-${String(sequence).padStart(5, "0")}`,
      timestamp,
      kind,
      subscription,
      mode,
      item,
      listener,
      key,
      operation,
      phase,
      provenance,
      observationPath,
      summary,
      facets,
      searchText: [summary, kind, subscription, mode, item, listener, key, operation, phase, provenance, observationPath]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
    });
  }));
}

export function createFilter(revision = 1) {
  return Object.freeze({ revision, text: "", facets: Object.freeze({}), around: null, unsupported: Object.freeze([]) });
}

export function criterion(facet, polarity, value) {
  return Object.freeze({ id: `${facet}:${polarity}:${value.identity}`, facet, polarity, value });
}

export function mutateFilter(filter, command) {
  if (command.expectedRevision !== filter.revision) {
    return Object.freeze({ ok: false, problem: "STALE_FILTER_REVISION", filter });
  }
  let text = filter.text;
  let around = filter.around;
  let unsupported = [...filter.unsupported];
  const facets = {};
  for (const [facet, state] of Object.entries(filter.facets)) {
    facets[facet] = { include: [...state.include], exclude: [...state.exclude] };
  }
  for (const operation of command.operations) {
    if (operation.type === "reset") {
      text = "";
      around = null;
      unsupported = [];
      for (const key of Object.keys(facets)) delete facets[key];
      continue;
    }
    if (operation.type === "set-text") {
      text = operation.text.trim();
      continue;
    }
    if (operation.type === "set-around") {
      around = Object.freeze({ ...operation.around });
      continue;
    }
    if (operation.type === "remove-around") {
      around = null;
      continue;
    }
    if (operation.type === "add-unsupported") {
      unsupported = [...unsupported.filter((entry) => entry.id !== operation.entry.id), Object.freeze({ ...operation.entry })];
      continue;
    }
    if (operation.type === "remove-unsupported") {
      unsupported = unsupported.filter((entry) => entry.id !== operation.id);
      continue;
    }
    if (operation.type === "remove-criterion") {
      const current = facets[operation.facet];
      if (!current) continue;
      current.include = current.include.filter((entry) => entry.identity !== operation.value.identity);
      current.exclude = current.exclude.filter((entry) => entry.identity !== operation.value.identity);
      if (!current.include.length && !current.exclude.length) delete facets[operation.facet];
      continue;
    }
    if (operation.type === "set-polarity") {
      const current = facets[operation.facet] ?? { include: [], exclude: [] };
      current.include = current.include.filter((entry) => entry.identity !== operation.value.identity);
      current.exclude = current.exclude.filter((entry) => entry.identity !== operation.value.identity);
      if (operation.polarity === "include") current.include.push(operation.value);
      if (operation.polarity === "exclude") current.exclude.push(operation.value);
      current.include.sort(compareTypedValues);
      current.exclude.sort(compareTypedValues);
      if (current.include.length || current.exclude.length) facets[operation.facet] = current;
      else delete facets[operation.facet];
      continue;
    }
  }
  const frozenFacets = {};
  for (const [facet, state] of Object.entries(facets)) {
    frozenFacets[facet] = Object.freeze({ include: Object.freeze(state.include), exclude: Object.freeze(state.exclude) });
  }
  return Object.freeze({
    ok: true,
    filter: Object.freeze({
      revision: filter.revision + 1,
      text,
      facets: Object.freeze(frozenFacets),
      around,
      unsupported: Object.freeze(unsupported)
    })
  });
}

function scopeMatches(record, scope) {
  if (scope.kind === "page") return true;
  const value = record.facets[scope.facet];
  return Boolean(value && value.identity === scope.value.identity);
}

function criterionBlockers(record, filter) {
  const blockers = [];
  if (filter.unsupported.length) blockers.push(...filter.unsupported.map((entry) => entry.id));
  if (filter.text && !record.searchText.includes(filter.text.toLowerCase())) blockers.push("free-text");
  if (filter.around && (
    record.intervalId !== filter.around.intervalId ||
    !(record.timestamp >= filter.around.start && record.timestamp < filter.around.end)
  )) blockers.push("around-evidence");
  for (const [facet, state] of Object.entries(filter.facets)) {
    const value = record.facets[facet];
    if (state.include.length && (!value || !state.include.some((entry) => entry.identity === value.identity))) {
      blockers.push(`${facet}:include`);
    }
    if (value) {
      for (const excluded of state.exclude) {
        if (excluded.identity === value.identity) blockers.push(`${facet}:exclude:${excluded.identity}`);
      }
    }
  }
  return blockers;
}

function filterMatches(record, filter) {
  return criterionBlockers(record, filter).length === 0;
}

function withoutFacet(filter, facet) {
  const facets = { ...filter.facets };
  delete facets[facet];
  return Object.freeze({ ...filter, facets: Object.freeze(facets) });
}

function retainedRecords(records, history) {
  if (history.committedBoundary === null) return [];
  return records.filter((record) =>
    record.intervalId === history.intervalId &&
    record.sequence >= history.retainedFirstSequence &&
    record.sequence <= history.committedBoundary
  );
}

export function evaluateEvidenceQuery(records, request) {
  const retained = retainedRecords(records, request.history);
  const inScope = retained.filter((record) => scopeMatches(record, request.scope));
  const matching = inScope.filter((record) => filterMatches(record, request.filter));
  const newestFirst = [...matching].sort((left, right) => right.sequence - left.sequence);
  const offset = Math.max(0, request.page.offset ?? 0);
  const size = Math.max(1, Math.min(200, request.page.size ?? 60));
  const evidence = newestFirst.slice(offset, offset + size);
  const discoveries = Object.freeze((request.discover ?? []).map((discovery) =>
    discoverFacet(inScope, request.filter, discovery)
  ));
  const selected = request.lookup
    ? retained.find((record) => record.eventId === request.lookup.eventId) ?? null
    : null;
  const nearestMatching = selected
    ? nearestRecordBySequence(matching, selected.sequence)
    : null;
  const lookup = !request.lookup
    ? null
    : selected
      ? Object.freeze({
          state: "RETAINED",
          evidence: selected,
          inScope: scopeMatches(selected, request.scope),
          matchesFilter: scopeMatches(selected, request.scope) && filterMatches(selected, request.filter),
          blockingCriteria: Object.freeze(criterionBlockers(selected, request.filter)),
          nearestMatchingEventId: nearestMatching?.eventId ?? null
        })
      : Object.freeze({ state: "NOT_RETAINED", eventId: request.lookup.eventId });
  const findText = request.find?.text?.trim().toLowerCase() ?? "";
  const findRecords = findText ? newestFirst.filter((record) => record.searchText.includes(findText)) : [];
  const requestedCurrent = request.find?.currentEventId ?? null;
  const currentIndex = requestedCurrent ? findRecords.findIndex((record) => record.eventId === requestedCurrent) : -1;
  const requestedRecord = requestedCurrent
    ? retained.find((record) => record.eventId === requestedCurrent) ?? null
    : null;
  const nearestFindRecord = requestedRecord
    ? nearestRecordBySequence(findRecords, requestedRecord.sequence)
    : null;
  const effectiveIndex = findRecords.length
    ? (currentIndex >= 0
        ? currentIndex
        : nearestFindRecord
          ? findRecords.findIndex((record) => record.eventId === nearestFindRecord.eventId)
          : 0)
    : -1;
  const find = request.find
    ? Object.freeze({
        text: request.find.text,
        total: findRecords.length,
        currentOrdinal: effectiveIndex >= 0 ? effectiveIndex + 1 : null,
        currentEventId: effectiveIndex >= 0 ? findRecords[effectiveIndex].eventId : null,
        previousEventId: effectiveIndex >= 0 ? findRecords[(effectiveIndex - 1 + findRecords.length) % findRecords.length].eventId : null,
        nextEventId: effectiveIndex >= 0 ? findRecords[(effectiveIndex + 1) % findRecords.length].eventId : null
      })
    : null;
  return deepFreeze({
    readPoint: {
      intervalId: request.history.intervalId,
      committedBoundary: request.history.committedBoundary === null
        ? null
        : { intervalId: request.history.intervalId, sequence: request.history.committedBoundary, eventId: `event-${String(request.history.committedBoundary).padStart(5, "0")}` },
      retainedRange: retained.length
        ? { first: retained[0].sequence, last: retained.at(-1).sequence }
        : null,
      terminal: Boolean(request.history.terminal),
      terminalReason: request.history.terminalReason ?? null
    },
    evaluation: request.filter.unsupported.length ? "UNSUPPORTED_FILTER" : "COMPLETE",
    page: {
      evidence,
      nextOffset: offset + evidence.length < newestFirst.length ? offset + evidence.length : null
    },
    totals: { matching: matching.length, inScope: inScope.length },
    discoveries,
    lookup,
    find,
    telemetry: {
      retainedCount: retained.length,
      renderedCount: evidence.length,
      requestedDiscoveryCount: discoveries.length,
      maximumFacetPage: Math.max(0, ...discoveries.map((entry) => entry.values?.length ?? 0))
    }
  });
}

function discoverFacet(inScope, filter, discovery) {
  if (discovery.forceUnavailable) {
    return Object.freeze({
      facet: discovery.facet,
      state: "UNAVAILABLE",
      reason: discovery.forceUnavailable,
      baseEvidenceCount: null,
      values: Object.freeze([]),
      distinctTotal: null,
      nextOffset: null
    });
  }
  const baseFilter = withoutFacet(filter, discovery.facet);
  const base = inScope.filter((record) => filterMatches(record, baseFilter));
  const counts = new Map();
  for (const record of base) {
    const value = record.facets[discovery.facet];
    if (!value) continue;
    const existing = counts.get(value.identity);
    counts.set(value.identity, existing ? { value: existing.value, count: existing.count + 1 } : { value, count: 1 });
  }
  const active = filter.facets[discovery.facet];
  const activeValues = new Map();
  for (const value of [...(active?.include ?? []), ...(active?.exclude ?? [])]) {
    activeValues.set(value.identity, Object.freeze({ value, count: counts.get(value.identity)?.count ?? 0, pinned: true }));
  }
  const search = discovery.search?.trim().toLowerCase() ?? "";
  const ordered = [...counts.values()]
    .filter((entry) => !search || entry.value.label.toLowerCase().includes(search))
    .sort((left, right) => compareTypedValues(left.value, right.value));
  const offset = Math.max(0, discovery.offset ?? 0);
  const size = Math.max(1, Math.min(100, discovery.size ?? 50));
  const pageValues = ordered.slice(offset, offset + size);
  const values = [
    ...activeValues.values(),
    ...pageValues.filter((entry) => !activeValues.has(entry.value.identity)).map((entry) => Object.freeze({ ...entry }))
  ];
  let state = "AVAILABLE";
  let reason = null;
  if (base.length === 0) {
    state = "BASE_ZERO";
    reason = "NO_EVIDENCE_MATCHES_OTHER_CRITERIA";
  } else if (counts.size === 0) {
    state = "NO_CONCRETE_VALUES";
    reason = "FACET_NOT_OBSERVED_ON_BASE_EVIDENCE";
  }
  return Object.freeze({
    facet: discovery.facet,
    state,
    reason,
    baseEvidenceCount: base.length,
    values: Object.freeze(values),
    distinctTotal: ordered.length,
    nextOffset: offset + pageValues.length < ordered.length ? offset + pageValues.length : null
  });
}

function nearestRecordBySequence(records, sequence) {
  return records.reduce((best, record) => {
    if (!best) return record;
    const delta = Math.abs(record.sequence - sequence);
    const bestDelta = Math.abs(best.sequence - sequence);
    if (delta < bestDelta) return record;
    if (delta === bestDelta && record.sequence < best.sequence) return record;
    return best;
  }, null);
}

export function createMemoryAdapter(records, name = "memory") {
  const immutable = Object.freeze([...records]);
  let activeRecords = immutable;
  let control = createHistoryControl();
  return Object.freeze({
    storage: name,
    async query(request) {
      assertReadPointAvailable(control, request.history);
      return Object.freeze({
        ok: true,
        value: evaluateEvidenceQuery(activeRecords, {
          ...request,
          history: { ...request.history, terminal: control.terminal, terminalReason: control.terminalReason }
        })
      });
    },
    async clear() {
      if (control.terminal) throw historyProblem("HISTORY_TERMINAL", "Terminal History cannot be cleared or restarted.");
      activeRecords = Object.freeze([]);
      control = createHistoryControl({ intervalId: "H8", committedBoundary: null });
    },
    async reset(options = {}) {
      activeRecords = immutable;
      control = createHistoryControl(options);
    },
    async close() {}
  });
}

export async function createIndexedDbAdapter(records) {
  const name = `PROTOTYPE_evidence_filter_07_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const database = await openPrototypeDatabase(name);
  await writePrototypeRecords(database, records);
  return Object.freeze({
    storage: "indexeddb",
    async query(request) {
      return Object.freeze({ ok: true, value: await queryIndexedComposite(database, request) });
    },
    async clear() {
      await clearIndexedHistory(database);
    },
    async reset(options = {}) {
      await resetIndexedHistory(database, records, options);
    },
    async close() {
      database.close();
      indexedDB.deleteDatabase(name);
    }
  });
}

function createHistoryControl(options = {}) {
  return Object.freeze({
    key: "history",
    intervalId: options.intervalId ?? "H7",
    committedBoundary: options.committedBoundary === undefined ? 10_000 : options.committedBoundary,
    terminal: Boolean(options.terminal),
    terminalReason: options.terminalReason ?? null
  });
}

function historyProblem(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertReadPointAvailable(control, history) {
  if (!control || control.intervalId !== history.intervalId) {
    throw historyProblem("HISTORY_READ_POINT_UNAVAILABLE", "The requested History Interval is no longer available.");
  }
  if (history.committedBoundary === null) {
    if (control.committedBoundary !== null) {
      throw historyProblem("HISTORY_READ_POINT_UNAVAILABLE", "The requested empty boundary is not the current History boundary.");
    }
    return;
  }
  if (control.committedBoundary === null || history.committedBoundary > control.committedBoundary) {
    throw historyProblem("HISTORY_READ_POINT_UNAVAILABLE", "The requested committed Evidence boundary is unavailable.");
  }
}

async function queryIndexedComposite(database, request) {
  const transaction = database.transaction(["control", "evidence", "projections", "postings"], "readonly");
  const completion = transactionPromise(transaction);
  const controlStore = transaction.objectStore("control");
  const evidenceStore = transaction.objectStore("evidence");
  const projectionStore = transaction.objectStore("projections");
  const postingStore = transaction.objectStore("postings");
  const stopKeepAlive = keepTransactionAlive(controlStore);
  const metrics = {
    enumeratedIdentityCount: 0,
    enumeratedProjectionCount: 0,
    enumeratedFacetValueCount: 0
  };
  try {
    const control = await requestPromise(controlStore.get("history"));
    assertReadPointAvailable(control, request.history);
    const effectiveRequest = {
      ...request,
      history: { ...request.history, terminal: control.terminal, terminalReason: control.terminalReason }
    };
    if (request.history.committedBoundary === null) {
      const empty = evaluateEvidenceQuery([], effectiveRequest);
      return deepFreeze({
        ...empty,
        readPoint: { ...empty.readPoint, terminalReason: control.terminalReason },
        telemetry: {
          ...empty.telemetry,
          plan: "INDEXED_COMPOSITE",
          hydratedPayloadCount: 0,
          ...metrics
        }
      });
    }

    const range = IDBKeyRange.bound(request.history.retainedFirstSequence, request.history.committedBoundary);
    const inScope = await indexedScopeSequences(postingStore, projectionStore, request.scope, range, metrics);
    const inScopeCount = inScope === null
      ? await requestPromise(projectionStore.count(range))
      : inScope.size;
    const matching = await indexedMatchingSequences({
      postingStore,
      projectionStore,
      range,
      scopeSequences: inScope,
      filter: request.filter,
      historyIntervalId: request.history.intervalId,
      metrics
    });
    const matchingCount = matching === null ? inScopeCount : matching.size;
    const pageSize = Math.max(1, Math.min(200, request.page.size ?? 60));
    const pageOffset = Math.max(0, request.page.offset ?? 0);
    const pageSequences = matching === null
      ? await cursorKeyPagePromise(projectionStore, range, pageOffset, pageSize)
      : [...matching].sort((left, right) => right - left).slice(pageOffset, pageOffset + pageSize);

    const lookupProjection = request.lookup
      ? await requestPromise(projectionStore.index("eventId").get(request.lookup.eventId))
      : null;
    const retainedLookupProjection = lookupProjection && range.includes(lookupProjection.sequence)
      ? lookupProjection
      : null;
    const find = request.find
      ? await indexedFindResult({
          postingStore,
          projectionStore,
          range,
          matching,
          find: request.find,
          metrics
        })
      : null;
    const discoveries = [];
    for (const discoveryRequest of request.discover ?? []) {
      if (discoveryRequest.forceUnavailable) {
        discoveries.push({
          facet: discoveryRequest.facet,
          state: "UNAVAILABLE",
          reason: discoveryRequest.forceUnavailable,
          baseEvidenceCount: null,
          values: [],
          distinctTotal: null,
          nextOffset: null
        });
        continue;
      }
      const base = await indexedMatchingSequences({
        postingStore,
        projectionStore,
        range,
        scopeSequences: inScope,
        filter: withoutFacet(request.filter, discoveryRequest.facet),
        historyIntervalId: request.history.intervalId,
        metrics
      });
      const baseCount = base === null ? inScopeCount : base.size;
      discoveries.push(await indexedFacetDiscovery({
        postingStore,
        range,
        base,
        baseCount,
        filter: request.filter,
        request: discoveryRequest,
        metrics
      }));
    }

    const payloadSequences = new Set(pageSequences);
    if (retainedLookupProjection) payloadSequences.add(retainedLookupProjection.sequence);
    const payloads = await Promise.all([...payloadSequences].map((sequence) => requestPromise(evidenceStore.get(sequence))));
    const payloadBySequence = new Map(payloads.map((record) => [record.sequence, toPublicEvidence(record)]));
    const pageEvidence = pageSequences.map((sequence) => payloadBySequence.get(sequence));
    const lookupEvidence = retainedLookupProjection
      ? payloadBySequence.get(retainedLookupProjection.sequence)
      : null;
    const lookup = !request.lookup
      ? null
      : lookupEvidence
        ? {
            state: "RETAINED",
            evidence: lookupEvidence,
            inScope: scopeMatches(lookupEvidence, request.scope),
            matchesFilter: scopeMatches(lookupEvidence, request.scope) && filterMatches(lookupEvidence, request.filter),
            blockingCriteria: criterionBlockers(lookupEvidence, request.filter),
            nearestMatchingEventId: nearestSequenceIdentity(matching, lookupEvidence.sequence)
          }
        : { state: "NOT_RETAINED", eventId: request.lookup.eventId };
    const first = await cursorKeyPromise(projectionStore, range, "next");
    const last = await cursorKeyPromise(projectionStore, range, "prev");

    return deepFreeze({
      readPoint: {
        ...indexedReadPoint(effectiveRequest.history, first, last),
        terminalReason: control.terminalReason
      },
      evaluation: request.filter.unsupported.length ? "UNSUPPORTED_FILTER" : "COMPLETE",
      page: {
        evidence: pageEvidence,
        nextOffset: pageOffset + pageEvidence.length < matchingCount ? pageOffset + pageEvidence.length : null
      },
      totals: { matching: matchingCount, inScope: inScopeCount },
      discoveries,
      lookup,
      find,
      telemetry: {
        retainedCount: inScopeCount,
        renderedCount: pageEvidence.length,
        requestedDiscoveryCount: discoveries.length,
        maximumFacetPage: Math.max(0, ...discoveries.map((entry) => entry.values?.length ?? 0)),
        plan: "INDEXED_COMPOSITE",
        hydratedPayloadCount: payloads.length,
        ...metrics
      }
    });
  } finally {
    stopKeepAlive();
    await completion;
  }
}

async function indexedScopeSequences(postingStore, projectionStore, scope, range, metrics) {
  if (scope.kind === "page") return null;
  const posting = await requestPromise(postingStore.get(scope.value.identity));
  const sequences = (posting?.sequences ?? []).filter((sequence) => range.includes(sequence));
  metrics.enumeratedIdentityCount += sequences.length;
  return new Set(sequences);
}

async function indexedMatchingSequences({ postingStore, projectionStore, range, scopeSequences, filter, historyIntervalId, metrics }) {
  if (filter.unsupported.length) return new Set();
  let current = scopeSequences === null ? null : new Set(scopeSequences);
  for (const facetState of Object.values(filter.facets)) {
    if (facetState.include.length) {
      const includeSets = await Promise.all(facetState.include.map((value) => postingSequenceSet(postingStore, value.identity, range, metrics)));
      const included = unionSets(includeSets);
      current = current === null ? included : intersectSets(current, included);
    }
    if (facetState.exclude.length) {
      const excludeSets = await Promise.all(facetState.exclude.map((value) => postingSequenceSet(postingStore, value.identity, range, metrics)));
      const excluded = unionSets(excludeSets);
      if (current === null) current = await allSequenceSet(projectionStore, range, metrics);
      for (const sequence of excluded) current.delete(sequence);
    }
  }
  if (filter.text) {
    const textMatches = await indexedSearchSequenceSet(postingStore, projectionStore, filter.text, range, metrics);
    current = current === null ? textMatches : intersectSets(current, textMatches);
  }
  if (filter.around) {
    let aroundMatches = new Set();
    if (filter.around.intervalId === historyIntervalId) {
      const timestampRange = IDBKeyRange.bound(
        [filter.around.start, 0],
        [filter.around.end, 0],
        false,
        true
      );
      const keys = await requestPromise(projectionStore.index("timestampSequence").getAllKeys(timestampRange));
      aroundMatches = new Set(keys.filter((sequence) => range.includes(sequence)));
      metrics.enumeratedIdentityCount += keys.length;
    }
    current = current === null ? aroundMatches : intersectSets(current, aroundMatches);
  }
  return current;
}

async function indexedSearchSequenceSet(postingStore, projectionStore, text, range, metrics) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  const grams = searchTokens(normalized);
  let candidates;
  if (grams.length) {
    const keySets = await Promise.all(grams.map(async (gram) => {
      const posting = await requestPromise(postingStore.get(`search:${gram}`));
      return new Set((posting?.sequences ?? []).filter((sequence) => range.includes(sequence)));
    }));
    candidates = keySets.some((set) => set.size === 0)
      ? await allSequenceSet(projectionStore, range, metrics)
      : keySets.length
        ? keySets.slice(1).reduce((set, next) => intersectSets(set, next), keySets[0])
        : new Set();
    metrics.enumeratedIdentityCount += keySets.reduce((sum, set) => sum + set.size, 0);
  } else {
    candidates = await allSequenceSet(projectionStore, range, metrics);
  }
  const projections = await Promise.all([...candidates].map((sequence) => requestPromise(projectionStore.get(sequence))));
  metrics.enumeratedProjectionCount += projections.length;
  return new Set(projections.filter((projection) => projection.searchText.includes(normalized)).map((projection) => projection.sequence));
}

async function indexedFindResult({ postingStore, projectionStore, range, matching, find, metrics }) {
  const text = find.text.trim();
  const searched = text ? await indexedSearchSequenceSet(postingStore, projectionStore, text, range, metrics) : new Set();
  const matches = matching === null ? searched : intersectSets(searched, matching);
  const ordered = [...matches].sort((left, right) => right - left);
  const currentProjection = find.currentEventId
    ? await requestPromise(projectionStore.index("eventId").get(find.currentEventId))
    : null;
  let index = currentProjection ? ordered.indexOf(currentProjection.sequence) : -1;
  if (index < 0 && ordered.length) {
    const anchorSequence = currentProjection?.sequence ?? ordered[0];
    const nearest = nearestSequence(ordered, anchorSequence);
    index = ordered.indexOf(nearest);
  }
  return {
    text: find.text,
    total: ordered.length,
    currentOrdinal: index >= 0 ? index + 1 : null,
    currentEventId: index >= 0 ? eventIdentity(ordered[index]) : null,
    previousEventId: index >= 0 ? eventIdentity(ordered[(index - 1 + ordered.length) % ordered.length]) : null,
    nextEventId: index >= 0 ? eventIdentity(ordered[(index + 1) % ordered.length]) : null
  };
}

async function indexedFacetDiscovery({ postingStore, range, base, baseCount, filter, request, metrics }) {
  const postings = await requestPromise(postingStore.index("facet").getAll(IDBKeyRange.only(request.facet)));
  metrics.enumeratedFacetValueCount += postings.length;
  const counts = new Map();
  for (const posting of postings) {
    let count = 0;
    for (const sequence of posting.sequences) {
      if (range.includes(sequence) && (base === null || base.has(sequence))) count += 1;
    }
    if (count) counts.set(posting.identity, { value: posting.value, count });
  }
  return formatDiscovery(counts, baseCount, filter, request);
}

function formatDiscovery(counts, baseCount, filter, request) {
  const active = filter.facets[request.facet];
  const activeValues = new Map();
  for (const value of [...(active?.include ?? []), ...(active?.exclude ?? [])]) {
    activeValues.set(value.identity, { value, count: counts.get(value.identity)?.count ?? 0, pinned: true });
  }
  const search = request.search?.trim().toLowerCase() ?? "";
  const ordered = [...counts.values()]
    .filter((entry) => !search || entry.value.label.toLowerCase().includes(search))
    .sort((left, right) => compareTypedValues(left.value, right.value));
  const offset = Math.max(0, request.offset ?? 0);
  const size = Math.max(1, Math.min(100, request.size ?? 50));
  const page = ordered.slice(offset, offset + size);
  const values = [...activeValues.values(), ...page.filter((entry) => !activeValues.has(entry.value.identity))];
  return {
    facet: request.facet,
    state: baseCount === 0 ? "BASE_ZERO" : counts.size === 0 ? "NO_CONCRETE_VALUES" : "AVAILABLE",
    reason: baseCount === 0
      ? "NO_EVIDENCE_MATCHES_OTHER_CRITERIA"
      : counts.size === 0
        ? "FACET_NOT_OBSERVED_ON_BASE_EVIDENCE"
        : null,
    baseEvidenceCount: baseCount,
    values,
    distinctTotal: ordered.length,
    nextOffset: offset + page.length < ordered.length ? offset + page.length : null
  };
}

async function postingSequenceSet(store, identity, range, metrics) {
  const posting = await requestPromise(store.get(identity));
  const sequences = (posting?.sequences ?? []).filter((sequence) => range.includes(sequence));
  metrics.enumeratedIdentityCount += sequences.length;
  return new Set(sequences);
}

async function allSequenceSet(store, range, metrics) {
  const keys = await requestPromise(store.getAllKeys(range));
  metrics.enumeratedIdentityCount += keys.length;
  return new Set(keys);
}

function unionSets(sets) {
  return new Set(sets.flatMap((set) => [...set]));
}

function intersectSets(left, right) {
  const output = new Set();
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const value of small) if (large.has(value)) output.add(value);
  return output;
}

function nearestSequence(sequences, anchor) {
  return sequences.reduce((best, sequence) => {
    if (best === null) return sequence;
    const delta = Math.abs(sequence - anchor);
    const bestDelta = Math.abs(best - anchor);
    return delta < bestDelta || (delta === bestDelta && sequence < best) ? sequence : best;
  }, null);
}

function nearestSequenceIdentity(sequences, anchor) {
  if (sequences === null) return eventIdentity(anchor);
  const nearest = nearestSequence([...sequences], anchor);
  return nearest === null ? null : eventIdentity(nearest);
}

function eventIdentity(sequence) {
  return `event-${String(sequence).padStart(5, "0")}`;
}

function searchTokens(text) {
  return [...new Set(text.toLowerCase().match(/[a-z]{3,}/g) ?? [])];
}

function toPublicEvidence(record) {
  if (!record) return record;
  const { facetTokens: _facetTokens, ...evidence } = record;
  return evidence;
}

function keepTransactionAlive(store) {
  let active = true;
  const pump = () => {
    if (!active) return;
    const request = store.get("__keepalive__");
    request.onsuccess = pump;
    request.onerror = pump;
  };
  pump();
  return () => { active = false; };
}

async function clearIndexedHistory(database) {
  const read = database.transaction("control", "readonly");
  const control = await requestPromise(read.objectStore("control").get("history"));
  await transactionPromise(read);
  if (control?.terminal) throw historyProblem("HISTORY_TERMINAL", "Terminal History cannot be cleared or restarted.");
  const transaction = database.transaction(["control", "evidence", "projections", "postings"], "readwrite");
  transaction.objectStore("evidence").clear();
  transaction.objectStore("projections").clear();
  transaction.objectStore("postings").clear();
  transaction.objectStore("control").put(createHistoryControl({ intervalId: "H8", committedBoundary: null }));
  await transactionPromise(transaction);
}

async function resetIndexedHistory(database, records, options = {}) {
  const read = database.transaction(["control", "evidence"], "readonly");
  const controlPromise = requestPromise(read.objectStore("control").get("history"));
  const countPromise = requestPromise(read.objectStore("evidence").count());
  const [control, count] = await Promise.all([controlPromise, countPromise]);
  await transactionPromise(read);
  if (control?.intervalId === "H7" && count === records.length) {
    const update = database.transaction("control", "readwrite");
    update.objectStore("control").put(createHistoryControl(options));
    await transactionPromise(update);
    return;
  }
  await writePrototypeRecords(database, records, options);
}

function indexedReadPoint(history, first, last) {
  return {
    intervalId: history.intervalId,
    committedBoundary: history.committedBoundary === null
      ? null
      : { intervalId: history.intervalId, sequence: history.committedBoundary, eventId: `event-${String(history.committedBoundary).padStart(5, "0")}` },
    retainedRange: first === null ? null : { first, last },
    terminal: Boolean(history.terminal),
    terminalReason: history.terminalReason ?? null
  };
}

function cursorKeyPromise(store, range, direction) {
  return new Promise((resolve, reject) => {
    const request = store.openKeyCursor(range, direction);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.key ?? null);
  });
}

function cursorPagePromise(store, range, requestedOffset, size) {
  const offset = Math.max(0, requestedOffset);
  return new Promise((resolve, reject) => {
    const values = [];
    let skipped = 0;
    const request = store.openCursor(range, "prev");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || values.length >= size) {
        resolve(values);
        return;
      }
      if (skipped < offset) skipped += 1;
      else values.push(cursor.value);
      cursor.continue();
    };
  });
}

function cursorKeyPagePromise(store, range, requestedOffset, size) {
  const offset = Math.max(0, requestedOffset);
  return new Promise((resolve, reject) => {
    const keys = [];
    let skipped = 0;
    const request = store.openKeyCursor(range, "prev");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || keys.length >= size) {
        resolve(keys);
        return;
      }
      if (skipped < offset) skipped += 1;
      else keys.push(cursor.key);
      cursor.continue();
    };
  });
}

async function postingSequencesPromise(store, identity, sequenceRange) {
  const posting = await requestPromise(store.get(identity));
  return (posting?.sequences ?? []).filter((sequence) => sequenceRange.includes(sequence));
}

function storePrimaryKeysPromise(store, range) {
  return new Promise((resolve, reject) => {
    const keys = [];
    const request = store.openKeyCursor(range, "next");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(keys);
        return;
      }
      keys.push(cursor.key);
      cursor.continue();
    };
  });
}

async function openPrototypeDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const evidence = database.createObjectStore("evidence", { keyPath: "sequence" });
      evidence.createIndex("eventId", "eventId", { unique: true });
      evidence.createIndex("facetTokens", "facetTokens", { multiEntry: true });
      evidence.createIndex("timestampSequence", ["timestamp", "sequence"], { unique: true });
      const projections = database.createObjectStore("projections", { keyPath: "sequence" });
      projections.createIndex("eventId", "eventId", { unique: true });
      projections.createIndex("timestampSequence", ["timestamp", "sequence"], { unique: true });
      const postings = database.createObjectStore("postings", { keyPath: "identity" });
      postings.createIndex("facet", "facet", { unique: false });
      database.createObjectStore("control", { keyPath: "key" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function writePrototypeRecords(database, records, controlOptions = {}) {
  const transaction = database.transaction(["control", "evidence", "projections", "postings"], "readwrite");
  const store = transaction.objectStore("evidence");
  const projectionStore = transaction.objectStore("projections");
  const postingsStore = transaction.objectStore("postings");
  store.clear();
  projectionStore.clear();
  postingsStore.clear();
  transaction.objectStore("control").put(createHistoryControl(controlOptions));
  const postings = new Map();
  for (const record of records) {
    const facetTokens = Object.values(record.facets).map((value) => value.identity);
    store.put({ ...record, facetTokens });
    projectionStore.put({
      intervalId: record.intervalId,
      sequence: record.sequence,
      eventId: record.eventId,
      timestamp: record.timestamp,
      searchText: record.searchText,
      facets: record.facets
    });
    for (const [facet, value] of Object.entries(record.facets)) {
      const posting = postings.get(value.identity) ?? { identity: value.identity, facet, value, sequences: [] };
      posting.sequences.push(record.sequence);
      postings.set(value.identity, posting);
    }
    for (const token of searchTokens(record.searchText)) {
      const identity = `search:${token}`;
      const posting = postings.get(identity) ?? { identity, facet: "__search", value: null, sequences: [] };
      posting.sequences.push(record.sequence);
      postings.set(identity, posting);
    }
  }
  for (const posting of postings.values()) postingsStore.put(posting);
  await transactionPromise(transaction);
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function normalizeSnapshot(snapshot) {
  return canonicalValue({
    readPoint: snapshot.readPoint,
    evaluation: snapshot.evaluation,
    page: {
      evidence: snapshot.page.evidence.map((record) => toPublicEvidence(record)),
      nextOffset: snapshot.page.nextOffset
    },
    totals: snapshot.totals,
    discoveries: snapshot.discoveries,
    lookup: snapshot.lookup
      ? snapshot.lookup.state === "RETAINED"
        ? {
            ...snapshot.lookup,
            evidence: toPublicEvidence(snapshot.lookup.evidence)
          }
        : snapshot.lookup
      : null,
    find: snapshot.find
  });
}

export function snapshotDigest(snapshot) {
  const text = JSON.stringify(normalizeSnapshot(snapshot));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function runAdapterParity(memory, indexeddb, cases) {
  const results = [];
  for (const testCase of cases) {
    const [memoryResult, indexedResult] = await Promise.all([
      memory.query(testCase.request),
      indexeddb.query(testCase.request)
    ]);
    const memoryDigest = snapshotDigest(memoryResult.value);
    const indexedDigest = snapshotDigest(indexedResult.value);
    const memorySnapshot = normalizeSnapshot(memoryResult.value);
    const indexedSnapshot = normalizeSnapshot(indexedResult.value);
    const exactEqual = JSON.stringify(memorySnapshot) === JSON.stringify(indexedSnapshot);
    results.push(Object.freeze({
      name: testCase.name,
      memoryDigest,
      indexedDigest,
      equal: exactEqual,
      comparison: "DEEP_PUBLIC_SNAPSHOT",
      difference: exactEqual ? null : firstDifference(memorySnapshot, indexedSnapshot)
    }));
  }
  return Object.freeze(results);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function firstDifference(left, right, path = "snapshot") {
  if (Object.is(left, right)) return null;
  if (typeof left !== typeof right || left === null || right === null) return { path, memory: left, indexeddb: right };
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return { path, memory: left, indexeddb: right };
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (typeof left === "object") {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const difference = firstDifference(left[key], right[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return { path, memory: left, indexeddb: right };
}

function compareTypedValues(left, right) {
  return left.identity.localeCompare(right.identity);
}

function titleCase(value) {
  return String(value).replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
