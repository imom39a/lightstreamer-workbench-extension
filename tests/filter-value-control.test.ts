import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { FilterValueControl } from "../src/extension/panel/react/filter-value-control";
import { filterValueMutations, filterValueState } from "../src/extension/panel/react/workbench-panel";
import { applyFilterMutations, createFilter, createTypedFilterValue } from "../src/core/filter-algebra";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("FilterValueControl", () => {
  let root: Root | undefined;

  afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

  it("offers one native radio group with explicit Off, Include, and Exclude states", async () => {
    const changed = vi.fn();
    const mount = document.body.appendChild(document.createElement("div"));
    root = createRoot(mount);
    await act(async () => root!.render(createElement(FilterValueControl, { label: "Client: client-1", state: "include", onChange: changed })));

    const group = mount.querySelector("fieldset");
    expect(group?.getAttribute("aria-label")).toBe("Client: client-1");
    expect(group?.getAttribute("role")).toBe("radiogroup");
    const radios = Array.from(mount.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map(({ nextElementSibling }) => nextElementSibling?.textContent)).toEqual(["Off", "Include", "Exclude"]);
    expect(radios[1]?.checked).toBe(true);
    await act(async () => radios[2]?.click());
    expect(changed).toHaveBeenCalledWith("exclude");
  });

  it("derives the selected state from the current Filter and only replaces this exact value", () => {
    const client = createTypedFilterValue("client", "client", "client-1");
    const otherClient = createTypedFilterValue("client", "client", "client-2");
    const key = createTypedFilterValue("key", "key", "order-1");
    const base = applyFilterMutations(createFilter(), 1, [
      { type: "add-criterion", facet: "client", value: client, polarity: "include" },
      { type: "add-criterion", facet: "client", value: otherClient, polarity: "exclude" },
      { type: "add-criterion", facet: "key", value: key, polarity: "include" }
    ]);
    if (!base.ok) throw new Error("Expected a valid Filter.");

    expect(filterValueState(base.filter.criteria.client, client)).toBe("include");
    const excluded = applyFilterMutations(base.filter, base.filter.revision, filterValueMutations(client, "exclude"));
    if (!excluded.ok) throw new Error("Expected a valid Filter.");
    expect(filterValueState(excluded.filter.criteria.client, client)).toBe("exclude");
    expect(excluded.filter.criteria.client?.exclude.map(({ identity }) => identity)).toContain(otherClient.identity);
    expect(excluded.filter.criteria.key?.include).toEqual([key]);

    const off = applyFilterMutations(excluded.filter, excluded.filter.revision, filterValueMutations(client, "off"));
    if (!off.ok) throw new Error("Expected a valid Filter.");
    expect(filterValueState(off.filter.criteria.client, client)).toBe("off");
    expect(off.filter.criteria.client?.exclude).toEqual([otherClient]);
    expect(off.filter.criteria.key?.include).toEqual([key]);
  });
});
