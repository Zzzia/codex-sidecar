import type { LocalFilePreview } from "@shared/types";

export interface LocalFileContext {
  threadId: string;
  cwd: string;
}

export type LocalFilePreviewState =
  | {
      status: "loading";
      href: string;
    }
  | {
      status: "ready";
      href: string;
      preview: LocalFilePreview;
    }
  | {
      status: "error";
      href: string;
      message: string;
    };

export function isLocalFileHref(href: string): boolean {
  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.startsWith("#")) {
    return false;
  }

  const schemeMatch = /^[a-z][a-z\d+.-]*:/i.exec(trimmedHref);
  if (!schemeMatch) {
    return true;
  }

  return schemeMatch[0].toLowerCase() === "file:";
}

export async function requestLocalFilePreview(
  context: LocalFileContext,
  href: string,
): Promise<LocalFilePreview> {
  const response = await fetch(
    `/api/threads/${encodeURIComponent(context.threadId)}/file?href=${encodeURIComponent(href)}`,
  );
  const payload = (await response.json()) as LocalFilePreview | { error?: string };
  if (!response.ok) {
    throw new Error("error" in payload && payload.error ? payload.error : "文件预览失败");
  }
  return payload as LocalFilePreview;
}
