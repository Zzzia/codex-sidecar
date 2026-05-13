import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "./MarkdownRenderer.js";

test("MarkdownRenderer can render highlighted code blocks with line numbers", () => {
  const markup = renderToStaticMarkup(
    React.createElement(MarkdownRenderer, {
      text: "```ts\nexport const value = 1;\nconsole.log(value);\n```",
      codeBlockLineNumbers: true,
    }),
  );

  assert.match(markup, /class="[^"]*code-block-with-lines/);
  assert.match(markup, /data-line="1"/);
  assert.match(markup, /data-line="2"/);
  assert.match(markup, /hljs-keyword/);
  assert.match(markup, /class="[^"]*copyable-code-block/);
  assert.match(markup, /aria-label="复制代码块"/);
});

test("MarkdownRenderer does not add copy controls to inline code", () => {
  const markup = renderToStaticMarkup(
    React.createElement(MarkdownRenderer, {
      text: "Use `pnpm test` before pushing.",
    }),
  );

  assert.doesNotMatch(markup, /copyable-code-block/);
  assert.doesNotMatch(markup, /aria-label="复制代码块"/);
});

test("MarkdownRenderer keeps mermaid-labeled snippets as code blocks", () => {
  const markup = renderToStaticMarkup(
    React.createElement(MarkdownRenderer, {
      text: "```mermaid\nB[BFF /conversations/{id}/turn]\n```",
    }),
  );

  assert.match(markup, /copyable-code-block/);
  assert.match(markup, /BFF \/conversations\/\{id\}\/turn/);
  assert.doesNotMatch(markup, /Mermaid 渲染中/);
});
