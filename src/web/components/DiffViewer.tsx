import { useMemo } from "react";
import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import { prepareDiffView } from "@web/lib/diffViewData";
import { CopyableCodeBlock } from "./CopyableCodeBlock";

export function DiffViewer({
  fileName,
  unifiedDiff,
  changeType = "update",
}: {
  fileName: string;
  unifiedDiff: string;
  changeType?: string;
}) {
  const prepared = useMemo(
    () => prepareDiffView(fileName, unifiedDiff, changeType),
    [changeType, fileName, unifiedDiff],
  );

  return (
    <div className="diff-viewer">
      {prepared.note ? <div className="diff-viewer-note">{prepared.note}</div> : null}
      {prepared.diffFile ? (
        <DiffView
          diffFile={prepared.diffFile}
          diffViewMode={DiffModeEnum.Unified}
          diffViewWrap
          diffViewHighlight={false}
          diffViewFontSize={13}
          diffViewTheme="light"
        />
      ) : (
        <CopyableCodeBlock
          className="code-block"
          copyText={prepared.fallbackText}
        >
          {prepared.fallbackText}
        </CopyableCodeBlock>
      )}
    </div>
  );
}
