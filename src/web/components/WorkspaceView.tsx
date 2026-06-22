import { useEffect, useRef, useState } from "react";
import {
  autoDistributeWorkspace,
  closeLeafInWorkspace,
  setActiveLeaf,
  swapWithSibling,
  toggleLeafCollapse,
  toggleParentOrientation,
  type WorkspaceNode,
  type WorkspaceState,
} from "@web/state/workspace";
import { PaneView } from "./PaneView";

interface WorkspaceViewProps {
  state: WorkspaceState;
  onChange: (updater: (state: WorkspaceState) => WorkspaceState) => void;
  pinnedThreadIds?: readonly string[];
  onCloseThread?: (threadId: string) => void;
  onToggleThreadPin?: (threadId: string) => void;
}

const FLOATING_FADE_MS = 140;
const WINDOW_RESIZE_DISTRIBUTE_MS = 120;

function hasLeaf(node: WorkspaceNode | null, leafId: string): boolean {
  if (!node) {
    return false;
  }
  if (node.type === "leaf") {
    return node.id === leafId;
  }
  return hasLeaf(node.children[0], leafId) || hasLeaf(node.children[1], leafId);
}

function splitLayoutStyle(node: Extract<WorkspaceNode, { type: "split" }>) {
  const tracks = [
    `minmax(0, ${node.sizes[0]}fr)`,
    `minmax(0, ${node.sizes[1]}fr)`,
  ].join(" ");

  return node.orientation === "horizontal"
    ? { gridTemplateColumns: tracks }
    : { gridTemplateRows: tracks };
}

function renderNode(
  node: WorkspaceNode,
  state: WorkspaceState,
  props: WorkspaceViewProps,
  suspended: boolean,
  floatingLeafId: string | null,
  closingFloatingLeafId: string | null,
  onOpenFloating: (leafId: string) => void,
  onCloseFloating: () => void,
  onCloseFloatingImmediately: () => void,
): JSX.Element {
  if (node.type === "leaf") {
    const isFloating = floatingLeafId === node.id;

    return (
      <PaneView
        paneId={node.id}
        threadId={node.threadId}
        collapsed={node.collapsed}
        suspended={suspended}
        active={state.activeLeafId === node.id}
        floating={isFloating}
        floatingClosing={closingFloatingLeafId === node.id}
        pinned={props.pinnedThreadIds?.includes(node.threadId) ?? false}
        onSelect={() => props.onChange((current) => setActiveLeaf(current, node.id))}
        onClose={() => {
          props.onChange((current) => closeLeafInWorkspace(current, node.id));
          props.onCloseThread?.(node.threadId);
          if (isFloating) {
            onCloseFloatingImmediately();
          }
        }}
        onToggleCollapse={() =>
          props.onChange((current) => toggleLeafCollapse(current, node.id))
        }
        onSwap={() => props.onChange((current) => swapWithSibling(current, node.id))}
        onTogglePin={
          props.onToggleThreadPin
            ? () => props.onToggleThreadPin?.(node.threadId)
            : undefined
        }
        onToggleOrientation={() =>
          props.onChange((current) => toggleParentOrientation(current, node.id))
        }
        onToggleFloating={() => {
          if (isFloating) {
            onCloseFloating();
            return;
          }

          if (node.collapsed) {
            props.onChange((current) => toggleLeafCollapse(current, node.id));
          }
          props.onChange((current) => setActiveLeaf(current, node.id));
          onOpenFloating(node.id);
        }}
      />
    );
  }

  return (
    <div
      key={`${node.id}:${node.revision}`}
      className={`workspace-split workspace-group orientation-${node.orientation}`}
      style={splitLayoutStyle(node)}
    >
      {node.children.map((child) => (
        <div
          key={child.id}
          className="workspace-panel"
          data-panel-id={child.id}
        >
          {renderNode(
            child,
            state,
            props,
            suspended,
            floatingLeafId,
            closingFloatingLeafId,
            onOpenFloating,
            onCloseFloating,
            onCloseFloatingImmediately,
          )}
        </div>
      ))}
    </div>
  );
}

export function WorkspaceView(props: WorkspaceViewProps) {
  const { state, onChange } = props;
  const [isResizing, setIsResizing] = useState(false);
  const [floatingLeafId, setFloatingLeafId] = useState<string | null>(null);
  const [closingFloatingLeafId, setClosingFloatingLeafId] = useState<string | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const floatingCloseTimerRef = useRef<number | null>(null);
  const windowResizeTimerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const clearSettleTimer = () => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  };

  const scheduleSettle = () => {
    clearSettleTimer();
    settleTimerRef.current = window.setTimeout(() => {
      setIsResizing(false);
      settleTimerRef.current = null;
    }, 500);
  };

  const markLayoutChanging = () => {
    setIsResizing(true);
    scheduleSettle();
  };

  const clearFloatingCloseTimer = () => {
    if (floatingCloseTimerRef.current != null) {
      window.clearTimeout(floatingCloseTimerRef.current);
      floatingCloseTimerRef.current = null;
    }
  };

  const clearWindowResizeTimer = () => {
    if (windowResizeTimerRef.current != null) {
      window.clearTimeout(windowResizeTimerRef.current);
      windowResizeTimerRef.current = null;
    }
  };

  const openFloating = (leafId: string) => {
    clearFloatingCloseTimer();
    setClosingFloatingLeafId(null);
    setFloatingLeafId(leafId);
  };

  const closeFloatingImmediately = () => {
    clearFloatingCloseTimer();
    setClosingFloatingLeafId(null);
    setFloatingLeafId(null);
  };

  const closeFloating = () => {
    if (!floatingLeafId || closingFloatingLeafId) {
      return;
    }

    setClosingFloatingLeafId(floatingLeafId);
    floatingCloseTimerRef.current = window.setTimeout(() => {
      closeFloatingImmediately();
    }, FLOATING_FADE_MS);
  };

  useEffect(() => {
    if (floatingLeafId && !hasLeaf(state.root, floatingLeafId)) {
      closeFloatingImmediately();
    }
  }, [floatingLeafId, state.root]);

  useEffect(() => {
    const redistributeAfterWindowResize = () => {
      markLayoutChanging();
      clearWindowResizeTimer();
      windowResizeTimerRef.current = window.setTimeout(() => {
        windowResizeTimerRef.current = null;
        onChangeRef.current(autoDistributeWorkspace);
      }, WINDOW_RESIZE_DISTRIBUTE_MS);
    };

    window.addEventListener("resize", redistributeAfterWindowResize);
    return () => {
      window.removeEventListener("resize", redistributeAfterWindowResize);
      clearWindowResizeTimer();
    };
  }, []);

  useEffect(() => {
    return () => {
      clearSettleTimer();
      clearFloatingCloseTimer();
      clearWindowResizeTimer();
    };
  }, []);

  if (!state.root) {
    return (
      <section className="workspace-empty">
        <div className="workspace-empty-eyebrow">Codex App</div>
        <h2>Open a session from the left sidebar</h2>
        <p>
          Codex sessions from different projects appear here as panes, with collapse, swap, and split-orientation controls.
        </p>
      </section>
    );
  }

  return (
    <section className="workspace-root">
      {floatingLeafId ? (
        <button
          type="button"
          className={`workspace-floating-backdrop ${
            closingFloatingLeafId ? "is-closing" : ""
          }`}
          aria-label="Exit floating view"
          onClick={closeFloating}
        />
      ) : null}
      {renderNode(
        state.root,
        state,
        props,
        isResizing,
        floatingLeafId,
        closingFloatingLeafId,
        openFloating,
        closeFloating,
        closeFloatingImmediately,
      )}
    </section>
  );
}
