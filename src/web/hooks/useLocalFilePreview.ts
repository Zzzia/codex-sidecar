import { useCallback, useState } from "react";
import {
  requestLocalFilePreview,
  type LocalFileContext,
  type LocalFilePreviewState,
} from "@web/components/localFilePreview";

export function useLocalFilePreview(localFileContext: LocalFileContext | null) {
  const [filePreviewState, setFilePreviewState] =
    useState<LocalFilePreviewState | null>(null);

  const clearFilePreview = useCallback(() => {
    setFilePreviewState(null);
  }, []);

  const openLocalFile = useCallback(
    (href: string) => {
      if (!localFileContext) {
        setFilePreviewState({
          status: "error",
          href,
          message:
            "This session has no available working directory for local file previews.",
        });
        return;
      }

      setFilePreviewState({ status: "loading", href });
      requestLocalFilePreview(localFileContext, href)
        .then((preview) => {
          setFilePreviewState({ status: "ready", href, preview });
        })
        .catch((error: unknown) => {
          setFilePreviewState({
            status: "error",
            href,
            message:
              error instanceof Error ? error.message : "File preview failed",
          });
        });
    },
    [localFileContext],
  );

  return {
    filePreviewState,
    openLocalFile,
    clearFilePreview,
  };
}
