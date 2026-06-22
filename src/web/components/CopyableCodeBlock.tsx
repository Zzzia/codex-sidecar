import {
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { Check, Copy } from "lucide-react";
import { textFromReactNode } from "./MarkdownRenderer.helpers";

type CopyStatus = "idle" | "copied" | "failed";

async function writeClipboardText(value: string): Promise<void> {
  let clipboardError: unknown = null;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (error: unknown) {
      clipboardError = error;
    }
  }

  if (typeof document !== "undefined" && document.body) {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.inset = "0 auto auto 0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, value.length);

    try {
      if (document.execCommand("copy")) {
        return;
      }
      throw new Error("document.execCommand(\"copy\") returned false");
    } finally {
      textarea.remove();
    }
  }

  if (clipboardError instanceof Error) {
    throw clipboardError;
  }
  throw new Error("No clipboard API is available");
}

export function CopyableCodeBlock({
  children,
  className,
  copyText,
  ...preProps
}: ComponentPropsWithoutRef<"pre"> & { copyText?: string }) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const textToCopy = useMemo(
    () => copyText ?? textFromReactNode(children),
    [children, copyText],
  );
  const title =
    copyStatus === "copied"
      ? "Copied"
      : copyStatus === "failed"
        ? "Copy failed"
        : "Copy code block";

  useEffect(() => {
    if (copyStatus === "idle") {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopyStatus("idle");
    }, 1400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copyStatus]);

  const handleCopy = async () => {
    try {
      await writeClipboardText(textToCopy);
      setCopyStatus("copied");
    } catch (error: unknown) {
      console.warn("Failed to copy code block", error);
      setCopyStatus("failed");
    }
  };

  return (
    <div className="copyable-code-block">
      <pre className={className} {...preProps}>
        {children}
      </pre>
      <button
        type="button"
        className={`copy-code-button is-${copyStatus}`}
        title={title}
        aria-label={title}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void handleCopy();
        }}
      >
        {copyStatus === "copied" ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
