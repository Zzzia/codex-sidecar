import type { ReactNode } from "react";
import type {
  LocalFileContext,
  LocalFilePreviewState,
} from "./localFilePreview";
import { CopyableCodeBlock } from "./CopyableCodeBlock";
import { PreviewModalShell } from "./PreviewModalShell";

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function previewKindLabel(state: LocalFilePreviewState): string {
  if (state.status !== "ready") {
    return state.status === "loading" ? "Loading" : "Preview unavailable";
  }
  if (state.preview.kind === "markdown") {
    return "Markdown";
  }
  if (state.preview.kind === "code") {
    return "Code";
  }
  if (state.preview.kind === "image") {
    return "Image";
  }
  if (state.preview.kind === "pdf") {
    return "PDF";
  }
  return "Unsupported";
}

export function LocalFilePreviewModal({
  context,
  state,
  renderMarkdown,
  renderCode,
  onClose,
}: {
  context: LocalFileContext;
  state: LocalFilePreviewState;
  renderMarkdown: (text: string, context: LocalFileContext) => ReactNode;
  renderCode?: (text: string, displayPath: string, context: LocalFileContext) => ReactNode;
  onClose: () => void;
}) {
  const title =
    state.status === "ready" ? state.preview.displayPath : state.href;
  const meta =
    state.status === "ready"
      ? `${previewKindLabel(state)} · ${formatBytes(state.preview.size)}`
      : state.status === "loading"
        ? "Reading local file"
        : "Preview unavailable";

  return (
    <PreviewModalShell
      ariaLabel="Local file preview"
      eyebrow="Local file preview"
      title={<h3 title={title}>{title}</h3>}
      titleText={title}
      meta={meta}
      bodyClassName="local-file-preview-body"
      onClose={onClose}
    >
      {state.status === "loading" ? (
        <div className="local-file-modal-empty">Reading file...</div>
      ) : null}

      {state.status === "error" ? (
        <div className="local-file-modal-empty">{state.message}</div>
      ) : null}

      {state.status === "ready" && state.preview.kind === "unsupported" ? (
        <div className="local-file-modal-empty">
          {state.preview.reason ?? "This file type is not supported for preview"}
        </div>
      ) : null}

      {state.status === "ready" && state.preview.kind === "markdown"
        ? renderMarkdown(state.preview.content ?? "", context)
        : null}

      {state.status === "ready" && state.preview.kind === "code" ? (
        renderCode ? (
          renderCode(state.preview.content ?? "", state.preview.displayPath, context)
        ) : (
          <CopyableCodeBlock
            className="code-block local-file-code"
            copyText={state.preview.content ?? ""}
          >
            <code>{state.preview.content ?? ""}</code>
          </CopyableCodeBlock>
        )
      ) : null}

      {state.status === "ready" && state.preview.kind === "image" ? (
        state.preview.dataUrl ? (
          <div className="local-file-media-frame">
            <img src={state.preview.dataUrl} alt={state.preview.displayPath} />
          </div>
        ) : (
          <div className="local-file-modal-empty">Image content is empty and cannot be previewed</div>
        )
      ) : null}

      {state.status === "ready" && state.preview.kind === "pdf" ? (
        state.preview.dataUrl ? (
          <iframe
            className="local-file-pdf-frame"
            src={state.preview.dataUrl}
            title={state.preview.displayPath}
          />
        ) : (
          <div className="local-file-modal-empty">PDF content is empty and cannot be previewed</div>
        )
      ) : null}
    </PreviewModalShell>
  );
}
