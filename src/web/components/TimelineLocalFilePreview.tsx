import { createCodePreviewMarkdown } from "./codePreviewMarkdown";
import { LocalFilePreviewModal } from "./LocalFilePreviewModal";
import { MarkdownRenderer } from "./MarkdownRenderer";
import type {
  LocalFileContext,
  LocalFilePreviewState,
} from "./localFilePreview";

export function TimelineLocalFilePreview({
  context,
  state,
  onClose,
}: {
  context: LocalFileContext;
  state: LocalFilePreviewState;
  onClose: () => void;
}) {
  return (
    <LocalFilePreviewModal
      context={context}
      state={state}
      renderMarkdown={(markdownText, nextContext) => (
        <MarkdownRenderer text={markdownText} localFileContext={nextContext} />
      )}
      renderCode={(codeText, displayPath, nextContext) => (
        <MarkdownRenderer
          text={createCodePreviewMarkdown(codeText, displayPath)}
          localFileContext={nextContext}
          codeBlockLineNumbers
        />
      )}
      onClose={onClose}
    />
  );
}
