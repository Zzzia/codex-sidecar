import {
  memo,
  useCallback,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  codeChildFromPre,
  codeLanguageFromClassName,
  splitCodeLines,
  textFromReactNode,
} from "./MarkdownRenderer.helpers";
import { CopyableCodeBlock } from "./CopyableCodeBlock";
import { LocalFilePreviewModal } from "./LocalFilePreviewModal";
import {
  isLocalFileHref,
  localFileAnchorHref,
  requestLocalFilePreview,
  type LocalFileContext,
  type LocalFilePreviewState,
} from "./localFilePreview";
import { createCodePreviewMarkdown } from "./codePreviewMarkdown";
import { isLikelyMermaidChart, MermaidBlock } from "./MermaidBlock";

const rehypeHighlightPlugin: [
  typeof rehypeHighlight,
  { detect: boolean; plainText: string[] },
] = [
  rehypeHighlight,
  {
    detect: false,
    plainText: ["text", "txt", "plaintext", "plain"],
  },
];
const rehypePlugins = [rehypeRaw, rehypeHighlightPlugin];

/** Cap unwrap-plugin cache so long sessions do not retain every streamed text. */
const UNWRAP_PLUGIN_CACHE_LIMIT = 64;
const unwrapPluginCache = new Map<
  string,
  ReturnType<typeof createRemarkUnwrapSingleLineIndentedCode>
>();

export function extractPlanText(text: string): string | null {
  const match = text.match(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/);
  return match?.[1]?.trim() ?? null;
}

type MarkdownAstNode = {
  type?: string;
  value?: string;
  lang?: string | null;
  meta?: string | null;
  children?: MarkdownAstNode[];
  position?: {
    start?: {
      line?: number;
    };
  };
};

function visitMarkdownNode(
  node: MarkdownAstNode,
  visitor: (node: MarkdownAstNode) => void,
) {
  visitor(node);

  for (const child of node.children ?? []) {
    visitMarkdownNode(child, visitor);
  }
}

function createRemarkUnwrapSingleLineIndentedCode(source: string) {
  const lines = source.split(/\r?\n/);

  return function remarkUnwrapSingleLineIndentedCode() {
    return function transformer(tree: MarkdownAstNode) {
      visitMarkdownNode(tree, (node) => {
        if (node.type !== "code" || node.lang || node.meta) {
          return;
        }

        const originalLine = lines[(node.position?.start?.line ?? 1) - 1] ?? "";
        const isIndentedCode = /^(?: {4}|\t)/.test(originalLine);
        const isSingleLine = !node.value?.includes("\n");

        if (!isIndentedCode || !isSingleLine) {
          return;
        }

        node.type = "paragraph";
        node.children = [{ type: "text", value: node.value ?? "" }];
        delete node.value;
      });
    };
  };
}

function getRemarkUnwrapPlugin(source: string) {
  const cached = unwrapPluginCache.get(source);
  if (cached) {
    // Refresh LRU order.
    unwrapPluginCache.delete(source);
    unwrapPluginCache.set(source, cached);
    return cached;
  }

  const plugin = createRemarkUnwrapSingleLineIndentedCode(source);
  unwrapPluginCache.set(source, plugin);

  if (unwrapPluginCache.size > UNWRAP_PLUGIN_CACHE_LIMIT) {
    const oldest = unwrapPluginCache.keys().next().value;
    if (oldest !== undefined) {
      unwrapPluginCache.delete(oldest);
    }
  }

  return plugin;
}

function joinClassNames(...names: Array<string | null | undefined | false>): string {
  return names.filter(Boolean).join(" ");
}

function isBlockCodeClassName(className?: string): boolean {
  return /(?:^|\s)(?:hljs|language-|lang-)/.test(className ?? "");
}

function createMarkdownComponents(options: {
  codeBlockLineNumbers: boolean;
  openLocalFilePreview: ((href: string) => void) | null;
}): Components {
  const { codeBlockLineNumbers, openLocalFilePreview } = options;

  return {
    pre(props) {
      const { children, node, className, ...rest } = props;
      const codeChild = codeChildFromPre(children);
      const language = codeLanguageFromClassName(codeChild?.props.className);
      const codeText = textFromReactNode(codeChild?.props.children ?? children);
      const preClassName = joinClassNames(
        "code-block",
        className,
        codeBlockLineNumbers && "code-block-with-lines",
      );

      if (language === "mermaid" && isLikelyMermaidChart(codeText)) {
        return <MermaidBlock chart={codeText.trim()} />;
      }

      if (codeBlockLineNumbers && codeChild) {
        return (
          <CopyableCodeBlock
            className={preClassName}
            copyText={codeText}
            {...rest}
          >
            <code className={codeChild.props.className}>
              {splitCodeLines(codeChild.props.children).map((line, index) => (
                <span className="code-line" data-line={index + 1} key={index}>
                  <span className="code-line-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="code-line-content">
                    {line.length > 0 ? line : "\u00a0"}
                  </span>
                </span>
              ))}
            </code>
          </CopyableCodeBlock>
        );
      }

      return (
        <CopyableCodeBlock className={preClassName} copyText={codeText} {...rest}>
          {children}
        </CopyableCodeBlock>
      );
    },
    code(props) {
      const { className, children, node, ...rest } = props;
      const value = textFromReactNode(children);
      const blockLikeCode = isBlockCodeClassName(className) || value.includes("\n");

      if (blockLikeCode) {
        return (
          <code className={joinClassNames("code-content", className)} {...rest}>
            {children}
          </code>
        );
      }

      return (
        <code
          className={className ? `inline-code ${className}` : "inline-code"}
          {...rest}
        >
          {value.replace(/\n$/, "")}
        </code>
      );
    },
    a(props) {
      const { href, node, onClick, ...rest } = props;
      const hrefText = typeof href === "string" ? href : "";
      const localFileLink = isLocalFileHref(hrefText);
      const canPreviewLocalFile = localFileLink && openLocalFilePreview != null;
      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || !canPreviewLocalFile) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openLocalFilePreview(hrefText);
      };

      return (
        <a
          {...rest}
          href={canPreviewLocalFile ? localFileAnchorHref(hrefText) : href}
          data-local-file-href={canPreviewLocalFile ? hrefText : undefined}
          onClick={handleClick}
          target={canPreviewLocalFile ? undefined : localFileLink ? undefined : "_blank"}
          rel={canPreviewLocalFile ? undefined : localFileLink ? undefined : "noreferrer"}
          title={canPreviewLocalFile ? "Preview local file" : rest.title}
        />
      );
    },
    table(props) {
      const { children, node, ...rest } = props;
      return (
        <div className="markdown-table-scroll">
          <table {...rest}>{children}</table>
        </div>
      );
    },
  };
}

function MarkdownRendererImpl({
  text,
  localFileContext,
  codeBlockLineNumbers = false,
  onOpenLocalFile,
}: {
  text: string;
  localFileContext?: LocalFileContext | null;
  codeBlockLineNumbers?: boolean;
  /**
   * When provided, local file clicks are delegated to the parent (Timeline).
   * Owned preview state inside this component is only used as a fallback for
   * non-virtualized surfaces (modals, inspectors).
   */
  onOpenLocalFile?: (href: string) => void;
}) {
  const [filePreviewState, setFilePreviewState] =
    useState<LocalFilePreviewState | null>(null);

  const openLocalFilePreview = useCallback(
    (href: string) => {
      if (onOpenLocalFile) {
        onOpenLocalFile(href);
        return;
      }

      if (!localFileContext) {
        setFilePreviewState({
          status: "error",
          href,
          message:
            "This session has no available working directory for local file previews.",
        });
        return;
      }

      setFilePreviewState({ status: "loading", href });
      requestLocalFilePreview(localFileContext, href)
        .then((preview) => {
          setFilePreviewState({ status: "ready", href, preview });
        })
        .catch((error: unknown) => {
          setFilePreviewState({
            status: "error",
            href,
            message:
              error instanceof Error ? error.message : "File preview failed",
          });
        });
    },
    [localFileContext, onOpenLocalFile],
  );

  const canOpenLocalFile =
    Boolean(onOpenLocalFile) || Boolean(localFileContext);

  const remarkPlugins = useMemo(
    () => [remarkGfm, getRemarkUnwrapPlugin(text), remarkBreaks],
    [text],
  );

  const components = useMemo(
    () =>
      createMarkdownComponents({
        codeBlockLineNumbers,
        openLocalFilePreview: canOpenLocalFile ? openLocalFilePreview : null,
      }),
    [canOpenLocalFile, codeBlockLineNumbers, openLocalFilePreview],
  );

  return (
    <>
      <Markdown
        className="markdown-body"
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {text}
      </Markdown>

      {filePreviewState && localFileContext && !onOpenLocalFile ? (
        <LocalFilePreviewModal
          context={localFileContext}
          state={filePreviewState}
          renderMarkdown={(markdownText, context) => (
            <MarkdownRenderer text={markdownText} localFileContext={context} />
          )}
          renderCode={(codeText, displayPath, context) => (
            <MarkdownRenderer
              text={createCodePreviewMarkdown(codeText, displayPath)}
              localFileContext={context}
              codeBlockLineNumbers
            />
          )}
          onClose={() => setFilePreviewState(null)}
        />
      ) : null}
    </>
  );
}

function sameLocalFileContext(
  left: LocalFileContext | null | undefined,
  right: LocalFileContext | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return !left && !right;
  }
  return left.threadId === right.threadId && left.cwd === right.cwd;
}

export const MarkdownRenderer = memo(MarkdownRendererImpl, (prev, next) => {
  return (
    prev.text === next.text &&
    prev.codeBlockLineNumbers === next.codeBlockLineNumbers &&
    prev.onOpenLocalFile === next.onOpenLocalFile &&
    sameLocalFileContext(prev.localFileContext, next.localFileContext)
  );
});
