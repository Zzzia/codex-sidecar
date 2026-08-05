import { stat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  LocalFilePreview,
  LocalFilePreviewKind,
} from "../shared/types.js";

const MAX_TEXT_PREVIEW_BYTES = 1_000_000;
const MAX_EMBED_PREVIEW_BYTES = 8_000_000;

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

/** Plain-text files that often store Markdown reports (e.g. workflow outputs). */
const TEXT_EXTENSIONS = new Set([".txt", ".log"]);

const IMAGE_MIME_TYPES = new Map<string, string>([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

const CODE_EXTENSIONS = new Set([
  ".bash",
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".env",
  ".fish",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".log",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const CODE_FILENAMES = new Set([
  ".dockerignore",
  ".env",
  ".gitignore",
  "AGENTS.md",
  "Dockerfile",
  "Makefile",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export class LocalFilePreviewError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "LocalFilePreviewError";
  }
}

function stripAnchorAndQuery(rawHref: string): string {
  const hashIndex = rawHref.indexOf("#");
  const withoutAnchor = hashIndex >= 0 ? rawHref.slice(0, hashIndex) : rawHref;
  const queryIndex = withoutAnchor.indexOf("?");
  return queryIndex >= 0 ? withoutAnchor.slice(0, queryIndex) : withoutAnchor;
}

function hrefCandidateToPath(cwd: string, href: string): string {
  try {
    const parsedUrl = new URL(href);
    if (parsedUrl.protocol !== "file:") {
      throw new LocalFilePreviewError("Only local file links can be previewed", 400);
    }
    return fileURLToPath(parsedUrl);
  } catch (error) {
    if (error instanceof LocalFilePreviewError) {
      throw error;
    }
  }

  return path.isAbsolute(href) ? path.normalize(href) : path.resolve(cwd, href);
}

function decodePercentEncodedHref(href: string): string | null {
  if (!/%[0-9a-f]{2}/i.test(href)) {
    return null;
  }

  try {
    const decodedHref = decodeURIComponent(href);
    return decodedHref === href ? null : decodedHref;
  } catch {
    return null;
  }
}

function hasNonFileScheme(href: string): boolean {
  const schemeMatch = /^[a-z][a-z\d+.-]*:/i.exec(href);
  return Boolean(schemeMatch && schemeMatch[0].toLowerCase() !== "file:");
}

function hrefToPathCandidates(cwd: string, href: string): string[] {
  const trimmedHref = stripAnchorAndQuery(href.trim());
  if (!trimmedHref) {
    throw new LocalFilePreviewError("Missing file path", 400);
  }

  const candidates = [hrefCandidateToPath(cwd, trimmedHref)];
  const decodedHref = decodePercentEncodedHref(trimmedHref);
  if (decodedHref && !hasNonFileScheme(decodedHref)) {
    candidates.push(hrefCandidateToPath(cwd, decodedHref));
  }

  return Array.from(new Set(candidates));
}

function mimeTypeForPath(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  if (IMAGE_MIME_TYPES.has(extension)) {
    return IMAGE_MIME_TYPES.get(extension) ?? null;
  }
  if (extension === ".pdf") {
    return "application/pdf";
  }
  return null;
}

function stripLineSuffix(filePath: string): string {
  return filePath.replace(/:\d+(?::\d+)?$/, "");
}

function previewKindForPath(filePath: string): LocalFilePreviewKind {
  const basename = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return "markdown";
  }
  if (IMAGE_MIME_TYPES.has(extension)) {
    return "image";
  }
  if (extension === ".pdf") {
    return "pdf";
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    // Content sniff decides markdown vs plain code after read.
    return "code";
  }
  if (CODE_EXTENSIONS.has(extension) || CODE_FILENAMES.has(basename)) {
    return "code";
  }
  return "unsupported";
}

/**
 * Prefer Markdown rendering when a .txt/.log report contains common MD structure.
 * Avoid treating arbitrary plain logs as Markdown.
 */
export function looksLikeMarkdownText(content: string): boolean {
  const sample = content.slice(0, 12_000);
  if (/^#{1,6}\s+\S/m.test(sample)) {
    return true;
  }
  if (/^\s*[-*+]\s+\S/m.test(sample) && /\[.+\]\(.+\)/.test(sample)) {
    return true;
  }
  if (/^\s*\|.+\|\s*$/m.test(sample) && /^\s*\|?\s*:?-{3,}/m.test(sample)) {
    return true;
  }
  if (/```[\w-]*\n[\s\S]*?```/.test(sample)) {
    return true;
  }
  return false;
}

function maxBytesForKind(kind: LocalFilePreviewKind): number {
  return kind === "image" || kind === "pdf"
    ? MAX_EMBED_PREVIEW_BYTES
    : MAX_TEXT_PREVIEW_BYTES;
}

function displayPathForPreview(cwd: string, targetPath: string): string {
  const relativePath = path.relative(cwd, targetPath);
  if (
    relativePath &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  ) {
    return relativePath;
  }
  return targetPath;
}

export async function previewLocalFile(
  cwd: string,
  href: string,
): Promise<LocalFilePreview> {
  const normalizedCwd = path.resolve(cwd);
  let targetPath: string | null = null;
  let realTargetPath: string | null = null;

  for (const candidatePath of hrefToPathCandidates(normalizedCwd, href)) {
    const pathWithoutLineSuffix = stripLineSuffix(candidatePath);
    const realCandidatePath = await realpath(pathWithoutLineSuffix).catch(() => null);
    if (realCandidatePath) {
      targetPath = pathWithoutLineSuffix;
      realTargetPath = realCandidatePath;
      break;
    }
  }

  if (!realTargetPath) {
    throw new LocalFilePreviewError("File not found", 404);
  }
  if (!targetPath) {
    throw new LocalFilePreviewError("Missing file path", 400);
  }

  const fileStat = await stat(realTargetPath);
  if (!fileStat.isFile()) {
    throw new LocalFilePreviewError("Only regular files can be previewed", 400);
  }
  const displayPath = displayPathForPreview(normalizedCwd, targetPath);
  const kind = previewKindForPath(targetPath);
  if (kind === "unsupported") {
    return {
      path: targetPath,
      displayPath,
      kind,
      size: fileStat.size,
      reason: "This file type is not supported for preview",
    };
  }
  if (fileStat.size > maxBytesForKind(kind)) {
    throw new LocalFilePreviewError("File is too large to preview", 413);
  }

  if (kind === "image" || kind === "pdf") {
    const mimeType = mimeTypeForPath(targetPath);
    if (!mimeType) {
      throw new LocalFilePreviewError("File type is not previewable", 400);
    }
    const fileBuffer = await readFile(realTargetPath);
    return {
      path: targetPath,
      displayPath,
      kind,
      size: fileStat.size,
      mimeType,
      dataUrl: `data:${mimeType};base64,${fileBuffer.toString("base64")}`,
    };
  }

  const content = await readFile(realTargetPath, "utf8");
  const extension = path.extname(targetPath).toLowerCase();
  const resolvedKind =
    kind === "code" &&
    TEXT_EXTENSIONS.has(extension) &&
    looksLikeMarkdownText(content)
      ? "markdown"
      : kind;

  return {
    path: targetPath,
    displayPath,
    kind: resolvedKind,
    size: fileStat.size,
    content,
  };
}
