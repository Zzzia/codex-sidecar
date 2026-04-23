import {
  type ReactElement,
  isValidElement,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import "./MarkdownRenderer.css";

function MermaidBlock({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const id = useId().replace(/:/g, "-");

  useEffect(() => {
    let active = true;

    import("mermaid")
      .then((module) => {
        const mermaid = module.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "strict",
        });
        return mermaid.render(`mermaid-${id}`, chart);
      })
      .then((result) => {
        if (active) {
          setSvg(result.svg);
          setError(null);
        }
      })
      .catch((renderError: unknown) => {
        if (active) {
          setSvg("");
          setError(
            renderError instanceof Error ? renderError.message : "Mermaid 渲染失败",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [chart, id]);

  if (error) {
    return <pre className="code-block">{chart}</pre>;
  }

  if (!svg) {
    return <div className="mermaid-loading">Mermaid 渲染中…</div>;
  }

  return (
    <div
      className="mermaid-block"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function extractPlanText(text: string): string | null {
  const match = text.match(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/);
  return match?.[1]?.trim() ?? null;
}

function textFromReactNode(node: ReactNode): string {
  if (node == null || typeof node === "boolean") {
    return "";
  }

  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(textFromReactNode).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textFromReactNode(node.props.children);
  }

  return "";
}

function codeChildFromPre(
  children: ReactNode,
): ReactElement<{ className?: string; children?: ReactNode }> | null {
  const child = Array.isArray(children)
    ? children.find((item) => item != null && item !== "\n")
    : children;

  if (
    isValidElement<{ className?: string; children?: ReactNode }>(child) &&
    child.type === "code"
  ) {
    return child;
  }

  return null;
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

export function MarkdownRenderer({ text }: { text: string }) {
  return (
    <Markdown
      className="markdown-body"
      remarkPlugins={[
        remarkGfm,
        createRemarkUnwrapSingleLineIndentedCode(text),
        remarkBreaks,
      ]}
      rehypePlugins={[rehypeRaw]}
      components={{
        pre(props) {
          const { children, node, className, ...rest } = props;
          const codeChild = codeChildFromPre(children);
          const codeClassName = codeChild?.props.className ?? "";
          const match = /(?:^|\s)language-([\w-]+)/.exec(codeClassName);
          const language = match?.[1];

          if (language === "mermaid") {
            return (
              <MermaidBlock
                chart={textFromReactNode(codeChild?.props.children).trim()}
              />
            );
          }

          return (
            <pre
              className={className ? `code-block ${className}` : "code-block"}
              {...rest}
            >
              {children}
            </pre>
          );
        },
        code(props) {
          const { className, children, node, ...rest } = props;
          const value = textFromReactNode(children);

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
          const { node, ...rest } = props;
          return <a {...rest} target="_blank" rel="noreferrer" />;
        },
        table(props) {
          const { children, node, ...rest } = props;
          return (
            <div className="markdown-table-scroll">
              <table {...rest}>{children}</table>
            </div>
          );
        },
      }}
    >
      {text}
    </Markdown>
  );
}
