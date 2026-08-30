import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/webmcp-tools.js", "utf8");
const expectedTools = ["request_refund", "get_evidence", "compare_evidence", "verify_evidence"];
const disallowedSurface = ["unregisterTool(", "destructiveHint", "idempotentHint", "openWorldHint", "requestUserConfirmation", "requestUserInteraction", "registerPrompt", "updateState(", "provideContext(", "clearContext("];

test("exactly the four challenge tools are registered", () => {
  for (const name of expectedTools) assert.match(source, new RegExp(`name: [\\\"']${name}[\\\"']`));
  assert.equal((source.match(/await register\(\{/g) || []).length, 4);
});

test("current imperative WebMCP surface is used", () => {
  assert.match(source, /document\.modelContext\.registerTool/);
  assert.match(source, /AbortController/);
  assert.match(source, /readOnlyHint/);
  assert.match(source, /untrustedContentHint/);
});

test("known non-current WebMCP APIs are absent", () => {
  for (const token of disallowedSurface) assert.equal(source.includes(token), false, `unexpected API token: ${token}`);
});
