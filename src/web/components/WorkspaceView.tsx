import { Fragment } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  closeLeafInWorkspace,
  setActiveLeaf,
  swapWithSibling,
  toggleLeafCollapse,
  toggleParentOrientation,
  updateSplitSizes,
  type WorkspaceLeaf,
  type WorkspaceNode,
  type WorkspaceState,
} from "@web/state/workspace";
import { PaneView } from "./PaneView";

interface WorkspaceViewProps {
  state: WorkspaceState;
  onChange: (updater: (state: WorkspaceState) => WorkspaceState) => void;
}

function renderNode(
  node: WorkspaceNode,
  state: WorkspaceState,
  onChange: WorkspaceViewProps["onChange"],
): JSX.Element {
  if (node.type === "leaf") {
    return (
      <PaneView
        threadId={node.threadId}
        collapsed={node.collapsed}
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
          <Panel id={child.id} minSize={child.type === "leaf" && child.collapsed ? "8%" : "20%"}>
            {renderNode(child, state, onChange)}
          </Panel>
          {index === 0 ? <Separator className="workspace-separator" /> : null}
        </Fragment>
      ))}
    </Group>
  );
}

export function WorkspaceView({ state, onChange }: WorkspaceViewProps) {
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

  return <section className="workspace-root">{renderNode(state.root, state, onChange)}</section>;
}
