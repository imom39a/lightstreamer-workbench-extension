import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  diagnosticCodeFacetValue,
  diagnosticSeverityFacetValue
} from "../src/core/diagnostic-observation-index";
import type { WorkbenchCommand, WorkbenchNotificationsSnapshot } from "../src/extension/panel/workbench-runtime";
import { NotificationsDocument } from "../src/extension/panel/react/notifications-document";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Notifications filter controls", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
  });

  it("shows one Off/Include/Exclude control per value and switches polarity without touching other criteria", async () => {
    const code = diagnosticCodeFacetValue("HISTORY_GAP");
    const severity = diagnosticSeverityFacetValue("warning");
    const commands: WorkbenchCommand[] = [];
    const mount = document.body.appendChild(document.createElement("div"));
    root = createRoot(mount);
    await act(async () => root!.render(createElement(NotificationsDocument, {
      open: true,
      notifications: notificationsSnapshot({
        criteria: {
          diagnosticCode: { include: [code], exclude: [] },
          diagnosticSeverity: [severity]
        },
        active: true,
        options: {
          diagnosticCode: [{ value: code, count: 0 }],
          diagnosticSeverity: [{ value: severity, count: 2 }],
          diagnosticAffected: []
        }
      }),
      onBack: vi.fn(),
      onCommand: (command) => commands.push(command),
      onInspect: () => true
    })));

    const codeGroup = [...mount.querySelectorAll("fieldset")].find((fieldset) => fieldset.getAttribute("aria-label")?.startsWith("HISTORY_GAP"));
    expect(codeGroup).toBeTruthy();
    expect(codeGroup?.textContent).toContain("Off");
    expect(codeGroup?.textContent).toContain("Include");
    expect(codeGroup?.textContent).toContain("Exclude");
    expect([...codeGroup!.querySelectorAll<HTMLInputElement>("input")].find((input) => input.checked)?.nextElementSibling?.textContent).toBe("Include");

    await act(async () => [...codeGroup!.querySelectorAll<HTMLInputElement>("input")].find((input) => input.nextElementSibling?.textContent === "Exclude")!.click());
    expect(commands.at(-1)).toEqual({ type: "apply-diagnostic-filter", facet: "diagnosticCode", value: code, polarity: "exclude" });
    expect(commands).toHaveLength(1);
  });

  it("removes only the selected value when switched Off and keeps an active zero-match value visible", async () => {
    const code = diagnosticCodeFacetValue("RETAINED_ZERO");
    const other = diagnosticCodeFacetValue("OTHER");
    const commands: WorkbenchCommand[] = [];
    const mount = document.body.appendChild(document.createElement("div"));
    root = createRoot(mount);
    await act(async () => root!.render(createElement(NotificationsDocument, {
      open: true,
      notifications: notificationsSnapshot({
        criteria: { diagnosticCode: { include: [code, other], exclude: [] } },
        active: true,
        options: { diagnosticCode: [{ value: other, count: 1 }], diagnosticSeverity: [], diagnosticAffected: [] }
      }),
      onBack: vi.fn(),
      onCommand: (command) => commands.push(command),
      onInspect: () => true
    })));

    const codeGroup = [...mount.querySelectorAll("fieldset")]
      .find((fieldset) => fieldset.getAttribute("aria-label")?.startsWith("RETAINED_ZERO"))?.parentElement;
    expect(codeGroup?.querySelector(".workbench-react__notifications-filter-label")?.textContent).toBe("RETAINED_ZERO (0)");
    const off = [...codeGroup!.querySelectorAll<HTMLInputElement>("input")].find((input) => input.nextElementSibling?.textContent === "Off")!;
    await act(async () => off.click());
    expect(commands.at(-1)).toEqual({ type: "remove-diagnostic-filter", facet: "diagnosticCode", value: code, polarity: "include" });
  });

  it("returns focus to the filter summary when Off removes the focused zero-count value row", async () => {
    const code = diagnosticCodeFacetValue("RETAINED_ZERO");
    const other = diagnosticCodeFacetValue("OTHER");
    let current = notificationsSnapshot({
      criteria: { diagnosticCode: { include: [code], exclude: [] } },
      active: true,
      options: { diagnosticCode: [{ value: code, count: 0 }], diagnosticSeverity: [], diagnosticAffected: [] }
    });
    const mount = document.body.appendChild(document.createElement("div"));
    root = createRoot(mount);
    const onCommand = vi.fn((command: WorkbenchCommand) => {
      if (command.type !== "remove-diagnostic-filter") return;
      current = notificationsSnapshot({
        criteria: { diagnosticCode: [] },
        active: false,
        options: { diagnosticCode: [{ value: other, count: 1 }], diagnosticSeverity: [], diagnosticAffected: [] }
      });
    });
    await act(async () => root!.render(createElement(NotificationsDocument, {
      open: true,
      notifications: current,
      onBack: vi.fn(),
      onCommand,
      onInspect: () => true
    })));
    const row = mount.querySelector<HTMLElement>('[data-filter-value-identity*="RETAINED_ZERO"]')!;
    const off = [...row.querySelectorAll<HTMLInputElement>("input")].find((input) => input.nextElementSibling?.textContent === "Off")!;
    off.focus();
    await act(async () => off.click());
    await act(async () => root!.render(createElement(NotificationsDocument, {
      open: true,
      notifications: current,
      onBack: vi.fn(),
      onCommand,
      onInspect: () => true
    })));
    expect(onCommand).toHaveBeenCalledWith({ type: "remove-diagnostic-filter", facet: "diagnosticCode", value: code, polarity: "include" });
    expect(mount.querySelector("summary")).toBe(document.activeElement);
  });
});

function notificationsSnapshot(
  filter: Partial<WorkbenchNotificationsSnapshot["filter"]>
): WorkbenchNotificationsSnapshot {
  return {
    entries: [],
    total: 0,
    limit: 100,
    filter: {
      criteria: {},
      active: false,
      options: { diagnosticCode: [], diagnosticSeverity: [], diagnosticAffected: [] },
      ...filter
    }
  };
}
