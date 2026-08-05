import { useLayoutEffect, useRef, type JSX } from "react";

import { type WorkbenchCommandProjection, type WorkbenchSnapshot } from "../workbench-runtime";

type CommandProjectionComparisonProps = Readonly<{
  scope: string;
  capture: WorkbenchSnapshot["capture"];
  projections: WorkbenchSnapshot["commandProjections"];
  onBack(): void;
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

/** Promoted, scope-preserving comparison of the two COMMAND projections. */
export function CommandProjectionComparison({
  scope,
  capture,
  projections,
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
      <button type="button" onClick={onRevealEvidence}>Reveal Evidence</button>
    </section>
    <footer>{projections.authoritativeLimit}</footer>
  </section>;
}
