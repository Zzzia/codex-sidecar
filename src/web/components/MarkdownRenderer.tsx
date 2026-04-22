import { useEffect, useId, useState } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
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

export function MarkdownRenderer({ text }: { text: string }) {
  return (
    <Markdown
      className="markdown-body"
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={[rehypeRaw, rehypeHighlight]}
      components={{
        code(props) {
          const { className, children, ...rest } = props;
          const value = String(children);
          const isBlock = value.includes("\n");
          const match = /language-([\w-]+)/.exec(className ?? "");
          const language = match?.[1];

          if (isBlock && language === "mermaid") {
            return <MermaidBlock chart={value.trim()} />;
          }

          if (isBlock) {
            return (
              <pre className="code-block">
                <code className={className} {...rest}>
                  {value.replace(/\n$/, "")}
                </code>
              </pre>
            );
          }

          return (
            <code className="inline-code" {...rest}>
              {children}
            </code>
          );
        },
        a(props) {
          return <a {...props} target="_blank" rel="noreferrer" />;
        },
      }}
    >
      {text}
    </Markdown>
  );
}
