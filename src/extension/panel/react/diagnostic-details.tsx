import type { JSX } from "react";
import type { WorkbenchDiagnostic } from "../workbench-runtime";

type Props = Readonly<{
  diagnostic: WorkbenchDiagnostic;
  compact: boolean;
  onInspect(): void;
}>;

/** The condition stays visible; technical causes and recovery share one native disclosure. */
export function DiagnosticDetails({ diagnostic, compact, onInspect }: Props): JSX.Element {
  return <>
    {!compact ? <span className="workbench-react__status-detail">{diagnostic.detail}</span> : null}
    <details className="workbench-react__status-disclosure">
      <summary>Diagnostic details</summary>
      <div className="workbench-react__status-disclosure-content">
        {compact ? <span className="workbench-react__status-detail">{diagnostic.detail}</span> : null}
        {diagnostic.technicalDetail && diagnostic.technicalDetail !== diagnostic.detail ? <span>{diagnostic.technicalDetail}</span> : null}
        {diagnostic.limitation ? <span className="workbench-react__status-limitation">Limit: {diagnostic.limitation}</span> : null}
        {diagnostic.consequence ? <span className="workbench-react__status-consequence">Consequence: {diagnostic.consequence}</span> : null}
        {diagnostic.recovery ? <span className="workbench-react__status-recovery">Recovery: {diagnostic.recovery}</span> : null}
        {diagnostic.code ? <span>Code: <code>{diagnostic.code}</code></span> : null}
        {diagnostic.route ? <button type="button" onClick={onInspect}>{diagnostic.route.label}</button> : null}
      </div>
    </details>
  </>;
}
