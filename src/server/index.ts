import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TimelineEvent } from "../shared/types.js";
import {
  LocalFilePreviewError,
  previewLocalFile,
} from "./localFilePreview.js";
import { CodexObserver } from "./observer/CodexObserver.js";
import { badRequest, json, notFound, serverError, writeSseEvent } from "./utils/http.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const webDir = path.join(rootDir, "dist");
const dbPath = path.join(process.env.HOME ?? "", ".codex", "state_5.sqlite");
const observer = new CodexObserver(dbPath);
const port = Number(process.env.PORT ?? 4315);

function getStaticContentType(filePath: string): string {
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".webp")) return "image/webp";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "text/plain; charset=utf-8";
}

function readThreadId(urlPath: string): string | null {
  const match = urlPath.match(/^\/api\/threads\/([^/]+)\/(snapshot|events|stream|file)$/);
  return match?.[1] ?? null;
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    notFound(response);
    return;
  }

  const url = new URL(request.url, "http://127.0.0.1");

  try {
    if (request.method === "GET" && url.pathname === "/api/projects") {
      const projects = await observer.listProjects();
      json(response, 200, { items: projects });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/threads") {
      const cwd = url.searchParams.get("cwd");
      if (!cwd) {
        badRequest(response, "Missing cwd");
        return;
      }

      const page = await observer.listThreadsByProject(
        cwd,
        url.searchParams.get("cursor") ?? undefined,
      );
      json(response, 200, page);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/thread-summaries") {
      const ids = url.searchParams
        .getAll("id")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 100);
      if (ids.length === 0) {
        badRequest(response, "Missing thread ids");
        return;
      }

      const summaries = await observer.getThreadSummaries(ids);
      json(response, 200, { items: summaries });
      return;
    }

    if (request.method === "GET" && url.pathname.endsWith("/snapshot")) {
      const threadId = readThreadId(url.pathname);
      if (!threadId) {
        badRequest(response, "Invalid thread id");
        return;
      }

      const snapshot = await observer.getThreadSnapshot(threadId);
      json(response, 200, snapshot);
      return;
    }

    if (request.method === "GET" && url.pathname.endsWith("/file")) {
      const threadId = readThreadId(url.pathname);
      const href = url.searchParams.get("href");
      if (!threadId || !href) {
        badRequest(response, "Invalid file preview request");
        return;
      }

      const snapshot = await observer.getThreadSnapshot(threadId);
      try {
        const preview = await previewLocalFile(snapshot.thread.cwd, href);
        json(response, 200, preview);
      } catch (error) {
        if (error instanceof LocalFilePreviewError) {
          json(response, error.statusCode, { error: error.message });
          return;
        }
        throw error;
      }
      return;
    }

    if (request.method === "GET" && url.pathname.endsWith("/events")) {
      const threadId = readThreadId(url.pathname);
      if (!threadId) {
        badRequest(response, "Invalid thread id");
        return;
      }

      const rawAfter = Number(url.searchParams.get("after") ?? "0");
      const after = Number.isFinite(rawAfter) && rawAfter >= 0 ? rawAfter : 0;
      const delta = await observer.getThreadDelta(threadId, after);
      json(response, 200, delta);
      return;
    }

    if (request.method === "GET" && url.pathname.endsWith("/stream")) {
      const threadId = readThreadId(url.pathname);
      if (!threadId) {
        badRequest(response, "Invalid thread id");
        return;
      }

      const rawAfter = Number(url.searchParams.get("after") ?? "0");
      const after = Number.isFinite(rawAfter) && rawAfter >= 0 ? rawAfter : 0;

      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });

      response.write(": connected\n\n");
      const backlog = await observer.getEventsSince(threadId, after);
      let cursor = after;
      for (const event of backlog) {
        cursor += 1;
        writeSseEvent(response, "timeline", { type: "timeline", cursor, event });
      }
      writeSseEvent(response, "ready", { type: "ready", cursor });

      const unsubscribe = await observer.subscribe(
        threadId,
        (event: TimelineEvent, nextCursor: number) => {
          writeSseEvent(response, "timeline", {
            type: "timeline",
            cursor: nextCursor,
            event,
          });
        },
      );

      const heartbeat = setInterval(() => {
        response.write(": keepalive\n\n");
      }, 15000);

      request.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        response.end();
      });
      return;
    }

    if (process.env.NODE_ENV === "production") {
      const requestedPath =
        url.pathname === "/"
          ? path.join(webDir, "index.html")
          : path.join(webDir, url.pathname.replace(/^\/+/, ""));
      const targetPath = path.normalize(requestedPath);
      if (!targetPath.startsWith(webDir)) {
        notFound(response);
        return;
      }

      try {
        const fileContent = await readFile(targetPath);
        response.writeHead(200, {
          "Content-Type": getStaticContentType(targetPath),
        });
        response.end(fileContent);
      } catch {
        const fallback = await readFile(path.join(webDir, "index.html"));
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(fallback);
      }
      return;
    }

    notFound(response);
  } catch (error) {
    serverError(response, error);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Codex observer listening on http://127.0.0.1:${port}`);
});
