import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {
  codeChildFromPre,
  codeLanguageFromClassName,
  textFromReactNode,
} from "./MarkdownRenderer.helpers.js";

test("codeChildFromPre accepts react-markdown mapped code elements", () => {
  function Code(props: { className?: string; children?: React.ReactNode }) {
    return React.createElement("code", props);
  }

  const child = React.createElement(
    Code,
    { className: "language-mermaid" },
    "graph TD;\nA-->B;\n",
  );

  const codeChild = codeChildFromPre([child]);

  assert.equal(codeChild?.props.className, "language-mermaid");
  assert.equal(codeLanguageFromClassName(codeChild?.props.className), "mermaid");
  assert.equal(textFromReactNode(codeChild?.props.children).trim(), "graph TD;\nA-->B;");
});

test("codeLanguageFromClassName normalizes fenced code language", () => {
  assert.equal(codeLanguageFromClassName("inline-code language-Mermaid"), "mermaid");
  assert.equal(codeLanguageFromClassName("inline-code"), null);
});
