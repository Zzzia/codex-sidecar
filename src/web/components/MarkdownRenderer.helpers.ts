import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

export type CodeElementProps = {
  className?: string;
  children?: ReactNode;
};

export function textFromReactNode(node: ReactNode): string {
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

export function codeChildFromPre(
  children: ReactNode,
): ReactElement<CodeElementProps> | null {
  const child = Array.isArray(children)
    ? children.find((item) => item != null && item !== "\n")
    : children;

  if (!isValidElement<CodeElementProps>(child)) {
    return null;
  }

  return child;
}

export function codeLanguageFromClassName(className?: string): string | null {
  const match = /(?:^|\s)language-([\w-]+)/.exec(className ?? "");
  return match?.[1]?.toLowerCase() ?? null;
}

function appendNodeLines(
  node: ReactNode,
  lines: ReactNode[][],
  keyPrefix: string,
) {
  if (node == null || typeof node === "boolean") {
    return;
  }

  if (typeof node === "string" || typeof node === "number") {
    const parts = String(node).split("\n");
    parts.forEach((part, index) => {
      if (index > 0) {
        lines.push([]);
      }
      if (part) {
        lines[lines.length - 1]?.push(part);
      }
    });
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((child, index) => {
      appendNodeLines(child, lines, `${keyPrefix}-${index}`);
    });
    return;
  }

  if (!isValidElement<{ children?: ReactNode }>(node)) {
    lines[lines.length - 1]?.push(node);
    return;
  }

  const childLines: ReactNode[][] = [[]];
  appendNodeLines(node.props.children, childLines, `${keyPrefix}-child`);

  childLines.forEach((childLine, index) => {
    if (index > 0) {
      lines.push([]);
    }
    if (childLine.length > 0) {
      lines[lines.length - 1]?.push(
        cloneElement(node, { key: `${keyPrefix}-${index}` }, childLine),
      );
    }
  });
}

export function splitCodeLines(children: ReactNode): ReactNode[][] {
  const lines: ReactNode[][] = [[]];
  appendNodeLines(children, lines, "code");

  if (lines.length > 1 && lines[lines.length - 1]?.length === 0) {
    lines.pop();
  }

  return lines;
}
