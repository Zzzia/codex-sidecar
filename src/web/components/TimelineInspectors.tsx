import { useEffect, useRef, useState } from "react";
import { ArrowUp, X } from "lucide-react";
import type { PatchRunView, ExplorationStepView, ToolRunView } from "@web/lib/turns";
import { DiffViewer } from "./DiffViewer";
import {
  formatTimestamp,
  shouldShowPatchBackTop,
  summarizeExplorationStep,
} from "./timelineHelpers";

function toolLabel(name: string): string {
  return name === "exec_command" ? "Run" : name;
}

export function PatchPreview({
  fileName,
  unifiedDiff,
  changeType = "update",
  defaultExpanded = false,
}: {
  fileName: string;
  unifiedDiff: string;
  changeType?: string;
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);

  return (
    <details
      className="tool-patch-item"
      open={open}
      onToggle={(event) => {
        setOpen((event.currentTarget as HTMLDetailsElement).open);
      }}
    >
      <summary>{fileName}</summary>
      {open ? (
        <DiffViewer
          fileName={fileName}
          unifiedDiff={unifiedDiff}
          changeType={changeType}
        />
      ) : null}
    </details>
  );
}

function InlinePatchFile({
  fileName,
  unifiedDiff,
  changeType,
  ts,
}: {
  fileName: string;
  unifiedDiff: string;
  changeType: string;
  ts: string;
}) {
  const [open, setOpen] = useState(true);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const diffContentRef = useRef<HTMLDivElement | null>(null);
  const [showBackTop, setShowBackTop] = useState(false);

  useEffect(() => {
    if (!open) {
      setShowBackTop(false);
      return;
    }

    const updateVisibility = () => {
      const diffContent = diffContentRef.current;
      if (!diffContent) {
        setShowBackTop(false);
        return;
      }

      setShowBackTop(
        shouldShowPatchBackTop(diffContent.scrollHeight, window.innerHeight),
      );
    };

    const frameId = window.requestAnimationFrame(updateVisibility);
    let observer: ResizeObserver | null = null;

    if (typeof ResizeObserver !== "undefined" && bodyRef.current) {
      observer = new ResizeObserver(() => {
        updateVisibility();
      });
      observer.observe(bodyRef.current);
    }

    window.addEventListener("resize", updateVisibility);
    return () => {
      window.cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener("resize", updateVisibility);
    };
  }, [open, unifiedDiff]);

  return (
    <details
      ref={detailsRef}
      className="inline-patch-file"
      open={open}
      onToggle={(event) => {
        setOpen((event.currentTarget as HTMLDetailsElement).open);
      }}
    >
      <summary className="inline-patch-header">
        <span className="inline-patch-toggle" aria-hidden="true" />
        <span className="inline-patch-name">{fileName}</span>
        <span className="inline-patch-type">{changeType}</span>
        <time>{formatTimestamp(ts)}</time>
      </summary>
      {open ? (
        <div ref={bodyRef} className="inline-patch-body">
          <div ref={diffContentRef}>
            <DiffViewer
              fileName={fileName}
              unifiedDiff={unifiedDiff}
              changeType={changeType}
            />
          </div>
          {showBackTop ? (
            <div className="inline-patch-actions">
              <button
                type="button"
                className="inline-patch-backtop"
                title="回到此 patch 顶部"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  detailsRef.current?.scrollIntoView({
                    behavior: "auto",
                    block: "start",
                  });
                }}
              >
                <ArrowUp size={12} />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

export function InlinePatchRun({ item }: { item: PatchRunView }) {
  return (
    <section className="turn-patch-block">
      <div className="turn-patch-list always-open">
        {item.changes.map((change) => (
          <InlinePatchFile
            key={`${item.id}:${change.path}`}
            fileName={change.displayPath}
            unifiedDiff={change.unifiedDiff}
            changeType={change.changeType}
            ts={item.ts}
          />
        ))}
      </div>
    </section>
  );
}

function ToolRunDetails({ tool }: { tool: ToolRunView }) {
  const invocationText = tool.commandText || tool.invocationText;
  const invocationTitle = tool.commandText ? "命令" : "调用内容";

  return (
    <>
      {invocationText ? (
        <section className="tool-modal-section">
          <h4>{invocationTitle}</h4>
          <pre className="code-block">{invocationText}</pre>
        </section>
      ) : null}

      {tool.result?.outputText ? (
        <section className="tool-modal-section">
          <h4>工具输出</h4>
          <pre className="code-block">{tool.result.outputText}</pre>
        </section>
      ) : null}

      {tool.result?.stderrText ? (
        <section className="tool-modal-section">
          <h4>错误输出</h4>
          <pre className="code-block">{tool.result.stderrText}</pre>
        </section>
      ) : null}

      {tool.patchChanges.length > 0 ? (
        <section className="tool-modal-section">
          <h4>代码修改</h4>
          <div className="tool-patch-list">
            {tool.patchChanges.map((change) => (
              <PatchPreview
                key={`${tool.id}:${change.path}`}
                fileName={change.displayPath}
                unifiedDiff={change.unifiedDiff}
                changeType={change.changeType}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

export function ToolDetailsModal({
  tool,
  onClose,
}: {
  tool: ToolRunView;
  onClose: () => void;
}) {
  return (
    <div className="tool-modal-backdrop" onClick={onClose}>
      <div
        className="tool-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <header className="tool-modal-header">
          <div>
            <div className="tool-modal-eyebrow">{toolLabel(tool.name)}</div>
            <h3>{tool.preview}</h3>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="tool-modal-meta">
          <span>{formatTimestamp(tool.ts)}</span>
          {tool.result?.exitCode != null ? <span>exit {tool.result.exitCode}</span> : null}
          {tool.patchSummary ? <span>{tool.patchSummary}</span> : null}
        </div>

        <ToolRunDetails tool={tool} />
      </div>
    </div>
  );
}

export function ExplorationDetailsModal({
  step,
  onClose,
}: {
  step: ExplorationStepView;
  onClose: () => void;
}) {
  return (
    <div className="tool-modal-backdrop" onClick={onClose}>
      <div
        className="tool-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <header className="tool-modal-header">
          <div>
            <div className="tool-modal-eyebrow">探索</div>
            <h3>{summarizeExplorationStep(step)}</h3>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="tool-modal-meta">
          <span>{formatTimestamp(step.ts)}</span>
          <span>{step.tools.length} 条命令</span>
        </div>

        {step.tools.map((tool) => (
          <div key={tool.id} className="tool-modal-call-block">
            <div className="tool-modal-call-title">{tool.preview}</div>
            <ToolRunDetails tool={tool} />
          </div>
        ))}
      </div>
    </div>
  );
}
