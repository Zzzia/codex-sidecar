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
});
