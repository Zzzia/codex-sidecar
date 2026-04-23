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

export function LocalFilePreviewModal({
  context,
  state,
  renderMarkdown,
  onClose,
}: {
  context: LocalFileContext;
  state: LocalFilePreviewState;
  renderMarkdown: (text: string, context: LocalFileContext) => ReactNode;
  onClose: () => void;
}) {
  const title =
    state.status === "ready" ? state.preview.displayPath : state.href;
  const readyKind =
    state.status === "ready" && state.preview.kind === "markdown"
      ? "Markdown"
      : state.status === "ready" && state.preview.kind === "code"
        ? "代码"
        : "不可预览";
  const meta =
    state.status === "ready"
      ? `${readyKind} · ${formatBytes(state.preview.size)}`
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
            <pre className="code-block local-file-code">
              <code>{state.preview.content ?? ""}</code>
            </pre>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
