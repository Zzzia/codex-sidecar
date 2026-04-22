import type { ServerResponse } from "node:http";

export function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

export function notFound(response: ServerResponse): void {
  json(response, 404, { error: "Not Found" });
}

export function badRequest(response: ServerResponse, message: string): void {
  json(response, 400, { error: message });
}

export function serverError(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  json(response, 500, { error: message });
}

export function writeSseEvent(
  response: ServerResponse,
  event: string,
  payload: unknown,
): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}
