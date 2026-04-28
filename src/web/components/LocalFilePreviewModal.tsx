import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  LocalFileContext,
  LocalFilePreviewState,
} from "./localFilePreview";

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
    return state.status === "loading" ? "读取中" : "无法预览";
  }
  if (state.preview.kind === "markdown") {
    return "Markdown";
  }
  if (state.preview.kind === "code") {
    return "代码";
  }
  if (state.preview.kind === "image") {
    return "图片";
  }
  if (state.preview.kind === "pdf") {
    return "PDF";
  }
  return "不可预览";
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
        ? "正在读取本地文件"
        : "无法预览";

  return createPortal(
    <div className="local-file-modal-backdrop" onClick={onClose}>
      <div
        className="local-file-modal"
        role="dialog"
        aria-modal="true"
        aria-label="本地文件预览"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="local-file-modal-header">
          <div className="local-file-modal-title-wrap">
            <div className="local-file-modal-eyebrow">本地文件预览</div>
            <h3 title={title}>{title}</h3>
            <div className="local-file-modal-meta">{meta}</div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭预览">
            ×
          </button>
        </header>

        <div className="local-file-modal-body">
          {state.status === "loading" ? (
            <div className="local-file-modal-empty">文件读取中…</div>
          ) : null}

          {state.status === "error" ? (
            <div className="local-file-modal-empty">{state.message}</div>
          ) : null}

          {state.status === "ready" && state.preview.kind === "unsupported" ? (
            <div className="local-file-modal-empty">
              {state.preview.reason ?? "这个文件类型暂不支持预览"}
            </div>
          ) : null}

          {state.status === "ready" && state.preview.kind === "markdown"
            ? renderMarkdown(state.preview.content ?? "", context)
            : null}

          {state.status === "ready" && state.preview.kind === "code" ? (
            renderCode ? (
              renderCode(state.preview.content ?? "", state.preview.displayPath, context)
            ) : (
              <pre className="code-block local-file-code">
                <code>{state.preview.content ?? ""}</code>
              </pre>
            )
          ) : null}

          {state.status === "ready" && state.preview.kind === "image" ? (
            state.preview.dataUrl ? (
              <div className="local-file-media-frame">
                <img src={state.preview.dataUrl} alt={state.preview.displayPath} />
              </div>
            ) : (
              <div className="local-file-modal-empty">图片内容为空，无法预览</div>
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
              <div className="local-file-modal-empty">PDF 内容为空，无法预览</div>
            )
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
