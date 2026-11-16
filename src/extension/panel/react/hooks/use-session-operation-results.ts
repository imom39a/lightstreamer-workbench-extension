import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import type { WorkbenchRuntime, WorkbenchSnapshot } from "../../workbench-runtime";
import type { AnalyticsClient } from "../../../analytics/client";

/**
 * Completes scoped Evidence copy through the page clipboard and returns focus
 * to the operation's trigger once copy or export stops preparing.
 */
export function useSessionOperationResults({
  runtime,
  analytics,
  evidenceCopy,
  exportState,
  contextLens
}: Readonly<{
  runtime: WorkbenchRuntime;
  analytics: AnalyticsClient;
  evidenceCopy: WorkbenchSnapshot["evidenceCopy"];
  exportState: NonNullable<WorkbenchSnapshot["export"]["operation"]>["state"] | undefined;
  contextLens: RefObject<HTMLElement | null>;
}>) {
  const [scopedCopyStatus, setScopedCopyStatus] = useState("");
  const operationFocusOrigin = useRef<"copy" | "export" | null>(null);
  const scopedCopyTrigger = useRef<HTMLButtonElement | null>(null);
  const exportTrigger = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    if (["error", "refused", "cancelled"].includes(evidenceCopy.state)) {
      setScopedCopyStatus(evidenceCopy.error ?? "Retained scoped Evidence was not copied.");
      runtime.dispatch({ type: "clear-scoped-evidence-copy" });
      return;
    }
    if (evidenceCopy.state !== "ready" || !evidenceCopy.text) return;
    if (!navigator.clipboard?.writeText) {
      setScopedCopyStatus("Could not copy retained scoped Evidence.");
      analytics.track({ name: "export_result", params: { format: "clipboard", outcome: "unavailable" } });
      runtime.dispatch({ type: "clear-scoped-evidence-copy" });
      return;
    }
    void navigator.clipboard.writeText(evidenceCopy.text).then(
      () => { setScopedCopyStatus(`Copied retained scoped Evidence (${evidenceCopy.eventCount.toLocaleString()} events).`); analytics.track({ name: "export_result", params: { format: "clipboard", outcome: "success" } }); },
      () => { setScopedCopyStatus("Could not copy retained scoped Evidence."); analytics.track({ name: "export_result", params: { format: "clipboard", outcome: "failed" } }); }
    ).finally(() => runtime.dispatch({ type: "clear-scoped-evidence-copy" }));
  }, [runtime, evidenceCopy, analytics]);

  useLayoutEffect(() => {
    const copyFinished = evidenceCopy.state !== "preparing" && operationFocusOrigin.current === "copy";
    const exportFinished = exportState !== "preparing" && operationFocusOrigin.current === "export";
    if (!copyFinished && !exportFinished) return;
    const origin = operationFocusOrigin.current;
    operationFocusOrigin.current = null;
    window.requestAnimationFrame(() => {
      const target = origin === "copy" ? scopedCopyTrigger.current : exportTrigger.current ?? contextLens.current;
      if (target?.isConnected) target.focus();
      else if (contextLens.current?.isConnected) contextLens.current.focus();
    });
  }, [contextLens, evidenceCopy.state, exportState]);

  return { scopedCopyStatus, operationFocusOrigin, scopedCopyTrigger, exportTrigger };
}
