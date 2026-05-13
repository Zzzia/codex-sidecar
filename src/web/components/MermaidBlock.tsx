import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { CopyableCodeBlock } from "./CopyableCodeBlock";

const mermaidSvgCache = new Map<string, string>();
const mermaidRenderCache = new Map<string, Promise<string>>();
const MERMAID_CACHE_LIMIT = 80;
const FLOWCHART_NODE_LABEL_PATTERN =
  /(^|[^A-Za-z0-9_])([A-Za-z][A-Za-z0-9_-]*)\[([^\]\n]*)\]/g;
const UNSAFE_UNQUOTED_LABEL_PATTERN = /[{}]/;
const MERMAID_DIAGRAM_START_PATTERN =
  /^(?:architecture-beta|block-beta|block|C4Component|C4Container|C4Context|C4Deployment|C4Dynamic|classDiagram(?:-v2)?|erDiagram|flowchart|gantt|gitGraph|graph|journey|kanban|mindmap|packet-beta|pie|quadrantChart|radar-beta|requirementDiagram|sankey-beta|sequenceDiagram|stateDiagram(?:-v2)?|timeline|treemap-beta|xychart-beta)\b/;
let mermaidInitialized = false;

function rememberMermaidSvg(chart: string, svg: string): void {
  if (!mermaidSvgCache.has(chart) && mermaidSvgCache.size >= MERMAID_CACHE_LIMIT) {
    const oldestKey = mermaidSvgCache.keys().next().value;
    if (oldestKey) {
      mermaidSvgCache.delete(oldestKey);
    }
  }
  mermaidSvgCache.set(chart, svg);
}

function isAlreadyQuotedLabel(label: string): boolean {
  const firstChar = label.trimStart()[0];
  return firstChar === "\"" || firstChar === "'" || firstChar === "`";
}

function isSpecialShapeLabel(label: string): boolean {
  const firstChar = label.trimStart()[0];
  return firstChar === "(" || firstChar === "[" || firstChar === "/" || firstChar === "\\";
}

function escapeMermaidQuotedLabel(label: string): string {
  return label.replace(/"/g, "#quot;");
}

function firstRenderableMermaidLine(chart: string): string {
  for (const line of chart.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("%%")) {
      continue;
    }
    return trimmedLine;
  }

  return "";
}

export function isLikelyMermaidChart(chart: string): boolean {
  return MERMAID_DIAGRAM_START_PATTERN.test(firstRenderableMermaidLine(chart));
}

export function prepareMermaidChartForRender(chart: string): string {
  return chart.replace(
    FLOWCHART_NODE_LABEL_PATTERN,
    (match, prefix: string, nodeId: string, label: string) => {
      if (
        !UNSAFE_UNQUOTED_LABEL_PATTERN.test(label) ||
        isAlreadyQuotedLabel(label) ||
        isSpecialShapeLabel(label)
      ) {
        return match;
      }

      return `${prefix}${nodeId}["${escapeMermaidQuotedLabel(label)}"]`;
    },
  );
}

async function renderWithMermaid(chart: string, id: string): Promise<string> {
  const module = await import("mermaid");
  const mermaid = module.default;
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "neutral",
      securityLevel: "strict",
      suppressErrorRendering: true,
    });
    mermaidInitialized = true;
  }

  const result = await mermaid.render(
    `mermaid-${id}`,
    prepareMermaidChartForRender(chart),
  );
  return result.svg;
}

function renderMermaidChart(chart: string, id: string): Promise<string> {
  const cachedSvg = mermaidSvgCache.get(chart);
  if (cachedSvg) {
    return Promise.resolve(cachedSvg);
  }

  const cachedRender = mermaidRenderCache.get(chart);
  if (cachedRender) {
    return cachedRender;
  }

  const renderPromise = renderWithMermaid(chart, id)
    .then((svg) => {
      rememberMermaidSvg(chart, svg);
      mermaidRenderCache.delete(chart);
      return svg;
    })
    .catch((renderError: unknown) => {
      mermaidRenderCache.delete(chart);
      throw renderError;
    });

  mermaidRenderCache.set(chart, renderPromise);
  return renderPromise;
}

export function MermaidBlock({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string>(() => mermaidSvgCache.get(chart) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const id = useId().replace(/:/g, "-");

  useEffect(() => {
    let active = true;
    const cachedSvg = mermaidSvgCache.get(chart);
    if (cachedSvg) {
      setSvg(cachedSvg);
      setError(null);
      return () => {
        active = false;
      };
    }

    setSvg("");
    setError(null);

    renderMermaidChart(chart, id)
      .then((nextSvg) => {
        if (active) {
          setSvg(nextSvg);
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
    return (
      <CopyableCodeBlock className="code-block" copyText={chart}>
        {chart}
      </CopyableCodeBlock>
    );
  }

  if (!svg) {
    return (
      <div className="mermaid-block is-loading" aria-busy="true">
        Mermaid 渲染中…
      </div>
    );
  }

  return (
    <>
      <div className="mermaid-block">
        <button
          type="button"
          className="mermaid-fullscreen-button"
          title="全屏预览 Mermaid"
          aria-label="全屏预览 Mermaid"
          onClick={() => setPreviewOpen(true)}
        >
          <Maximize2 size={14} />
        </button>
        <div
          className="mermaid-svg-wrap"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {previewOpen ? (
        <MermaidPreviewModal svg={svg} onClose={() => setPreviewOpen(false)} />
      ) : null}
    </>
  );
}

function MermaidPreviewModal({
  svg,
  onClose,
}: {
  svg: string;
  onClose: () => void;
}) {
  const content = (
    <div className="mermaid-preview-backdrop" onClick={onClose}>
      <div
        className="mermaid-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Mermaid 全屏预览"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="mermaid-preview-close"
          title="关闭"
          aria-label="关闭 Mermaid 预览"
          onClick={onClose}
        >
          <X size={16} />
        </button>
        <div
          className="mermaid-preview-canvas"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return content;
  }

  return createPortal(content, document.body);
}
