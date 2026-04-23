import { stat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  LocalFilePreview,
  LocalFilePreviewKind,
} from "../shared/types.js";

const MAX_PREVIEW_BYTES = 1_000_000;

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

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
  ".svg",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
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

function hrefToPath(cwd: string, href: string): string {
  const trimmedHref = stripAnchorAndQuery(href.trim());
  if (!trimmedHref) {
    throw new LocalFilePreviewError("Missing file path", 400);
  }

  try {
    const parsedUrl = new URL(trimmedHref);
    if (parsedUrl.protocol !== "file:") {
      throw new LocalFilePreviewError("Only local file links can be previewed", 400);
    }
    return fileURLToPath(parsedUrl);
  } catch (error) {
    if (error instanceof LocalFilePreviewError) {
      throw error;
    }
  }

  return path.isAbsolute(trimmedHref)
    ? path.normalize(trimmedHref)
    : path.resolve(cwd, trimmedHref);
}

function stripLineSuffix(filePath: string): string {
  return filePath.replace(/:\d+(?::\d+)?$/, "");
}

function isPathInside(parent: string, target: string): boolean {
  const relativePath = path.relative(parent, target);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function previewKindForPath(filePath: string): LocalFilePreviewKind {
  const basename = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return "markdown";
  }
  if (CODE_EXTENSIONS.has(extension) || CODE_FILENAMES.has(basename)) {
    return "code";
  }
  return "unsupported";
}

export async function previewLocalFile(
  cwd: string,
  href: string,
): Promise<LocalFilePreview> {
  const normalizedCwd = path.resolve(cwd);
  const targetPath = stripLineSuffix(hrefToPath(normalizedCwd, href));

  if (!isPathInside(normalizedCwd, targetPath)) {
    throw new LocalFilePreviewError("File is outside the current workspace", 403);
  }

  const [realCwd, realTargetPath] = await Promise.all([
    realpath(normalizedCwd).catch(() => null),
    realpath(targetPath).catch(() => null),
  ]);
  if (!realCwd) {
    throw new LocalFilePreviewError("Workspace not found", 404);
  }
  if (!realTargetPath) {
    throw new LocalFilePreviewError("File not found", 404);
  }
  if (!isPathInside(realCwd, realTargetPath)) {
    throw new LocalFilePreviewError("File is outside the current workspace", 403);
  }

  const fileStat = await stat(realTargetPath);
  if (!fileStat.isFile()) {
    throw new LocalFilePreviewError("Only regular files can be previewed", 400);
  }
  if (fileStat.size > MAX_PREVIEW_BYTES) {
    throw new LocalFilePreviewError("File is too large to preview", 413);
  }

  const displayPath = path.relative(normalizedCwd, targetPath) || path.basename(targetPath);
  const kind = previewKindForPath(targetPath);
  if (kind === "unsupported") {
    return {
      path: targetPath,
      displayPath,
      kind,
      size: fileStat.size,
      reason: "This file type is not previewable",
    };
  }

  const content = await readFile(realTargetPath, "utf8");
  return {
    path: targetPath,
    displayPath,
    kind,
    size: fileStat.size,
    content,
  };
}
