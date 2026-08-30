import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the publication boundary of this repository. Everything here is checked
 * against structural signatures of secret material rather than against a list of
 * names, so the guard itself stays publishable.
 */
const SKIP_DIRS = new Set([".git", "node_modules"]);

function trackedFiles(dir = ".") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...trackedFiles(full));
    else out.push(full.split(path.sep).join("/"));
  }
  return out;
}

const files = trackedFiles();
const textFiles = files.filter((file) => /\.(mjs|js|json|html|css|md|toml|yml|yaml|txt)$/.test(file));
const contents = new Map(textFiles.map((file) => [file, fs.readFileSync(file, "utf8")]));

// Base64 prefix every PKCS#8 Ed25519 private key starts with. A committed key
// carries this prefix whatever it is named. It is assembled from parts so that
// this guard does not match itself; the guard file is still scanned by every
// other rule below.
const PKCS8_ED25519_BASE64_PREFIX = ["MC4CAQAw", "BQYDK2Vw"].join("");
const DASHES = "-".repeat(5);
const PEM_PRIVATE = new RegExp(`${DASHES}BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE ${["K", "EY"].join("")}${DASHES}`);

test("no PEM private key block is committed", () => {
  for (const [file, text] of contents) assert.equal(PEM_PRIVATE.test(text), false, `PEM private key in ${file}`);
});

test("no PKCS#8 Ed25519 private key is committed in any encoding", () => {
  for (const [file, text] of contents) {
    assert.equal(text.includes(PKCS8_ED25519_BASE64_PREFIX), false, `PKCS#8 private key material in ${file}`);
  }
});

test("the published key document contains public keys only", () => {
  const document = JSON.parse(contents.get("src/.well-known/ai-evidence-in-action-keys.json"));
  const entries = Object.entries(document.keys);
  assert.ok(entries.length > 0);
  for (const [keyId, spec] of entries) {
    assert.equal(spec.algorithm, "Ed25519");
    assert.deepEqual(Object.keys(spec).sort(), ["algorithm", "spki_base64"], `${keyId} carries an unexpected field`);
    // Every Ed25519 SPKI public key starts with this prefix; a private key does not.
    assert.ok(spec.spki_base64.startsWith("MCowBQYDK2Vw"), `${keyId} is not an Ed25519 SPKI public key`);
    assert.equal(Buffer.from(spec.spki_base64, "base64").length, 44, `${keyId} is not a 44-byte SPKI structure`);
  }
});

test("no signing secret is assigned a value anywhere in the tree", () => {
  const assignment = /(secret|password|passwd|token|api[_-]?key|signing[_-]?key|private[_-]?key)\s*[:=]\s*["'`][^"'`\s]{12,}["'`]/i;
  for (const [file, text] of contents) {
    const match = text.match(assignment);
    assert.equal(match, null, `possible assigned secret in ${file}: ${match?.[0]?.slice(0, 40)}`);
  }
});

test("the signing secret is read from the environment and never defaulted", () => {
  const fn = contents.get("netlify/functions/demo-record.mjs");
  assert.match(fn, /Netlify\.env\.get\(/);
  // No fallback literal may stand in for the missing secret.
  assert.equal(/Netlify\.env\.get\([^)]*\)\s*(\|\||\?\?)/.test(fn), false, "the signing secret has a literal fallback");
  assert.match(fn, /DEMO_SIGNING_UNAVAILABLE/);
});

test("no local filesystem path or host identity is committed", () => {
  const localPath = /[A-Za-z]:\\\\?(Users|Windows|Program Files)|\/home\/[a-z0-9._-]+\/|\/Users\/[a-z0-9._-]+\//i;
  for (const [file, text] of contents) {
    const match = text.match(localPath);
    assert.equal(match, null, `local path in ${file}: ${match?.[0]}`);
  }
});

test("no credential-bearing URL is committed", () => {
  const credentialUrl = /https?:\/\/[^/\s"'`]+:[^/@\s"'`]+@/;
  for (const [file, text] of contents) assert.equal(credentialUrl.test(text), false, `credentialed URL in ${file}`);
});

test("the page talks to its own origin only", () => {
  const app = contents.get("src/webmcp-tools.js");
  const absoluteFetch = /fetch\(\s*["'`]https?:\/\//;
  assert.equal(absoluteFetch.test(app), false);
  assert.match(app, /fetch\("\/api\/demo-record"/);
});

test("every claim of what the demo establishes is paired with what it does not", () => {
  const html = contents.get("src/index.html");
  assert.match(html, /What can be established/);
  assert.match(html, /What cannot be established/);
  assert.match(html, /not organizationally independent/);
  assert.match(html, /same demonstration operator/i);
});

test("the source labels do not present either demo source as an institution", () => {
  const html = contents.get("src/index.html");
  assert.match(html, /DEMO SITE CLAIM/);
  assert.match(html, /DEMO DESTINATION CLAIM/);
  for (const token of ["BANK", "WEB APPLICATION ACCOUNT", "SYSTEM ACCOUNT", "FINANCIAL INSTITUTION"]) {
    assert.equal(html.includes(token), false, `institution-sounding label in index.html: ${token}`);
  }
});
