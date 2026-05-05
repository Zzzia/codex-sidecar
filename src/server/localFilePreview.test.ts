import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  LocalFilePreviewError,
  previewLocalFile,
} from "./localFilePreview.js";

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "codex-sidecar-preview-"));
  await mkdir(path.join(workspace, "src"));
  await writeFile(path.join(workspace, "README.md"), "# Hello\n");
  await writeFile(path.join(workspace, "src", "main.ts"), "export const value = 1;\n");
  await writeFile(path.join(workspace, "image.png"), "fake");
  await writeFile(path.join(workspace, "diagram.svg"), "<svg></svg>");
  await writeFile(path.join(workspace, "report.pdf"), "%PDF-1.4\n");
  await writeFile(path.join(workspace, "archive.bin"), "unknown");
  return workspace;
}

test("previewLocalFile previews markdown and code files under cwd", async (t) => {
  const workspace = await createWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const markdown = await previewLocalFile(workspace, "README.md");
  assert.equal(markdown.kind, "markdown");
  assert.equal(markdown.displayPath, "README.md");
  assert.equal(markdown.content, "# Hello\n");

  const code = await previewLocalFile(workspace, "./src/main.ts#L1");
  assert.equal(code.kind, "code");
  assert.equal(code.displayPath, path.join("src", "main.ts"));
  assert.match(code.content ?? "", /export const value/);
});

test("previewLocalFile accepts codex-style path line suffixes", async (t) => {
  const workspace = await createWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const preview = await previewLocalFile(workspace, "src/main.ts:12:3");

  assert.equal(preview.kind, "code");
  assert.equal(preview.displayPath, path.join("src", "main.ts"));
});

test("previewLocalFile supports file urls inside cwd", async (t) => {
  const workspace = await createWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const fileUrl = pathToFileURL(path.join(workspace, "README.md")).toString();

  const preview = await previewLocalFile(workspace, fileUrl);

  assert.equal(preview.kind, "markdown");
  assert.equal(preview.displayPath, "README.md");
});

test("previewLocalFile decodes percent-encoded local paths", async (t) => {
  const workspace = await createWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const documentDirectory = "斗破苍穹";
  const documentPath = path.join(documentDirectory, "timeline.md");
  await mkdir(path.join(workspace, documentDirectory));
  await writeFile(path.join(workspace, documentPath), "# 时间线\n");

  const absolutePreview = await previewLocalFile(
    workspace,
    encodeURI(path.join(workspace, documentPath)),
  );
  assert.equal(absolutePreview.kind, "markdown");
  assert.equal(absolutePreview.displayPath, documentPath);
  assert.equal(absolutePreview.content, "# 时间线\n");

  const relativePreview = await previewLocalFile(workspace, encodeURI(documentPath));
  assert.equal(relativePreview.kind, "markdown");
  assert.equal(relativePreview.displayPath, documentPath);
  assert.equal(relativePreview.content, "# 时间线\n");
});

test("previewLocalFile keeps literal percent-encoded filenames when they exist", async (t) => {
  const workspace = await createWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const literalPercentName = "%E6%96%97.md";
  await writeFile(path.join(workspace, literalPercentName), "literal percent\n");

  const preview = await previewLocalFile(workspace, literalPercentName);

  assert.equal(preview.kind, "markdown");
  assert.equal(preview.displayPath, literalPercentName);
  assert.equal(preview.content, "literal percent\n");
});

test("previewLocalFile embeds common image and pdf files", async (t) => {
  const workspace = await createWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const image = await previewLocalFile(workspace, "image.png");
  assert.equal(image.kind, "image");
  assert.equal(image.mimeType, "image/png");
  assert.match(image.dataUrl ?? "", /^data:image\/png;base64,/);
  assert.equal(image.content, undefined);

  const svg = await previewLocalFile(workspace, "diagram.svg");
  assert.equal(svg.kind, "image");
  assert.equal(svg.mimeType, "image/svg+xml");

  const pdf = await previewLocalFile(workspace, "report.pdf");
  assert.equal(pdf.kind, "pdf");
  assert.equal(pdf.mimeType, "application/pdf");
  assert.match(pdf.dataUrl ?? "", /^data:application\/pdf;base64,/);
});

test("previewLocalFile previews absolute paths outside cwd", async (t) => {
  const workspace = await createWorkspace();
  const outside = await mkdtemp(path.join(os.tmpdir(), "codex-sidecar-outside-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));

  const outsideFile = path.join(outside, "outside.ts");
  await writeFile(outsideFile, "export const outside = true;\n");

  const preview = await previewLocalFile(workspace, outsideFile);

  assert.equal(preview.kind, "code");
  assert.equal(preview.displayPath, outsideFile);
  assert.match(preview.content ?? "", /outside/);
});

test("previewLocalFile previews symlinks that resolve outside cwd", async (t) => {
  const workspace = await createWorkspace();
  const outside = await mkdtemp(path.join(os.tmpdir(), "codex-sidecar-outside-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));

  await writeFile(path.join(outside, "secret.ts"), "export const secret = true;\n");
  await symlink(path.join(outside, "secret.ts"), path.join(workspace, "secret.ts"));

  const preview = await previewLocalFile(workspace, "secret.ts");

  assert.equal(preview.kind, "code");
  assert.equal(preview.displayPath, "secret.ts");
  assert.match(preview.content ?? "", /secret/);
});

test("previewLocalFile returns unsupported result without reading unknown files", async (t) => {
  const workspace = await createWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const preview = await previewLocalFile(workspace, "archive.bin");

  assert.equal(preview.kind, "unsupported");
  assert.equal(preview.content, undefined);
  assert.equal(preview.dataUrl, undefined);
});
