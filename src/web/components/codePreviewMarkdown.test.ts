import test from "node:test";
import assert from "node:assert/strict";
import {
  codeLanguageFromPath,
  createCodePreviewMarkdown,
} from "./codePreviewMarkdown.js";

test("codeLanguageFromPath maps preview paths to highlight languages", () => {
  assert.equal(codeLanguageFromPath("src/main.ts"), "typescript");
  assert.equal(codeLanguageFromPath("Halo/app/build.gradle.kts"), "kotlin");
  assert.equal(codeLanguageFromPath("pnpm-lock.yaml"), "yaml");
  assert.equal(codeLanguageFromPath("unknown-file"), null);
});

test("createCodePreviewMarkdown uses a safe fence for code containing backticks", () => {
  const markdown = createCodePreviewMarkdown("const fence = ```;\n", "src/main.ts");

  assert.match(markdown, /^````typescript\n/);
  assert.match(markdown, /\n````$/);
});
