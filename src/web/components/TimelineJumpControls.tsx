import { ArrowDownToLine, ArrowUp } from "lucide-react";

export function TimelineJumpControls({
  showJumpTop,
  showJumpBottom,
  onJumpTop,
  onJumpBottom,
}: {
  showJumpTop: boolean;
  showJumpBottom: boolean;
  onJumpTop: () => void;
  onJumpBottom: () => void;
}) {
  if (!showJumpTop && !showJumpBottom) {
    return null;
  }

  return (
    <div className="timeline-jump-stack">
      {showJumpTop ? (
        <button
          className="timeline-jump-button"
          onClick={onJumpTop}
          title="Back to current turn top"
        >
          <ArrowUp size={15} />
        </button>
      ) : null}
      {showJumpBottom ? (
        <button
          className="timeline-jump-button"
          onClick={onJumpBottom}
          title="Follow latest"
        >
          <ArrowDownToLine size={15} />
        </button>
      ) : null}
    </div>
  );
}
