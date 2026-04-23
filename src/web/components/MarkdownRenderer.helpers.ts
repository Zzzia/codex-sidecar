import {
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
