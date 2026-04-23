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

test("previewLocalFile rejects paths outside cwd", async (t) => {
  const workspace = await createWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));

  await assert.rejects(
    () => previewLocalFile(workspace, "../outside.ts"),
    (error) =>
      error instanceof LocalFilePreviewError && error.statusCode === 403,
  );
});

test("previewLocalFile rejects symlinks that resolve outside cwd", async (t) => {
  const workspace = await createWorkspace();
  const outside = await mkdtemp(path.join(os.tmpdir(), "codex-sidecar-outside-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));

  await writeFile(path.join(outside, "secret.ts"), "export const secret = true;\n");
  await symlink(path.join(outside, "secret.ts"), path.join(workspace, "secret.ts"));

  await assert.rejects(
    () => previewLocalFile(workspace, "secret.ts"),
    (error) =>
      error instanceof LocalFilePreviewError && error.statusCode === 403,
  );
});

test("previewLocalFile returns unsupported result without reading unknown files", async (t) => {
  const workspace = await createWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const preview = await previewLocalFile(workspace, "image.png");

  assert.equal(preview.kind, "unsupported");
  assert.equal(preview.content, undefined);
});
