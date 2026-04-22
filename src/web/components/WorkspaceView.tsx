import { Fragment, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
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
  sidebarOpen: boolean;
  onChange: (updater: (state: WorkspaceState) => WorkspaceState) => void;
}

function renderNode(
  node: WorkspaceNode,
  state: WorkspaceState,
  onChange: WorkspaceViewProps["onChange"],
  suspended: boolean,
  onResizeStart: () => void,
): JSX.Element {
  if (node.type === "leaf") {
    return (
      <PaneView
        threadId={node.threadId}
        collapsed={node.collapsed}
        suspended={suspended}
        active={state.activeLeafId === node.id}
        onSelect={() => onChange((current) => setActiveLeaf(current, node.id))}
        onClose={() => onChange((current) => closeLeafInWorkspace(current, node.id))}
        onToggleCollapse={() =>
          onChange((current) => toggleLeafCollapse(current, node.id))
        }
        onSwap={() => onChange((current) => swapWithSibling(current, node.id))}
        onToggleOrientation={() =>
          onChange((current) => toggleParentOrientation(current, node.id))
        }
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
            {renderNode(child, state, onChange, suspended, onResizeStart)}
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

export function WorkspaceView({ state, sidebarOpen, onChange }: WorkspaceViewProps) {
  const [isResizing, setIsResizing] = useState(false);
  const settleTimerRef = useRef<number | null>(null);
  const didMountRef = useRef(false);
  const previousSidebarOpenRef = useRef(sidebarOpen);

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

  useEffect(() => {
    if (!state.root) {
      previousSidebarOpenRef.current = sidebarOpen;
      return;
    }

    if (!didMountRef.current) {
      didMountRef.current = true;
      previousSidebarOpenRef.current = sidebarOpen;
      return;
    }

    if (previousSidebarOpenRef.current !== sidebarOpen) {
      previousSidebarOpenRef.current = sidebarOpen;
      markLayoutChanging();
    }
  }, [sidebarOpen, state.root]);

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
      {renderNode(state.root, state, onChange, isResizing, beginResize)}
    </section>
  );
}
