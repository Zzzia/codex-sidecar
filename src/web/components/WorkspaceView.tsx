import { Fragment, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  autoDistributeWorkspace,
  closeLeafInWorkspace,
  setActiveLeaf,
  swapWithSibling,
  toggleLeafCollapse,
  toggleParentOrientation,
  updateSplitSizes,
  type WorkspaceNode,
  type WorkspaceState,
} from "@web/state/workspace";
import { PaneView } from "./PaneView";

interface WorkspaceViewProps {
  state: WorkspaceState;
  onChange: (updater: (state: WorkspaceState) => WorkspaceState) => void;
}

const FLOATING_FADE_MS = 140;

function hasLeaf(node: WorkspaceNode | null, leafId: string): boolean {
  if (!node) {
    return false;
  }
  if (node.type === "leaf") {
    return node.id === leafId;
  }
  return hasLeaf(node.children[0], leafId) || hasLeaf(node.children[1], leafId);
}

function renderNode(
  node: WorkspaceNode,
  state: WorkspaceState,
  onChange: WorkspaceViewProps["onChange"],
  suspended: boolean,
  onResizeStart: () => void,
  floatingLeafId: string | null,
  closingFloatingLeafId: string | null,
  onOpenFloating: (leafId: string) => void,
  onCloseFloating: () => void,
  onCloseFloatingImmediately: () => void,
  onAutoDistribute: () => void,
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
        onSelect={() => onChange((current) => setActiveLeaf(current, node.id))}
        onClose={() => {
          onChange((current) => closeLeafInWorkspace(current, node.id));
          if (isFloating) {
            onCloseFloatingImmediately();
          }
        }}
        onToggleCollapse={() =>
          onChange((current) => toggleLeafCollapse(current, node.id))
        }
        onSwap={() => onChange((current) => swapWithSibling(current, node.id))}
        onToggleOrientation={() =>
          onChange((current) => toggleParentOrientation(current, node.id))
        }
        onAutoDistribute={onAutoDistribute}
        onToggleFloating={() => {
          if (isFloating) {
            onCloseFloating();
            return;
          }

          if (node.collapsed) {
            onChange((current) => toggleLeafCollapse(current, node.id));
          }
          onChange((current) => setActiveLeaf(current, node.id));
          onOpenFloating(node.id);
        }}
      />
    );
  }

  const layout = {
    [node.children[0].id]: node.sizes[0],
    [node.children[1].id]: node.sizes[1],
  };

  return (
    <Group
      key={`${node.id}:${node.revision}`}
      orientation={node.orientation}
      defaultLayout={layout}
      onLayoutChange={(nextLayout) =>
        onChange((current) =>
          updateSplitSizes(current, node.id, [
            nextLayout[node.children[0].id] ?? node.sizes[0],
            nextLayout[node.children[1].id] ?? node.sizes[1],
          ]),
        )
      }
      className={`workspace-group orientation-${node.orientation}`}
    >
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          <Panel
            id={child.id}
            minSize={child.type === "leaf" && child.collapsed ? "8%" : "20%"}
          >
            {renderNode(
              child,
              state,
              onChange,
              suspended,
              onResizeStart,
              floatingLeafId,
              closingFloatingLeafId,
              onOpenFloating,
              onCloseFloating,
              onCloseFloatingImmediately,
              onAutoDistribute,
            )}
          </Panel>
          {index === 0 ? (
            <Separator
              className="workspace-separator"
              onPointerDown={onResizeStart}
            />
          ) : null}
        </Fragment>
      ))}
    </Group>
  );
}

export function WorkspaceView({ state, onChange }: WorkspaceViewProps) {
  const [isResizing, setIsResizing] = useState(false);
  const [floatingLeafId, setFloatingLeafId] = useState<string | null>(null);
  const [closingFloatingLeafId, setClosingFloatingLeafId] = useState<string | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const floatingCloseTimerRef = useRef<number | null>(null);

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

  const beginResize = () => {
    markLayoutChanging();
  };

  const autoDistribute = () => {
    markLayoutChanging();
    onChange(autoDistributeWorkspace);
  };

  const clearFloatingCloseTimer = () => {
    if (floatingCloseTimerRef.current != null) {
      window.clearTimeout(floatingCloseTimerRef.current);
      floatingCloseTimerRef.current = null;
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
    const settleResize = () => {
      if (!isResizing) {
        return;
      }

      scheduleSettle();
    };

    window.addEventListener("pointerup", settleResize);
    window.addEventListener("pointercancel", settleResize);
    window.addEventListener("resize", markLayoutChanging);
    return () => {
      window.removeEventListener("pointerup", settleResize);
      window.removeEventListener("pointercancel", settleResize);
      window.removeEventListener("resize", markLayoutChanging);
    };
  }, [isResizing]);

  useEffect(() => {
    return () => {
      clearSettleTimer();
      clearFloatingCloseTimer();
    };
  }, []);

  if (!state.root) {
    return (
      <section className="workspace-empty">
        <div className="workspace-empty-eyebrow">Codex App</div>
        <h2>从左侧打开一个会话</h2>
        <p>
          这里会以多分屏方式并排展示不同工程的 Codex 会话，支持折叠、换位和横竖切分。
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
          aria-label="退出浮窗"
          onClick={closeFloating}
        />
      ) : null}
      {renderNode(
        state.root,
        state,
        onChange,
        isResizing,
        beginResize,
        floatingLeafId,
        closingFloatingLeafId,
        openFloating,
        closeFloating,
        closeFloatingImmediately,
        autoDistribute,
      )}
    </section>
  );
}
