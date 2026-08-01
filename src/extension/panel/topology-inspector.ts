export type TopologyInspectorUpdate = {
  selectedKey: string;
  restoreFocus?: boolean;
  syncState?: string;
  coverageStatus?: string;
};

export type TopologyInspectorOptions = {
  document?: Document;
  onSelect(key: string): void;
  onToggle(key: string, collapsed: boolean): void;
};

export type TopologyInspector = {
  element: HTMLElement;
  overview: HTMLElement;
  treePane: HTMLElement;
  detailPane: HTMLElement;
  update(update: TopologyInspectorUpdate): void;
  setActive(active: boolean): void;
  dispose(): void;
};

const TYPEAHEAD_RESET_MS = 700;
const STACKED_BREAKPOINT = 760;
const MIN_SPLIT_PERCENT = 30;

export function createTopologyInspector(
  options: TopologyInspectorOptions
): TopologyInspector {
  const ownerDocument = options.document ?? document;
  const ownerWindow = ownerDocument.defaultView ?? window;
  let disposed = false;
  let lastFocusedKey: string | null = null;
  let parentByKey = new Map<string, string>();
  let selectedKey = "page";
  let typeaheadBuffer = "";
  let typeaheadTimer: number | null = null;
  let splitPercent = 42;
  let activeResizeCleanup: (() => void) | null = null;

  const element = ownerDocument.createElement("section");
  element.className = "topology-workspace";
  element.setAttribute(
    "aria-label",
    "Client, session, and subscription topology inspector"
  );

  const overview = ownerDocument.createElement("header");
  overview.className = "topology-overview";

  const body = ownerDocument.createElement("div");
  body.className = "topology-body";

  const treePane = ownerDocument.createElement("nav");
  treePane.id = "topology-tree-pane";
  treePane.className = "topology-tree-pane";
  treePane.setAttribute("aria-label", "Lightstreamer topology tree");

  const separator = ownerDocument.createElement("div");
  separator.className = "topology-resize-handle";
  separator.setAttribute("role", "separator");
  separator.setAttribute("aria-label", "Resize topology tree pane");
  separator.setAttribute("aria-controls", treePane.id);
  separator.setAttribute("aria-valuemin", String(MIN_SPLIT_PERCENT));
  separator.tabIndex = 0;

  const detailPane = ownerDocument.createElement("aside");
  detailPane.className = "topology-detail-pane";
  detailPane.setAttribute("aria-label", "Selected topology node detail");

  body.append(treePane, separator, detailPane);
  element.append(overview, body);

  treePane.addEventListener("click", handleTreeClick);
  treePane.addEventListener("focusin", handleTreeFocus);
  treePane.addEventListener("keydown", handleTreeKeydown);
  separator.addEventListener("keydown", handleSeparatorKeydown);
  separator.addEventListener("pointerdown", beginSeparatorResize);
  ownerWindow.addEventListener("resize", updateOrientation);
  updateOrientation();
  applySplitPercent();

  return {
    element,
    overview,
    treePane,
    detailPane,
    update(update) {
      if (disposed) {
        return;
      }
      selectedKey = update.selectedKey;
      if (update.syncState) {
        element.dataset.syncState = update.syncState;
      } else {
        delete element.dataset.syncState;
      }
      if (update.coverageStatus) {
        element.dataset.coverageStatus = update.coverageStatus;
      } else {
        delete element.dataset.coverageStatus;
      }
      const previousParents = parentByKey;
      const nodes = topologyNodes();
      parentByKey = collectParentKeys(nodes);
      const visible = visibleTopologyNodes(nodes);
      const visibleKeys = new Set(visible.map(topologyKey));

      let rovingKey = visibleKeys.has(lastFocusedKey ?? "")
        ? lastFocusedKey
        : visibleKeys.has(selectedKey)
          ? selectedKey
          : topologyKey(visible[0]);

      if (update.restoreFocus && lastFocusedKey && !visibleKeys.has(lastFocusedKey)) {
        let fallback = previousParents.get(lastFocusedKey) ?? null;
        while (fallback && !visibleKeys.has(fallback)) {
          fallback = previousParents.get(fallback) ?? null;
        }
        rovingKey = fallback ?? (visibleKeys.has(selectedKey) ? selectedKey : topologyKey(visible[0]));
        if (rovingKey) {
          selectedKey = rovingKey;
        }
      }

      for (const node of nodes) {
        const key = topologyKey(node);
        const item = node.closest<HTMLLIElement>(".topology-tree-item");
        item?.setAttribute("role", "none");
        node.setAttribute("role", "treeitem");
        node.setAttribute("aria-selected", String(key === selectedKey));
        node.tabIndex = key === rovingKey && visibleKeys.has(key) ? 0 : -1;
        const group = directChildGroup(item);
        if (group) {
          node.setAttribute("aria-expanded", String(!group.hidden));
        } else {
          node.removeAttribute("aria-expanded");
        }
      }

      const tree = treePane.querySelector<HTMLElement>(".topology-tree");
      tree?.setAttribute("aria-label", "Current Lightstreamer topology");
      if (update.restoreFocus && rovingKey) {
        const target = findNode(rovingKey);
        lastFocusedKey = rovingKey;
        focusWithoutScrolling(target);
      }
    },
    setActive(active) {
      element.hidden = !active;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      activeResizeCleanup?.();
      activeResizeCleanup = null;
      if (typeaheadTimer !== null) {
        ownerWindow.clearTimeout(typeaheadTimer);
        typeaheadTimer = null;
      }
      treePane.removeEventListener("click", handleTreeClick);
      treePane.removeEventListener("focusin", handleTreeFocus);
      treePane.removeEventListener("keydown", handleTreeKeydown);
      separator.removeEventListener("keydown", handleSeparatorKeydown);
      separator.removeEventListener("pointerdown", beginSeparatorResize);
      ownerWindow.removeEventListener("resize", updateOrientation);
      parentByKey.clear();
    }
  };

  function handleTreeClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const toggle = target?.closest<HTMLButtonElement>(".topology-collapse-toggle");
    if (toggle && treePane.contains(toggle)) {
      event.preventDefault();
      const item = toggle.closest<HTMLLIElement>(".topology-tree-item");
      const node = directNode(item);
      if (node) {
        const key = topologyKey(node);
        setBranchCollapsed(node, node.getAttribute("aria-expanded") !== "false");
        selectAndFocus(findNode(key) ?? node);
      }
      return;
    }

    const node = target?.closest<HTMLButtonElement>(".topology-node");
    if (node && treePane.contains(node)) {
      selectAndFocus(node);
    }
  }

  function handleTreeFocus(event: FocusEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const node = target?.closest<HTMLButtonElement>(".topology-node");
    if (!node || !treePane.contains(node)) {
      return;
    }
    const key = topologyKey(node);
    if (!key) {
      return;
    }
    lastFocusedKey = key;
    parentByKey = collectParentKeys(topologyNodes());
    setRovingNode(node);
  }

  function handleTreeKeydown(event: KeyboardEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const node = target?.closest<HTMLButtonElement>(".topology-node");
    if (!node || !treePane.contains(node)) {
      return;
    }
    const visible = visibleTopologyNodes(topologyNodes());
    const index = visible.indexOf(node);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const next = visible[index + offset];
      if (next) {
        selectAndFocus(next);
      }
      return;
    }
    if (event.key === "ArrowRight") {
      const group = directChildGroup(node.closest(".topology-tree-item"));
      if (!group) {
        return;
      }
      event.preventDefault();
      if (group.hidden) {
        setBranchCollapsed(node, false);
      } else {
        const child = group.querySelector<HTMLButtonElement>(".topology-node");
        if (child) {
          selectAndFocus(child);
        }
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      const group = directChildGroup(node.closest(".topology-tree-item"));
      if (group && !group.hidden) {
        event.preventDefault();
        setBranchCollapsed(node, true);
        return;
      }
      const parentKey = parentByKey.get(topologyKey(node));
      const parent = parentKey ? findNode(parentKey) : null;
      if (parent) {
        event.preventDefault();
        selectAndFocus(parent);
      }
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? visible[0] : visible[visible.length - 1];
      if (next) {
        selectAndFocus(next);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectAndFocus(node);
      return;
    }
    if (
      event.key.length === 1 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      typeaheadBuffer += event.key.toLocaleLowerCase();
      if (typeaheadTimer !== null) {
        ownerWindow.clearTimeout(typeaheadTimer);
      }
      typeaheadTimer = ownerWindow.setTimeout(() => {
        typeaheadBuffer = "";
        typeaheadTimer = null;
      }, TYPEAHEAD_RESET_MS);
      for (let offset = 1; offset <= visible.length; offset += 1) {
        const candidate = visible[(Math.max(index, -1) + offset) % visible.length];
        const label = candidate
          ?.querySelector(".topology-node-label")
          ?.textContent?.trim()
          .toLocaleLowerCase();
        if (candidate && label?.startsWith(typeaheadBuffer)) {
          selectAndFocus(candidate);
          return;
        }
      }
    }
  }

  function selectAndFocus(node: HTMLButtonElement): void {
    const key = topologyKey(node);
    if (!key) {
      return;
    }
    selectedKey = key;
    lastFocusedKey = key;
    setRovingNode(node);
    for (const candidate of topologyNodes()) {
      candidate.setAttribute(
        "aria-selected",
        String(topologyKey(candidate) === key)
      );
    }
    options.onSelect(key);
    focusWithoutScrolling(findNode(key) ?? node);
  }

  function setRovingNode(node: HTMLButtonElement): void {
    for (const candidate of topologyNodes()) {
      candidate.tabIndex = candidate === node ? 0 : -1;
    }
  }

  function setBranchCollapsed(node: HTMLButtonElement, collapsed: boolean): void {
    const item = node.closest<HTMLLIElement>(".topology-tree-item");
    const group = directChildGroup(item);
    const toggle = item?.querySelector<HTMLButtonElement>(
      ":scope > .topology-node-row > .topology-collapse-toggle"
    );
    const key = topologyKey(node);
    if (!group || !toggle || !key) {
      return;
    }
    const label =
      node.querySelector(".topology-node-label")?.textContent ?? "topology branch";
    group.hidden = collapsed;
    node.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${label}`);
    toggle.title = `${collapsed ? "Expand" : "Collapse"} ${label}`;
    toggle.textContent = collapsed ? "▸" : "▾";
    options.onToggle(key, collapsed);
    const nodes = topologyNodes();
    parentByKey = collectParentKeys(nodes);
    const visible = visibleTopologyNodes(nodes);
    if (!visible.includes(node)) {
      selectAndFocus(node);
    } else {
      setRovingNode(node);
    }
  }

  function handleSeparatorKeydown(event: KeyboardEvent): void {
    const stacked = body.dataset.orientation === "stacked";
    const decrease = stacked ? "ArrowUp" : "ArrowLeft";
    const increase = stacked ? "ArrowDown" : "ArrowRight";
    if (event.key === "Home") {
      event.preventDefault();
      setSplitPercent(MIN_SPLIT_PERCENT);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setSplitPercent(stacked ? 70 : 65);
      return;
    }
    if (event.key === decrease || event.key === increase) {
      event.preventDefault();
      const direction = event.key === decrease ? -1 : 1;
      setSplitPercent(splitPercent + direction * (event.shiftKey ? 10 : 2));
    }
  }

  function beginSeparatorResize(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    activeResizeCleanup?.();
    event.preventDefault();
    separator.dataset.resizing = "true";
    const move = (moveEvent: PointerEvent) => {
      const bounds = body.getBoundingClientRect();
      const stacked = body.dataset.orientation === "stacked";
      const size = stacked ? bounds.height : bounds.width;
      const position = stacked
        ? moveEvent.clientY - bounds.top
        : moveEvent.clientX - bounds.left;
      if (size > 0) {
        setSplitPercent((position / size) * 100);
      }
    };
    const stop = () => {
      delete separator.dataset.resizing;
      ownerWindow.removeEventListener("pointermove", move);
      ownerWindow.removeEventListener("pointerup", stop);
      ownerWindow.removeEventListener("pointercancel", stop);
      if (activeResizeCleanup === stop) {
        activeResizeCleanup = null;
      }
    };
    ownerWindow.addEventListener("pointermove", move);
    ownerWindow.addEventListener("pointerup", stop);
    ownerWindow.addEventListener("pointercancel", stop);
    activeResizeCleanup = stop;
  }

  function updateOrientation(): void {
    const width = body.getBoundingClientRect().width || ownerWindow.innerWidth;
    const stacked = width < STACKED_BREAKPOINT;
    body.dataset.orientation = stacked ? "stacked" : "side-by-side";
    separator.setAttribute("aria-orientation", stacked ? "horizontal" : "vertical");
    separator.setAttribute("aria-valuemax", stacked ? "70" : "65");
    setSplitPercent(splitPercent);
  }

  function setSplitPercent(value: number): void {
    const maximum = body.dataset.orientation === "stacked" ? 70 : 65;
    splitPercent = Math.round(Math.min(Math.max(value, MIN_SPLIT_PERCENT), maximum));
    applySplitPercent();
  }

  function applySplitPercent(): void {
    body.style.setProperty("--topology-tree-size", `${splitPercent}%`);
    separator.setAttribute("aria-valuenow", String(splitPercent));
  }

  function topologyNodes(): HTMLButtonElement[] {
    return Array.from(treePane.querySelectorAll<HTMLButtonElement>(".topology-node"));
  }

  function visibleTopologyNodes(nodes: readonly HTMLButtonElement[]): HTMLButtonElement[] {
    return nodes.filter((node) => !node.closest(".topology-tree-group[hidden]"));
  }

  function collectParentKeys(
    nodes: readonly HTMLButtonElement[]
  ): Map<string, string> {
    const parents = new Map<string, string>();
    for (const node of nodes) {
      const item = node.closest<HTMLLIElement>(".topology-tree-item");
      const group = item?.parentElement?.closest<HTMLUListElement>(
        ".topology-tree-group"
      );
      const parentNode = directNode(group?.parentElement ?? null);
      const key = topologyKey(node);
      const parentKey = parentNode ? topologyKey(parentNode) : "";
      if (key && parentKey) {
        parents.set(key, parentKey);
      }
    }
    return parents;
  }

  function findNode(key: string): HTMLButtonElement | null {
    return topologyNodes().find((node) => topologyKey(node) === key) ?? null;
  }
}

function topologyKey(node: HTMLButtonElement | undefined): string {
  return node?.dataset.topologyKey ?? "";
}

function directNode(container: Element | null): HTMLButtonElement | null {
  return (
    container?.querySelector<HTMLButtonElement>(
      ":scope > .topology-node-row > .topology-node"
    ) ?? null
  );
}

function directChildGroup(container: Element | null): HTMLUListElement | null {
  return (
    container?.querySelector<HTMLUListElement>(":scope > .topology-tree-group") ??
    null
  );
}

function focusWithoutScrolling(node: HTMLButtonElement | null): void {
  if (!node) {
    return;
  }
  try {
    node.focus({ preventScroll: true });
  } catch {
    node.focus();
  }
}
