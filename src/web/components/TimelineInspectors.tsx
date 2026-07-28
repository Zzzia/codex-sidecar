import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUp, FileSearch, X } from "lucide-react";
import type { PatchRunView, ExplorationStepView, ToolRunView } from "@web/lib/turns";
import { CopyableCodeBlock } from "./CopyableCodeBlock";
import { DiffViewer } from "./DiffViewer";
import { LocalFilePreviewModal } from "./LocalFilePreviewModal";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { createCodePreviewMarkdown } from "./codePreviewMarkdown";
import {
  requestLocalFilePreview,
  type LocalFileContext,
  type LocalFilePreviewState,
} from "./localFilePreview";
import {
  formatTimestamp,
  shouldShowPatchBackTop,
  summarizeExplorationStep,
} from "./timelineHelpers";

function toolLabel(name: string): string {
  return name === "exec_command" || name === "exec" ? "Run" : name;
}

function renderPageModal(content: ReactNode): ReactNode {
  if (typeof document === "undefined") {
    return content;
  }
  return createPortal(content, document.body);
}

function formatWallTime(seconds: number): string {
  return seconds < 10 ? `${seconds.toFixed(4)}s` : `${seconds.toFixed(2)}s`;
}

function commandExecutionState(tool: ToolRunView): string {
  if ((tool.name !== "exec_command" && tool.name !== "exec") || !tool.result) {
    return "";
  }

  if (tool.result.processId) {
    return `Running in background · session ${tool.result.processId}`;
  }

  if (tool.result.exitCode != null) {
    return tool.result.exitCode === 0
      ? "Completed · exit 0"
      : `Completed · exit ${tool.result.exitCode}`;
  }

  return "";
}

function PatchFilePreviewButton({
  fileName,
  filePath,
  changeType,
  localFileContext,
}: {
  fileName: string;
  filePath?: string;
  changeType: string;
  localFileContext?: LocalFileContext | null;
}) {
  const [filePreviewState, setFilePreviewState] =
    useState<LocalFilePreviewState | null>(null);
  const previewHref = filePath || fileName;
  const canPreviewFile =
    Boolean(localFileContext) && previewHref.trim().length > 0 && changeType !== "delete";

  if (!canPreviewFile) {
    return null;
  }

  const openFilePreview = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!localFileContext) {
      return;
    }

    setFilePreviewState({ status: "loading", href: previewHref });
    requestLocalFilePreview(localFileContext, previewHref)
      .then((preview) => {
        setFilePreviewState({ status: "ready", href: previewHref, preview });
      })
      .catch((error: unknown) => {
        setFilePreviewState({
          status: "error",
          href: previewHref,
          message: error instanceof Error ? error.message : "File preview failed",
        });
      });
  };

  return (
    <>
      <button
        type="button"
        className="patch-preview-button"
        title="Preview full file"
        aria-label={`Preview full file：${fileName}`}
        onClick={openFilePreview}
      >
        <FileSearch size={14} />
      </button>
      {filePreviewState && localFileContext ? (
        <LocalFilePreviewModal
          context={localFileContext}
          state={filePreviewState}
          renderMarkdown={(markdownText, context) => (
            <MarkdownRenderer text={markdownText} localFileContext={context} />
          )}
          renderCode={(codeText, displayPath, context) => (
            <MarkdownRenderer
              text={createCodePreviewMarkdown(codeText, displayPath)}
              localFileContext={context}
              codeBlockLineNumbers
            />
          )}
          onClose={() => setFilePreviewState(null)}
        />
      ) : null}
    </>
  );
}

export function PatchPreview({
  fileName,
  filePath,
  unifiedDiff,
  changeType = "update",
  defaultExpanded = false,
  localFileContext,
}: {
  fileName: string;
  filePath?: string;
  unifiedDiff: string;
  changeType?: string;
  defaultExpanded?: boolean;
  localFileContext?: LocalFileContext | null;
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
      <summary className="tool-patch-summary">
        <span className="tool-patch-summary-name">{fileName}</span>
        <PatchFilePreviewButton
          fileName={fileName}
          filePath={filePath}
          changeType={changeType}
          localFileContext={localFileContext}
        />
      </summary>
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
  filePath,
  unifiedDiff,
  changeType,
  ts,
  localFileContext,
}: {
  fileName: string;
  filePath: string;
  unifiedDiff: string;
  changeType: string;
  ts: string;
  localFileContext: LocalFileContext | null;
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
        <PatchFilePreviewButton
          fileName={fileName}
          filePath={filePath}
          changeType={changeType}
          localFileContext={localFileContext}
        />
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
                title="Back to patch top"
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

export function InlinePatchRun({
  item,
  localFileContext,
}: {
  item: PatchRunView;
  localFileContext: LocalFileContext | null;
}) {
  return (
    <section className="turn-patch-block">
      <div className="turn-patch-list always-open">
        {item.changes.map((change) => (
          <InlinePatchFile
            key={`${item.id}:${change.path}`}
            fileName={change.displayPath}
            filePath={change.path}
            unifiedDiff={change.unifiedDiff}
            changeType={change.changeType}
            ts={item.ts}
            localFileContext={localFileContext}
          />
        ))}
      </div>
    </section>
  );
}

function ToolRunDetails({
  tool,
  localFileContext,
}: {
  tool: ToolRunView;
  localFileContext?: LocalFileContext | null;
}) {
  const invocationText = tool.commandText || tool.invocationText;
  const invocationTitle = tool.commandText ? "Command" : "Invocation";
  const executionState = commandExecutionState(tool);

  return (
    <>
      {invocationText ? (
        <section className="tool-modal-section">
          <h4>{invocationTitle}</h4>
          <CopyableCodeBlock className="code-block" copyText={invocationText}>
            {invocationText}
          </CopyableCodeBlock>
        </section>
      ) : null}

      {executionState ? (
        <section className="tool-modal-section">
          <h4>Execution state</h4>
          <div className="tool-execution-state">{executionState}</div>
        </section>
      ) : null}

      {tool.result?.outputText ? (
        <section className="tool-modal-section">
          <h4>Tool output</h4>
          <CopyableCodeBlock
            className="code-block"
            copyText={tool.result.outputText}
          >
            {tool.result.outputText}
          </CopyableCodeBlock>
        </section>
      ) : null}

      {tool.result?.stderrText ? (
        <section className="tool-modal-section">
          <h4>Error output</h4>
          <CopyableCodeBlock
            className="code-block"
            copyText={tool.result.stderrText}
          >
            {tool.result.stderrText}
          </CopyableCodeBlock>
        </section>
      ) : null}

      {tool.patchChanges.length > 0 ? (
        <section className="tool-modal-section">
          <h4>Code changes</h4>
          <div className="tool-patch-list">
            {tool.patchChanges.map((change) => (
              <PatchPreview
                key={`${tool.id}:${change.path}`}
                fileName={change.displayPath}
                filePath={change.path}
                unifiedDiff={change.unifiedDiff}
                changeType={change.changeType}
                localFileContext={localFileContext}
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
  localFileContext,
  onClose,
}: {
  tool: ToolRunView;
  localFileContext?: LocalFileContext | null;
  onClose: () => void;
}) {
  return renderPageModal(
    <div className="tool-modal-backdrop" onClick={onClose}>
      <div
        className="tool-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <header className="tool-modal-header">
          <div className="tool-modal-title-wrap">
            <div className="tool-modal-eyebrow">{toolLabel(tool.name)}</div>
            <h3 title={tool.preview}>{tool.preview}</h3>
          </div>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </header>

        <div className="tool-modal-meta">
          <span>{formatTimestamp(tool.ts)}</span>
          {tool.result?.exitCode != null ? <span>exit {tool.result.exitCode}</span> : null}
          {tool.result?.processId ? <span>session {tool.result.processId}</span> : null}
          {tool.result?.wallTimeSeconds != null ? (
            <span>{formatWallTime(tool.result.wallTimeSeconds)}</span>
          ) : null}
          {tool.patchSummary ? <span>{tool.patchSummary}</span> : null}
        </div>

        <ToolRunDetails tool={tool} localFileContext={localFileContext} />
      </div>
    </div>,
  );
}

export function ExplorationDetailsModal({
  step,
  localFileContext,
  onClose,
}: {
  step: ExplorationStepView;
  localFileContext?: LocalFileContext | null;
  onClose: () => void;
}) {
  const stepSummary = summarizeExplorationStep(step);

  return renderPageModal(
    <div className="tool-modal-backdrop" onClick={onClose}>
      <div
        className="tool-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <header className="tool-modal-header">
          <div className="tool-modal-title-wrap">
            <div className="tool-modal-eyebrow">Exploration</div>
            <h3 title={stepSummary}>{stepSummary}</h3>
          </div>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </header>

        <div className="tool-modal-meta">
          <span>{formatTimestamp(step.ts)}</span>
          <span>{step.tools.length} commands</span>
        </div>

        {step.tools.map((tool) => (
          <div key={tool.id} className="tool-modal-call-block">
            <div className="tool-modal-call-title">{tool.preview}</div>
            <ToolRunDetails tool={tool} localFileContext={localFileContext} />
          </div>
        ))}
      </div>
    </div>,
  );
}
