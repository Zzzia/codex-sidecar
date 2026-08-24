import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ArrowUp, FileSearch } from "lucide-react";
import { DiffViewer } from "./DiffViewer";
import { LocalFilePreviewModal } from "./LocalFilePreviewModal";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { createCodePreviewMarkdown } from "./codePreviewMarkdown";
import {
  requestLocalFilePreview,
  type LocalFileContext,
  type LocalFilePreviewState,
} from "./localFilePreview";
import { formatTimestamp, shouldShowPatchBackTop } from "./timelineHelpers";

export function PatchFilePreviewButton({
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

function PatchFileHeader({
  fileName,
  filePath,
  changeType,
  ts,
  localFileContext,
}: {
  fileName: string;
  filePath: string;
  changeType: string;
  ts: string;
  localFileContext: LocalFileContext | null;
}) {
  return (
    <>
      <span className="inline-patch-name">{fileName}</span>
      <span className="inline-patch-type">{changeType}</span>
      <time>{formatTimestamp(ts)}</time>
      <PatchFilePreviewButton
        fileName={fileName}
        filePath={filePath}
        changeType={changeType}
        localFileContext={localFileContext}
      />
    </>
  );
}

export function InlinePatchFile({
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
  const header = (
    <PatchFileHeader
      fileName={fileName}
      filePath={filePath}
      changeType={changeType}
      ts={ts}
      localFileContext={localFileContext}
    />
  );

  if (!unifiedDiff.trim()) {
    return (
      <article className="inline-patch-file is-status-only">
        <div className="inline-patch-header">{header}</div>
      </article>
    );
  }

  return (
    <ExpandablePatchFile
      fileName={fileName}
      unifiedDiff={unifiedDiff}
      changeType={changeType}
      header={header}
    />
  );
}

function ExpandablePatchFile({
  fileName,
  unifiedDiff,
  changeType,
  header,
}: {
  fileName: string;
  unifiedDiff: string;
  changeType: string;
  header: ReactNode;
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
        {header}
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
