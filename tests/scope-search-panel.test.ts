import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ScopeSearch, type ScopeSearchProps } from "../src/extension/panel/react/scope-search";
import type { ScopeSearchNode } from "../src/core/scope-search";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Scope search controls", () => {
  let root: Root | undefined;
  let mount: HTMLDivElement;

  afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

  async function render(nodes: readonly ScopeSearchNode[], overrides: Partial<ScopeSearchProps> = {}) {
    mount = document.body.appendChild(document.createElement("div"));
    root = createRoot(mount);
    const choose = vi.fn();
    const close = vi.fn();
    await act(async () => root!.render(createElement(ScopeSearch, {
      structure: nodes,
      resolveNode: (id) => nodes.find((node) => node.id === id) ?? null,
      selectedScopeId: "page",
      onChoose: choose,
      onClose: close,
      ...overrides
    })));
    return { choose, close, input: mount.querySelector<HTMLInputElement>('input[aria-label="Search scopes"]')! };
  }

  async function type(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function key(input: HTMLElement, value: string, options: KeyboardEventInit = {}) {
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: value, ...options })));
  }

  it("focuses Search scopes and only commits a matching Scope on Enter or click", async () => {
    const nodes = [
      { id: "page", kind: "page", label: "Inspected page", parentId: null },
      { id: "alpha", kind: "subscription", label: "Orders", parentId: "page", lifecycle: "active" },
      { id: "beta", kind: "subscription", label: "Orders", parentId: "page", lifecycle: "retired", retired: true }
    ];
    const { choose, input } = await render(nodes);
    expect(document.activeElement).toBe(input);
    await type(input, "orders");
    const options = Array.from(mount.querySelectorAll<HTMLElement>('[role="option"]'));
    expect(options).toHaveLength(2);
    expect(choose).not.toHaveBeenCalled();
    expect(options[0]!.getAttribute("aria-label")).toContain("alpha");
    expect(options[1]!.getAttribute("aria-label")).toContain("Retired");
    expect(options[0]!.getAttribute("aria-selected")).toBe("false");
    await key(input, "ArrowDown");
    expect(choose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    await key(input, "Enter");
    expect(choose).toHaveBeenLastCalledWith("beta");
    await act(async () => options[0]!.click());
    expect(choose).toHaveBeenLastCalledWith("alpha");
  });

  it("pages and browses all matches, keeping only a bounded page mounted", async () => {
    const nodes = Array.from({ length: 1_203 }, (_, index) => ({ id: `item-${index}`, kind: "item", label: `Portfolio ${index}`, parentId: null }));
    const { choose, input } = await render(nodes);
    await type(input, "portfolio");
    expect(mount.querySelectorAll('[role="option"]')).toHaveLength(50);
    expect(mount.textContent).toContain("1,203 matches");
    await key(input, "End", { ctrlKey: true });
    expect(mount.querySelector('[data-active="true"]')?.getAttribute("data-scope-id")).toBe("item-1202");
    expect(mount.querySelectorAll('[role="option"]')).toHaveLength(3);
    await key(input, "Enter");
    expect(choose).toHaveBeenLastCalledWith("item-1202");
    await key(input, "ArrowUp");
    expect(mount.querySelector('[data-active="true"]')?.getAttribute("data-scope-id")).toBe("item-1201");
    expect(mount.querySelectorAll('[role="option"]')).toHaveLength(3);
  });

  it("clears first on Escape and then delegates exact restoration to its owner", async () => {
    const { close, input } = await render([{ id: "page", kind: "page", label: "Inspected page", parentId: null }]);
    await type(input, "no such scope");
    expect(mount.textContent).toContain("No matching scopes");
    await key(input, "Escape");
    expect(input.value).toBe("");
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    await key(input, "Escape");
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps passive Topology changes out of the current result page until refreshed", async () => {
    let nodes: readonly ScopeSearchNode[] = [
      { id: "portfolio-a", kind: "item", label: "Portfolio A", parentId: null, lifecycle: "active" },
      { id: "portfolio-b", kind: "item", label: "Portfolio B", parentId: null, lifecycle: "active" }
    ];
    const resolver = (id: string) => nodes.find((node) => node.id === id) ?? null;
    const { input, choose } = await render(nodes, { resolveNode: resolver });
    await type(input, "portfolio");
    await key(input, "ArrowDown");
    nodes = [...nodes, { id: "portfolio-c", kind: "item", label: "Portfolio C", parentId: null, lifecycle: "active" }];
    await act(async () => root!.render(createElement(ScopeSearch, {
      structure: nodes, resolveNode: resolver, selectedScopeId: "page", onChoose: choose, onClose: vi.fn()
    })));
    expect(mount.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(mount.querySelector('[data-active="true"]')?.getAttribute("data-scope-id")).toBe("portfolio-b");
    expect(document.activeElement).toBe(input);
    await act(async () => mount.querySelector<HTMLButtonElement>('button[aria-label="Refresh scopes"]')!.click());
    expect(mount.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(choose).not.toHaveBeenCalled();
  });

  it("refuses an unavailable result at commitment and explains the recovery", async () => {
    let available = true;
    const node = { id: "removed", kind: "item", label: "Portfolio", parentId: null };
    const { input, choose } = await render([node], { resolveNode: () => available ? node : null });
    await type(input, "portfolio");
    available = false;
    await key(input, "Enter");
    expect(choose).not.toHaveBeenCalled();
    expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Scope is no longer available. Refresh scopes.");
    expect(document.activeElement).toBe(input);
    await act(async () => mount.querySelector<HTMLButtonElement>('button[aria-label="Refresh scopes"]')!.click());
    expect(mount.querySelector('[role="alert"]')).toBeNull();
    expect(mount.textContent).toContain("No matching scopes");
  });
});
