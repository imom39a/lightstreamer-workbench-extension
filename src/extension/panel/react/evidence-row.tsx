import { memo, useRef, type JSX } from "react";

import type { WorkbenchSnapshot } from "../workbench-runtime";
import type { LightstreamerEventEnvelope } from "../../../core/event-envelope";
import { EVIDENCE_CODE_DEFINITIONS, evidenceStreamPresentation } from "../evidence-stream-presentation";

export type EvidenceRowActions = { select(eventId: string): void };

export type EvidencePayloadMode = "readable" | "raw";

const evidenceCodeDefinitionByCode = new Map(EVIDENCE_CODE_DEFINITIONS.map((definition) => [definition.code, definition]));

export function EvidenceCodes({
  open,
  onOpenChange
}: Readonly<{
  open: boolean;
  onOpenChange(open: boolean): void;
}>): JSX.Element {
  const trigger = useRef<HTMLElement>(null);
  const close = () => {
    onOpenChange(false);
    window.requestAnimationFrame(() => trigger.current?.focus());
  };
  const definitionsFor = (family: "tlcp" | "workbench") => EVIDENCE_CODE_DEFINITIONS.filter((definition) => definition.family === family);
  return <details
    className="workbench-react__evidence-codes"
    open={open}
    onToggle={(event) => onOpenChange(event.currentTarget.open)}
    onKeyDown={(event) => {
      if (event.key !== "Escape" || !open) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }}
  >
    <summary ref={trigger} aria-label="Codes">Codes</summary>
    <section role="dialog" aria-label="Evidence codes" aria-modal="false">
      <header><strong>Evidence codes</strong><button type="button" onClick={close}>Close</button></header>
      <p>Operations shown in the Evidence stream.</p>
      {(["tlcp", "workbench"] as const).map((family) => <section key={family} aria-label={family === "tlcp" ? "Lightstreamer TLCP" : "Workbench capture lifecycle"}>
        <h3>{family === "tlcp" ? "Lightstreamer TLCP" : "Workbench capture lifecycle"}</h3>
        <dl>{definitionsFor(family).map((definition) => <div key={definition.code}>
          <dt>{definition.code}</dt><dd><strong>{definition.label}</strong> · {definition.description}</dd>
        </div>)}</dl>
      </section>)}
      <p className="workbench-react__evidence-code-notes"><code>U</code> marks an update; <code>ADD</code> and <code>DELETE</code> mark COMMAND operations; <code>S</code> marks a snapshot. <strong>LOCAL</strong> is a Local injection; <code>R</code> is runtime Evidence and <code>W</code> is Workbench Evidence.</p>
    </section>
  </details>;
}

export function FindText({ text, query }: { text: string; query: string }): JSX.Element {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return <>{text}</>;
  const expression = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const parts = text.split(new RegExp(`(${expression})`, "giu"));
  return <>{parts.map((part, index) => index % 2 ? <mark className="workbench-react__search-hit" key={index}>{part}</mark> : part)}</>;
}

export const EvidenceRow = memo(function EvidenceRow({
  event,
  selected,
  findPosition,
  findQuery,
  rowRefs,
  actionsRef,
  payloadMode
}: {
  event: WorkbenchSnapshot["evidence"]["events"][number];
  selected: boolean;
  findPosition: string | null;
  findQuery: string;
  rowRefs: { current: Map<string, HTMLButtonElement> };
  actionsRef: { current: EvidenceRowActions };
  payloadMode: EvidencePayloadMode;
}): JSX.Element {
  // Retained Evidence is canonical in production. Recovery envelopes can be incomplete;
  // render those honestly as an unknown operation instead of inventing an Item Update.
  const presentationEvent = typeof event.raw?.kind === "string"
    ? event
    : { ...event, raw: { ...event.raw, kind: "__unknown__" as LightstreamerEventEnvelope["kind"] } };
  const presentation = evidenceStreamPresentation(presentationEvent, payloadMode);
  const definition = evidenceCodeDefinitionByCode.get(presentation.code);
  const identity = presentation.identity ?? event.object;
  const qualifiers = [
    event.command === "ADD" || event.command === "DELETE" ? event.command : null,
    event.phase === "SNAPSHOT" ? "S" : null
  ].filter((value): value is string => value !== null);
  const provenance = event.source === "LOCAL" ? "LOCAL" : event.source === "RUNTIME" ? "R" : event.source === "WORKBENCH" ? "W" : null;
  const sequence = event.sequence === null ? "No retained sequence" : `retained sequence ${event.sequence}`;
  const dataSummary = presentation.previewTruncated
    ? "payload preview truncated; complete payload is in Context"
    : Object.keys(presentation.data.fields).length ? `payload fields ${Object.keys(presentation.data.fields).join(", ")}` : "no payload fields";
  const ariaLabel = `${event.id}; ${presentation.code}${definition ? ` ${definition.label}` : ""}; ${event.command ?? "no COMMAND operation"}; ${identity}; ${dataSummary}; ${event.source} Evidence; ${event.phase} phase; ${event.time}; ${sequence}.`;
  return (
    <button
      type="button"
      className="workbench-react__evidence-row"
      role="row"
      data-evidence-id={event.id}
      data-evidence-sequence={event.sequence ?? undefined}
      data-evidence-source={event.source}
      data-evidence-code={presentation.code}
      data-find-current={findPosition ? true : undefined}
      aria-selected={selected}
      aria-current={findPosition ? "true" : undefined}
      aria-label={ariaLabel}
      title={`${event.id} · ${event.kind} · ${event.source} · ${event.phase} · ${event.time} · ${sequence}`}
      tabIndex={-1}
      ref={(element) => {
        if (element) rowRefs.current.set(event.id, element);
        else rowRefs.current.delete(event.id);
      }}
      onClick={() => actionsRef.current.select(event.id)}
    >
      <span className="workbench-react__evidence-op" role="gridcell" title={definition?.description ?? presentation.code}>
        <b>{presentation.code}</b>{qualifiers.map((qualifier) => <small key={qualifier}>{qualifier}</small>)}{provenance ? <em>{provenance}</em> : null}{findPosition ? <small className="workbench-react__find-match" title={findPosition}>Find</small> : null}
      </span>
      <span className="workbench-react__evidence-key" role="gridcell" title={identity}><FindText text={identity} query={findQuery} /></span>
      <span className="workbench-react__evidence-data" role="gridcell" title={presentation.jsonString}>
        {presentation.data.decodedJsonFields.length ? <span className="workbench-react__json-string-marker">JSON string</span> : null}
        <code><FindText text={presentation.jsonString} query={findQuery} /></code>{presentation.previewTruncated ? <small>Preview truncated · complete payload in Context</small> : null}
      </span>
    </button>
  );
});
