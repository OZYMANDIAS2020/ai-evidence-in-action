import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SCENARIOS } from "../src/evidence.js";

const source = fs.readFileSync("src/webmcp-tools.js", "utf8");
const app = fs.readFileSync("src/app.js", "utf8");
const html = fs.readFileSync("src/index.html", "utf8");
const expectedTools = ["request_refund", "get_evidence", "compare_evidence", "verify_evidence"];
const disallowedSurface = ["unregisterTool(", "destructiveHint", "idempotentHint", "openWorldHint", "requestUserConfirmation", "requestUserInteraction", "registerPrompt", "updateState(", "provideContext(", "clearContext("];

test("exactly the four challenge tools are registered", () => {
  for (const name of expectedTools) assert.match(source, new RegExp(`name: [\\"']${name}[\\"']`));
  assert.equal((source.match(/await register\(\{/g) || []).length, 4);
});

test("current imperative WebMCP surface is used", () => {
  assert.match(source, /document\.modelContext\.registerTool/);
  assert.match(source, /AbortController/);
  assert.match(source, /readOnlyHint/);
  assert.match(source, /untrustedContentHint/);
  assert.match(app, /document\.modelContext\?\.getTools/);
  assert.match(app, /document\.modelContext\?\.executeTool/);
});

test("known non-current WebMCP APIs are absent", () => {
  for (const token of disallowedSurface) assert.equal(source.includes(token), false, `unexpected API token: ${token}`);
});

test("only the two currently valid annotations are used", () => {
  const annotations = [...source.matchAll(/annotations: \{([^}]*)\}/g)].flatMap((match) => match[1].split(",").map((entry) => entry.split(":")[0].trim()));
  assert.ok(annotations.length > 0);
  for (const annotation of annotations) assert.ok(["readOnlyHint", "untrustedContentHint"].includes(annotation), `unexpected annotation: ${annotation}`);
});

test("the scenario input is a bounded enum on the one state-changing tool", () => {
  assert.match(source, /scenario: \{ type: "string", enum: SCENARIOS/);
  // The three read-only tools take no scenario: the fixture is bound at claim
  // time. Only the registration region is inspected, not the store below it.
  const registrations = source.slice(0, source.indexOf("export function createStore")).split("await register({").slice(1);
  assert.equal(registrations.length, 4);
  assert.ok(registrations[0].includes("scenario:"));
  for (const block of registrations.slice(1)) assert.equal(block.includes("scenario:"), false, "a read-only tool exposes a scenario input");
});

test("the page and the published enum agree on the three fixtures", () => {
  assert.deepEqual(SCENARIOS, ["disagreement", "agreement", "insufficient_evidence"]);
  for (const scenario of SCENARIOS) assert.ok(html.includes(`value="${scenario}"`), `no selector option for ${scenario}`);
  assert.match(html, /value="disagreement" checked/);
});

test("the unsupported-browser fallback stays explicit", () => {
  assert.match(html, /id="unsupported"/);
  assert.match(html, /does not currently expose/);
  assert.match(html, /document\.modelContext/);
  assert.match(app, /\$\("unsupported"\)\.hidden = false/);
  // The scripted demo must still run through the store when WebMCP is absent.
  assert.match(app, /usingWebMcp \? await executeRegisteredTool\("request_refund", input\) : await store\.requestRefund\(input\)/);
});

test("the runtime adaptation is confined to one place and fails closed", () => {
  const occurrences = (app.match(/typeof raw === "string"/g) || []).length;
  assert.equal(occurrences, 1, "result normalisation should live in exactly one boundary");
  assert.match(app, /TOOL_RESULT_UNPARSEABLE/);
});

/**
 * The two regressions below were found only by running against a native
 * runtime (Chrome 152.0.7977.64). Both failed silently in every non-native
 * path, so they are pinned here as source-level guards.
 */
test("no tool destructures a second execute argument the runtime does not pass", () => {
  // Chrome 152 invokes execute with exactly one argument; destructuring a
  // second parameter throws before the tool body runs.
  const executeSignatures = [...source.matchAll(/execute: async \(([^)]*)\)/g)].map((match) => match[1]);
  assert.equal(executeSignatures.length, 4);
  for (const signature of executeSignatures) {
    assert.equal(signature.includes("{"), false, `execute destructures its arguments: (${signature})`);
  }
  assert.match(source, /execute: async \(input, options\) => store\.requestRefund\(input, options\?\.signal\)/);
});

test("tool arguments cross the boundary as an object with a legacy Chrome fallback", () => {
  // Current runtimes require an object. Chrome 152's experimental runtime
  // rejected that representation before execution, so retain a narrow fallback.
  assert.match(app, /executeTool\(tool, input\)/);
  assert.match(app, /executeTool\(tool, JSON\.stringify\(input\)\)/);
  assert.match(app, /Failed to parse input arguments/);
});
