import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, randomBytes, createHmac, verify } from "node:crypto";
import demoRecord from "../netlify/functions/demo-record.mjs";

const root = randomBytes(48).toString("base64");
globalThis.Netlify = { env: { get: () => root } };

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * Derives the public half of a demo key from the same test root the function is
 * given, so signatures are checked with real Ed25519 rather than by asserting
 * that the string "SIGNED" is present.
 */
function publicKeyFor(keyId) {
  const seed = createHmac("sha256", Buffer.from(root, "base64")).update(`ai-evidence-in-action/${keyId}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  return createPublicKey(privateKey);
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function cryptographicallyVerify(record) {
  const { integrity, ...payload } = record;
  const digest = createHash("sha256").update(canonicalize(payload)).digest();
  const hashValid = digest.toString("hex") === integrity.payload_sha256;
  const signatureValid = verify(null, digest, publicKeyFor(integrity.key_id), Buffer.from(integrity.sig_ed25519, "base64"));
  return { hashValid, signatureValid };
}

function request(body, method = "POST", rawBody) {
  return new Request("https://example.invalid/api/demo-record", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? (rawBody ?? JSON.stringify(body)) : undefined
  });
}

async function call(body, method, rawBody) {
  const response = await demoRecord(request(body, method, rawBody));
  return { response, body: await response.json() };
}

const valid = { mode: "site", claim_id: "clm_test", request_id: "req_test", order_id: "ORD-1042", amount_cents: 6400 };

test("demo record function rejects non-POST", async () => {
  const { response } = await call(null, "GET");
  assert.equal(response.status, 405);
});

test("demo record function rejects unsupported mode", async () => {
  const { response, body } = await call({ ...valid, mode: "other" });
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "MODE_INVALID");
});

test("demo record function rejects non-demo inputs", async () => {
  const { response, body } = await call({ ...valid, amount_cents: 1 });
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "DEMO_INPUT_INVALID");
});

test("demo record function rejects unsafe identifiers", async () => {
  const { response, body } = await call({ ...valid, request_id: "<script>alert(1)</script>" });
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "IDENTIFIER_INVALID");
});

test("demo record function rejects malformed JSON", async () => {
  const { response, body } = await call(null, "POST", "{ this is not json");
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "MALFORMED_JSON");
});

test("demo record function rejects a non-object JSON body", async () => {
  const { response, body } = await call(null, "POST", JSON.stringify(["ORD-1042"]));
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "MALFORMED_JSON");
});

test("demo record function rejects an oversized body by measured length", async () => {
  // The padding lives in an ignored field, so only the size can cause the refusal.
  const oversized = JSON.stringify({ ...valid, padding: "A".repeat(8192) });
  assert.ok(Buffer.byteLength(oversized, "utf8") > 4096);
  const { response, body } = await call(null, "POST", oversized);
  assert.equal(response.status, 413);
  assert.equal(body.error.code, "PAYLOAD_TOO_LARGE");
});

test("demo record function emits bounded signed site and destination records", async () => {
  const site = (await call(valid)).body.record;
  assert.equal(site.statement, "SUCCESS_DECLARED");
  assert.equal(site.integrity.status, "SIGNED");
  assert.equal(site.integrity.key_id, "site-demo-2026");

  const destination = (await call({ ...valid, mode: "destination" })).body.record;
  assert.equal(destination.statement, "ACTION_ABSENT");
  assert.equal(destination.integrity.status, "SIGNED");
  assert.equal(destination.integrity.key_id, "destination-demo-2026");
});

test("a valid site signature cryptographically verifies", async () => {
  const site = (await call(valid)).body.record;
  const result = cryptographicallyVerify(site);
  assert.equal(result.hashValid, true);
  assert.equal(result.signatureValid, true);
});

test("a valid destination signature cryptographically verifies", async () => {
  const destination = (await call({ ...valid, mode: "destination" })).body.record;
  const result = cryptographicallyVerify(destination);
  assert.equal(result.hashValid, true);
  assert.equal(result.signatureValid, true);
});

test("an altered record fails hash and signature verification", async () => {
  const site = (await call(valid)).body.record;
  const altered = { ...site, statement: "ACTION_PRESENT" };
  const result = cryptographicallyVerify(altered);
  assert.equal(result.hashValid, false);
  assert.equal(result.signatureValid, false);
});

test("an altered subject field fails verification", async () => {
  const site = (await call(valid)).body.record;
  const altered = { ...site, subject: { ...site.subject, amount_cents: 1 } };
  assert.equal(cryptographicallyVerify(altered).hashValid, false);
});

test("the agreement fixture is reachable and server-signed", async () => {
  const site = (await call({ ...valid, scenario: "agreement" })).body.record;
  const destination = (await call({ ...valid, mode: "destination", scenario: "agreement" })).body.record;
  assert.equal(site.statement, "SUCCESS_DECLARED");
  assert.equal(destination.statement, "ACTION_PRESENT");
  assert.equal(site.scenario, "agreement");
  assert.equal(destination.scenario, "agreement");
  assert.equal(cryptographicallyVerify(destination).signatureValid, true);
});

test("the disagreement fixture is the default and is reachable explicitly", async () => {
  const implicit = (await call({ ...valid, mode: "destination" })).body.record;
  const explicit = (await call({ ...valid, mode: "destination", scenario: "disagreement" })).body.record;
  assert.equal(implicit.statement, "ACTION_ABSENT");
  assert.equal(implicit.scenario, "disagreement");
  assert.equal(explicit.statement, "ACTION_ABSENT");
});

test("the insufficient-evidence fixture withholds the destination record entirely", async () => {
  const site = (await call({ ...valid, scenario: "insufficient_evidence" })).body.record;
  assert.equal(site.statement, "SUCCESS_DECLARED");
  const { response, body } = await call({ ...valid, mode: "destination", scenario: "insufficient_evidence" });
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "DESTINATION_EVIDENCE_UNAVAILABLE");
  assert.equal(body.record, undefined);
});

test("an unknown scenario is refused rather than defaulted", async () => {
  const { response, body } = await call({ ...valid, scenario: "always_agree" });
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "SCENARIO_INVALID");
});

test("a non-string scenario is refused", async () => {
  for (const scenario of [{ toString: () => "agreement" }, ["agreement"], 1, true]) {
    const { response, body } = await call({ ...valid, scenario });
    assert.equal(response.status, 400, `scenario ${JSON.stringify(scenario)} was not refused`);
    assert.equal(body.error.code, "SCENARIO_INVALID");
  }
});

test("a prototype-chain scenario name is refused", async () => {
  for (const scenario of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const { response, body } = await call({ ...valid, scenario });
    assert.equal(response.status, 400, `scenario ${scenario} was not refused`);
    assert.equal(body.error.code, "SCENARIO_INVALID");
  }
});

test("a destination request cannot override the server-controlled statement", async () => {
  const { body } = await call({ ...valid, mode: "destination", statement: "ACTION_PRESENT" });
  assert.equal(body.record.statement, "ACTION_ABSENT");
  assert.equal(cryptographicallyVerify(body.record).signatureValid, true);
});

test("a site request cannot override the server-controlled statement", async () => {
  const { body } = await call({ ...valid, statement: "ACTION_ABSENT" });
  assert.equal(body.record.statement, "SUCCESS_DECLARED");
});

test("a request cannot override subject fields", async () => {
  const { body } = await call({
    ...valid,
    mode: "destination",
    subject: { order_id: "ORD-9999", amount_cents: 999999, currency: "XXX" },
    currency: "XXX"
  });
  assert.deepEqual(body.record.subject, { order_id: "ORD-1042", amount_cents: 6400, currency: "USD" });
});

test("a request cannot override record type, source, integrity or scenario binding", async () => {
  const { body } = await call({
    ...valid,
    mode: "destination",
    record_type: "site_claim",
    source: { id: "some-bank", origin: "https://example.test" },
    integrity: { status: "SIGNED", key_id: "site-demo-2026" },
    record_id: "rec_attacker_chosen"
  });
  assert.equal(body.record.record_type, "destination_report");
  assert.equal(body.record.source.id, "destination-demo");
  assert.equal(body.record.source.origin, "https://example.invalid");
  assert.notEqual(body.record.record_id, "rec_attacker_chosen");
  assert.equal(body.record.integrity.key_id, "destination-demo-2026");
  assert.equal(cryptographicallyVerify(body.record).signatureValid, true);
});

test("the function refuses to sign when no signing secret is configured", async () => {
  const configured = globalThis.Netlify;
  globalThis.Netlify = { env: { get: () => undefined } };
  try {
    const { response, body } = await call(valid);
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "DEMO_SIGNING_UNAVAILABLE");
  } finally {
    globalThis.Netlify = configured;
  }
});
