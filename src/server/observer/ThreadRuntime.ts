import { createReadStream } from "node:fs";
import { access, constants } from "node:fs/promises";
import { EventEmitter } from "node:events";
import type {
  ThreadSnapshot,
  ThreadSummary,
  TimelineEvent,
} from "../../shared/types.js";
import {
  createThreadSummary,
  normalizeRecord,
  summarizeThreadText,
} from "./normalize.js";
import type { ThreadRow, ThreadRuntimeState } from "./types.js";

interface ThreadRuntimeEvents {
  timeline: [TimelineEvent, number];
}

export class ThreadRuntime {
  private readonly row: ThreadRow;
  private readonly summary: ThreadSummary;
  private readonly events: TimelineEvent[] = [];
  private readonly emitter = new EventEmitter();
  private readonly callNames = new Map<string, string>();
  private pollTimer: NodeJS.Timeout | null = null;
  private offset = 0;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private status: ThreadSummary["status"] = "idle";

  constructor(row: ThreadRow) {
    this.row = row;
    this.summary = createThreadSummary(row);
    this.summary.status = this.status;
  }

  updateRow(row: ThreadRow): void {
    this.summary.updatedAt = row.updated_at_ms;
    this.summary.title = summarizeThreadText(
      row.title || row.first_user_message || row.id,
    );
    this.summary.firstUserMessage = summarizeThreadText(
      row.first_user_message || "",
    );
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await this.refresh();
  }

  getSummary(): ThreadSummary {
    this.summary.status = this.status;
    this.summary.eventCount = this.events.length;
    return { ...this.summary };
  }

  getState(): ThreadRuntimeState {
    return {
      summary: this.getSummary(),
      events: [...this.events],
      status: this.status,
      offset: this.offset,
      loaded: this.loaded,
    };
  }

  async getSnapshot(): Promise<ThreadSnapshot> {
    await this.ensureLoaded();
    return {
      thread: this.getSummary(),
      events: [...this.events],
      nextCursor: this.events.length,
    };
  }

  async getEventsSince(cursor: number): Promise<TimelineEvent[]> {
    await this.refresh();
    return this.events.slice(Math.max(0, cursor));
  }

  subscribe(listener: (event: TimelineEvent, cursor: number) => void): () => void {
    this.emitter.on("timeline", listener);
    this.ensurePolling();

    return () => {
      this.emitter.off("timeline", listener);
      if (this.emitter.listenerCount("timeline") === 0) {
        this.stopPolling();
      }
    };
  }

  private emit(event: TimelineEvent): void {
    this.summary.eventCount = this.events.length;
    this.summary.status = this.status;
    this.emitter.emit("timeline", event, this.events.length);
  }

  private ensurePolling(): void {
    if (this.pollTimer) {
      return;
    }

    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, 1200);
  }

  private stopPolling(): void {
    if (!this.pollTimer) {
      return;
    }
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async refresh(): Promise<void> {
    if (this.loading) {
      return this.loading;
    }

    this.loading = this.readNewLines().finally(() => {
      this.loading = null;
    });

    return this.loading;
  }

  private async readNewLines(): Promise<void> {
    try {
      await access(this.row.rollout_path, constants.R_OK);
    } catch {
      return;
    }

    let nextOffset = this.offset;
    let lineNumber = this.events.length;
    let buffer = Buffer.alloc(0);

    const stream = createReadStream(this.row.rollout_path, {
      start: this.offset,
    });

    for await (const chunk of stream) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffer = Buffer.concat([buffer, data]);

      let newlineIndex = buffer.indexOf(0x0a);
      while (newlineIndex >= 0) {
        const lineBuffer = buffer.subarray(0, newlineIndex);
        buffer = buffer.subarray(newlineIndex + 1);
        nextOffset += lineBuffer.length + 1;
        const text = lineBuffer.toString("utf8").replace(/\r$/, "");
        if (text.trim()) {
          lineNumber += 1;
          this.consumeLine(text, lineNumber);
        }
        newlineIndex = buffer.indexOf(0x0a);
      }
    }

    if (buffer.length > 0) {
      const text = buffer.toString("utf8").replace(/\r$/, "");
      try {
        JSON.parse(text);
        nextOffset += buffer.length;
        lineNumber += 1;
        this.consumeLine(text, lineNumber);
      } catch {
        // Keep the offset pinned to the last full newline so a later read can
        // reassemble the partial JSON line safely.
      }
    }

    this.offset = nextOffset;
    this.loaded = true;
    this.summary.eventCount = this.events.length;
    this.summary.status = this.status;
  }

  private consumeLine(text: string, lineNumber: number): void {
    let raw: unknown;

    try {
      raw = JSON.parse(text);
    } catch {
      return;
    }

    const nextEvents = normalizeRecord(
      raw,
      {
        row: this.row,
        callNames: this.callNames,
        status: this.status,
      },
      lineNumber,
    );

    for (const event of nextEvents) {
      if (event.kind === "status") {
        this.status = event.status;
      }
      if (event.kind === "patch" && !event.success) {
        this.status = "error";
      }
      this.events.push(event);
      this.emit(event);
    }
  }
}
