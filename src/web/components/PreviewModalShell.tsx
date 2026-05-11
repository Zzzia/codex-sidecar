import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import clsx from "clsx";

interface PreviewModalShellProps {
  ariaLabel: string;
  eyebrow: string;
  title: ReactNode;
  titleText?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  bodyClassName?: string;
  modalClassName?: string;
  children: ReactNode;
  onClose: () => void;
}

export function PreviewModalShell({
  ariaLabel,
  eyebrow,
  title,
  titleText,
  meta,
  actions,
  bodyClassName,
  modalClassName,
  children,
  onClose,
}: PreviewModalShellProps) {
  return createPortal(
    <div className="preview-modal-backdrop" onClick={onClose}>
      <section
        className={clsx("preview-modal", modalClassName)}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="preview-modal-header">
          <div className="preview-modal-title-wrap">
            <div className="preview-modal-eyebrow">{eyebrow}</div>
            <div className="preview-modal-title-row" title={titleText}>
              {title}
            </div>
            {meta ? <div className="preview-modal-meta">{meta}</div> : null}
          </div>
          <div className="preview-modal-actions">
            {actions}
            <button
              type="button"
              className="icon-button"
              title="关闭预览"
              aria-label="关闭预览"
              onClick={onClose}
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <div className={clsx("preview-modal-body", bodyClassName)}>{children}</div>
      </section>
    </div>,
    document.body,
  );
}
