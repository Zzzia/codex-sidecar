import { Archive, CheckCircle2, LoaderCircle } from "lucide-react";
import type { CompactionRunView } from "@web/lib/turns";
import { formatTimestamp } from "./timelineHelpers";

function compactionMeta(item: CompactionRunView): string {
  const time = formatTimestamp(item.completedAt ?? item.ts);
  const stateText = item.state === "completed" ? "Completed" : "Running";
  if (typeof item.replacementItemCount === "number") {
    return `${stateText} · ${item.replacementItemCount} history items · ${time}`;
  }
  return `${stateText} · ${time}`;
}

export function CompactionRunList({ items }: { items: CompactionRunView[] }) {
  return (
    <div className="turn-compaction-list" aria-label="Context compaction status">
      {items.map((item) => {
        const StatusIcon = item.state === "completed" ? CheckCircle2 : LoaderCircle;

        return (
          <div
            key={item.id}
            className={`compaction-row is-${item.state}`}
            title={item.detail}
          >
            <span className="compaction-icon" aria-hidden="true">
              <Archive size={15} />
            </span>
            <span className="compaction-main">
              <span className="compaction-title">{item.title}</span>
              <span className="compaction-detail">{item.detail}</span>
            </span>
            <span className="compaction-meta">
              <StatusIcon size={14} aria-hidden="true" />
              <span>{compactionMeta(item)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
