import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InlinePatchRun } from "./TimelineInspectors.js";
import type { PatchRunView } from "@web/lib/turns";

test("InlinePatchRun renders every patch file expanded by default", () => {
  const item: PatchRunView = {
    callId: "call-1",
    id: "patch-1",
    ts: "2026-04-22T08:00:00.000Z",
    invocationText: "",
    summary: "代码修改",
    success: true,
    changes: [
      {
        path: "/workspace/demo/src/a.ts",
        displayPath: "src/a.ts",
        changeType: "update",
        unifiedDiff: "@@ -1,1 +1,1 @@\n-old\n+new",
      },
      {
        path: "/workspace/demo/src/b.ts",
        displayPath: "src/b.ts",
        changeType: "update",
        unifiedDiff: "@@ -1,1 +1,1 @@\n-old\n+newer",
      },
    ],
  };

  const markup = renderToStaticMarkup(React.createElement(InlinePatchRun, { item }));
  const openCount = (markup.match(/<details class=\"inline-patch-file\" open=\"\"/g) ?? []).length;

  assert.equal(openCount, 2);
});
