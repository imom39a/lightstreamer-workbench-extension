import {
  topologyToneLabel,
  type TopologyNodePresentation,
  type TopologySelection
} from "./topology-view-model";
import { createTextElement } from "./panel-dom";

export type RenderedTopologyNode = {
  button: HTMLButtonElement;
  kind: HTMLElement;
  label: HTMLElement;
  meta: HTMLElement;
  status: HTMLElement | null;
};

export type TopologyTreeNode = {
  item: HTMLLIElement;
  button: HTMLButtonElement;
  collapseSlot: HTMLElement;
};

export type TopologyTreeViewOptions = {
  selectedKey(): string;
  showItemStatus(): boolean;
  collapsedKeys: Set<string>;
  renderedNodes: Map<string, RenderedTopologyNode>;
  nodeSelections: Map<string, TopologySelection>;
};

export function createTopologyTreeNode(
  presentation: TopologyNodePresentation,
  options: TopologyTreeViewOptions
): TopologyTreeNode {
  const item = document.createElement("li");
  item.className = "topology-tree-item";
  item.setAttribute("role", "none");

  const row = document.createElement("div");
  row.className = "topology-node-row";
  const collapseSlot = createTextElement("span", "topology-collapse-spacer", "");
  collapseSlot.setAttribute("aria-hidden", "true");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "topology-node";
  button.setAttribute("role", "treeitem");
  button.dataset.topologyKey = presentation.selection.key;
  button.tabIndex = -1;
  const rendered: RenderedTopologyNode = {
    button,
    kind: createTextElement("span", "topology-node-kind", ""),
    label: createTextElement("span", "topology-node-label", ""),
    meta: createTextElement("span", "topology-node-meta", ""),
    status:
      options.showItemStatus() && presentation.kind === "ITEM"
        ? null
        : createTextElement("span", "topology-node-status", "")
  };
  button.append(rendered.kind, rendered.label, rendered.meta);
  if (rendered.status) {
    button.append(rendered.status);
  }
  applyTopologyNodePresentation(rendered, presentation, options);
  options.renderedNodes.set(presentation.selection.key, rendered);
  options.nodeSelections.set(presentation.selection.key, presentation.selection);
  row.append(collapseSlot, button);
  item.append(row);
  return { item, button, collapseSlot };
}

export function attachTopologyTreeChildren(
  node: TopologyTreeNode,
  children: HTMLUListElement,
  options: TopologyTreeViewOptions,
  force = false
): void {
  if (!force && children.childElementCount === 0) {
    return;
  }
  const key = node.button.dataset.topologyKey;
  if (!key) {
    return;
  }
  const collapsed = options.collapsedKeys.has(key);
  const label = node.button.querySelector(".topology-node-label")?.textContent ?? "topology branch";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "topology-collapse-toggle";
  toggle.tabIndex = -1;
  toggle.setAttribute("aria-hidden", "true");
  toggle.dataset.topologyCollapseKey = key;
  toggle.dataset.topologyBranchLabel = label;
  node.collapseSlot.replaceWith(toggle);
  node.item.append(children);
  setTopologyBranchCollapsed(node.item, toggle, collapsed);
}

export function createTopologyTreeGroup(): HTMLUListElement {
  const group = document.createElement("ul");
  group.className = "topology-tree-group";
  group.setAttribute("role", "group");
  return group;
}

export function applyTopologyNodePresentation(
  rendered: RenderedTopologyNode,
  presentation: TopologyNodePresentation,
  options: TopologyTreeViewOptions
): void {
  const selected = options.selectedKey() === presentation.selection.key;
  const status = topologyToneLabel(presentation.tone);
  setTextIfChanged(rendered.kind, presentation.kind);
  setTextIfChanged(rendered.label, presentation.label);
  setTextIfChanged(rendered.meta, presentation.meta);
  if (rendered.status) {
    setTextIfChanged(rendered.status, status);
  }
  if (rendered.button.dataset.selected !== String(selected)) {
    rendered.button.dataset.selected = String(selected);
  }
  if (rendered.button.dataset.tone !== presentation.tone) {
    rendered.button.dataset.tone = presentation.tone;
  }
  const ariaCurrent = selected ? "true" : "false";
  if (rendered.button.getAttribute("aria-current") !== ariaCurrent) {
    rendered.button.setAttribute("aria-current", ariaCurrent);
  }
  rendered.button.setAttribute("aria-selected", String(selected));
}

function setTopologyBranchCollapsed(
  item: HTMLLIElement,
  toggle: HTMLButtonElement,
  collapsed: boolean
): void {
  const children = Array.from(item.children).find(
    (child): child is HTMLUListElement => child.classList.contains("topology-tree-group")
  );
  if (!children) {
    return;
  }
  const label = toggle.dataset.topologyBranchLabel ?? "topology branch";
  children.hidden = collapsed;
  const node = item.querySelector<HTMLButtonElement>(":scope > .topology-node-row > .topology-node");
  node?.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${label}`);
  toggle.title = `${collapsed ? "Expand" : "Collapse"} ${label}`;
  toggle.textContent = collapsed ? "▸" : "▾";
}

function setTextIfChanged(element: HTMLElement, value: string): void {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}
