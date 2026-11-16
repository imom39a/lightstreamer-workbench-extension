import { memo, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { WorkbenchSnapshot } from "../workbench-runtime";
import { SCOPE_NODE_HEIGHT } from "./workbench-geometry";

export type ScopeNode = WorkbenchSnapshot["scope"]["nodes"][number];
export type ScopeTreeEntry = { node: ScopeNode; index: number };
export type ScopeTreeActions = {
  scroll(scrollTop: number): void;
  focus(scopeId: string): void;
  commit(scopeId: string): void;
  key(event: ReactKeyboardEvent<HTMLButtonElement>, node: ScopeNode): void;
};

const ScopeTreeRow = memo(function ScopeTreeRow({
  node,
  index,
  siblingPosition,
  hasChildren,
  collapsed,
  focused,
  nodeRefs,
  actionsRef
}: {
  node: ScopeNode;
  index: number;
  siblingPosition: { position: number; size: number } | undefined;
  hasChildren: boolean;
  collapsed: boolean;
  focused: boolean;
  nodeRefs: { current: Map<string, HTMLButtonElement> };
  actionsRef: { current: ScopeTreeActions };
}): JSX.Element {
  return (
    <button
      className="workbench-react__scope-node workbench-react__scope-node--windowed"
      role="treeitem"
      aria-level={node.depth + 1}
      aria-posinset={siblingPosition?.position}
      aria-setsize={siblingPosition?.size}
      aria-selected={node.selected}
      aria-current={node.selected ? "true" : undefined}
      data-retired={node.retired || undefined}
      data-scope-id={node.id}
      aria-expanded={hasChildren ? !collapsed : undefined}
      tabIndex={focused ? 0 : -1}
      style={{
        top: `${index * SCOPE_NODE_HEIGHT}px`,
        "--workbench-scope-indent": `${node.depth * 10}px`
      } as CSSProperties}
      ref={(element) => {
        if (element) nodeRefs.current.set(node.id, element);
        else nodeRefs.current.delete(node.id);
      }}
      onClick={() => {
        actionsRef.current.focus(node.id);
        actionsRef.current.commit(node.id);
      }}
      onFocus={() => actionsRef.current.focus(node.id)}
      onKeyDown={(event) => actionsRef.current.key(event, node)}
    >
      <span className="workbench-react__scope-type">{scopeKindLabel(node.kind)}</span>
      <strong className="workbench-react__scope-identity" title={node.label}>{node.label}</strong>
      <em className="workbench-react__scope-state">{lifecycleLabel(node.lifecycle)}</em>
      {node.detail ? <span className="workbench-react__scope-facts" title={node.detail}>{node.detail}</span> : null}
    </button>
  );
});

export const ScopeTree = memo(function ScopeTree({
  logicalNodeCount,
  visibleNodeCount,
  entries,
  logicalHeight,
  childrenByParent,
  siblingPositionById,
  collapsedIds,
  focusId,
  onDomFocusChange,
  treeRef,
  nodeRefs,
  actionsRef
}: {
  logicalNodeCount: number;
  visibleNodeCount: number;
  entries: readonly ScopeTreeEntry[];
  logicalHeight: number;
  childrenByParent: ReadonlyMap<
    string | null,
    readonly WorkbenchSnapshot["scope"]["structure"][number][]
  >;
  siblingPositionById: ReadonlyMap<string, { position: number; size: number }>;
  collapsedIds: ReadonlySet<string>;
  focusId: string | null;
  onDomFocusChange(hasFocus: boolean): void;
  treeRef: { current: HTMLDivElement | null };
  nodeRefs: { current: Map<string, HTMLButtonElement> };
  actionsRef: { current: ScopeTreeActions };
}): JSX.Element {
  return (
    <div
      className="workbench-react__scope-tree"
      role="tree"
      aria-label={`Runtime Scope tree · ${logicalNodeCount.toLocaleString()} nodes`}
      data-logical-node-count={logicalNodeCount}
      data-visible-node-count={visibleNodeCount}
      data-mounted-node-count={entries.length}
      ref={treeRef}
      onScroll={(event) => actionsRef.current.scroll(event.currentTarget.scrollTop)}
      onFocusCapture={() => onDomFocusChange(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onDomFocusChange(false);
      }}
    >
      <div
        className="workbench-react__scope-tree-window"
        role="presentation"
        style={{ height: `${logicalHeight}px` }}
      >
        {entries.map(({ node, index }) => {
          const siblingPosition = siblingPositionById.get(node.id);
          const hasChildren = (childrenByParent.get(node.id)?.length ?? 0) > 0;
          return (
            <ScopeTreeRow
              key={node.id}
              node={node}
              index={index}
              siblingPosition={siblingPosition}
              hasChildren={hasChildren}
              collapsed={collapsedIds.has(node.id)}
              focused={node.id === focusId}
              nodeRefs={nodeRefs}
              actionsRef={actionsRef}
            />
          );
        })}
      </div>
    </div>
  );
});

function lifecycleLabel(lifecycle: WorkbenchSnapshot["scope"]["nodes"][number]["lifecycle"]): string {
  return `${lifecycle.slice(0, 1).toUpperCase()}${lifecycle.slice(1)}`;
}

function scopeKindLabel(kind: WorkbenchSnapshot["scope"]["nodes"][number]["kind"]): string {
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;
}
