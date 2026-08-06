import { useLayoutEffect, useRef, type JSX, type RefObject } from "react";

import { type WorkbenchCommandProjection, type WorkbenchSnapshot } from "../workbench-runtime";

type CommandProjectionComparisonProps = Readonly<{
  scope: string;
  capture: WorkbenchSnapshot["capture"];
  projections: WorkbenchSnapshot["commandProjections"];
  hasSupportingLocalEvidence: boolean;
  onBack(): void;
  onRevealEvidence(): void;
}>;

type CommandProjectionContextSummaryProps = Readonly<{
  projections: WorkbenchSnapshot["commandProjections"];
  hasSupportingLocalEvidence: boolean;
  compareButtonRef: RefObject<HTMLButtonElement | null>;
  onCompare(): void;
  onRevealEvidence(): void;
}>;

function sameRows(
  left: WorkbenchCommandProjection,
  right: WorkbenchCommandProjection
): boolean {
  return left.rows.length === right.rows.length && left.rows.every(
    ([key, value], index) => right.rows[index]?.[0] === key && right.rows[index]?.[1] === value
  );
}

function ProjectionColumn({ projection }: Readonly<{ projection: WorkbenchCommandProjection }>): JSX.Element {
  return <section className="workbench-react__projection-column" aria-label={projection.name}>
    <header>
      <h2>{projection.name}</h2>
      <p>{projection.basis}</p>
    </header>
    {projection.rows.length ? <dl>
      {projection.rows.flatMap(([key, value]) => [
        <dt key={`${key}-term`}>{key}</dt>,
        <dd key={`${key}-value`}><code>{value}</code></dd>
      ])}
    </dl> : <p className="workbench-react__projection-empty">No reconstructed rows are available for the current Scope.</p>}
  </section>;
}

/** Runtime-object Context treatment that keeps both projection contracts without duplicating matching rows. */
export function CommandProjectionContextSummary({
  projections,
  hasSupportingLocalEvidence,
  compareButtonRef,
  onCompare,
  onRevealEvidence
}: CommandProjectionContextSummaryProps): JSX.Element {
  const matching = sameRows(projections.observed, projections.localEffective);
  return <section className="workbench-react__projection-summary" aria-label="COMMAND projection summary">
    <div className="workbench-react__projection-bases">
      <section aria-label={projections.observed.name}>
        <h3>{projections.observed.name}</h3>
        <p>{projections.observed.basis}</p>
      </section>
      <section aria-label={projections.localEffective.name}>
        <h3>{projections.localEffective.name}</h3>
        <p>{projections.localEffective.basis}</p>
      </section>
    </div>
    <p className="workbench-react__projection-summary-state">
      <strong>{matching ? "Matching projections" : "Projections differ"}</strong>
      <span>{matching
        ? "Both named projections currently contain the same state; their evidence bases remain distinct."
        : hasSupportingLocalEvidence
          ? "A successful Local Injected Update contributes to Local Effective COMMAND State only."
          : "The available captured evidence produces different projection state."
      }</span>
    </p>
    <p className="workbench-react__projection-limit">{projections.authoritativeLimit}</p>
    <div className="workbench-react__context-actions">
      <button ref={compareButtonRef} type="button" onClick={onCompare}>Compare COMMAND projections</button>
      {!matching && hasSupportingLocalEvidence
        ? <button type="button" onClick={onRevealEvidence}>Reveal supporting Evidence</button>
        : null}
    </div>
  </section>;
}

/** Promoted, scope-preserving comparison of the two COMMAND projections. */
export function CommandProjectionComparison({
  scope,
  capture,
  projections,
  hasSupportingLocalEvidence,
  onBack,
  onRevealEvidence
}: CommandProjectionComparisonProps): JSX.Element {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const matching = sameRows(projections.observed, projections.localEffective);

  useLayoutEffect(() => {
    headingRef.current?.focus();
  }, []);

  return <section className="workbench-react__projection-document" aria-label="COMMAND projection comparison">
    <header className="workbench-react__pane-header">
      <div>
        <span className="workbench-react__eyebrow">COMMAND projection comparison</span>
        <h1 ref={headingRef} tabIndex={-1}>{scope}</h1>
      </div>
      <button type="button" onClick={onBack}>Back to Evidence</button>
    </header>
    {capture.coverage !== "USEFUL" ? <p className="workbench-react__projection-limit" role="note">
      Capture Coverage {capture.coverage}. {capture.detail ?? "Observed Server COMMAND State may be incomplete."}
    </p> : null}
    <p className="workbench-react__projection-shallow-summary">
      Comparing {projections.observed.name} with {projections.localEffective.name}.
    </p>
    <div className="workbench-react__projection-columns" tabIndex={0} aria-label="COMMAND projection rows">
      <ProjectionColumn projection={projections.observed} />
      <ProjectionColumn projection={projections.localEffective} />
    </div>
    <section className="workbench-react__projection-explanation" aria-label="Projection comparison explanation">
      <strong>{matching ? "Why matching?" : "Why different?"}</strong>
      <span>{matching
        ? "Both projections contain the same contributing state for the current Scope."
        : "Successful Local Injected Updates advance Local Effective COMMAND State only; Observed Server COMMAND State remains Server-only."}
      </span>
      {hasSupportingLocalEvidence
        ? <button type="button" onClick={onRevealEvidence}>Reveal Evidence</button>
        : null}
    </section>
    <footer>{projections.authoritativeLimit}</footer>
  </section>;
}
