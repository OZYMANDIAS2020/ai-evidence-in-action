import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compareRecords } from "../src/evidence.js";
import { buildViewModel } from "../src/view-model.js";

const subject = { order_id: "ORD-1042", amount_cents: 6400, currency: "USD" };
const site = { record_id: "rec_site", record_type: "site_claim", statement: "SUCCESS_DECLARED", subject, integrity: { status: "SIGNED", key_id: "site-demo-2026" } };
const destinationWith = (statement) => ({ record_id: "rec_destination", record_type: "destination_report", statement, subject, integrity: { status: "SIGNED", key_id: "destination-demo-2026" } });

function stateFor(destination, extra = {}) {
  return { site, destination, comparison: compareRecords(site, destination), ...extra };
}

test("destination copy is derived from the returned statement, not assumed", () => {
  const absent = buildViewModel(stateFor(destinationWith("ACTION_ABSENT"))).destination.detail;
  const present = buildViewModel(stateFor(destinationWith("ACTION_PRESENT"))).destination.detail;
  assert.match(absent, /ACTION_ABSENT/);
  assert.match(present, /ACTION_PRESENT/);
  assert.notEqual(absent, present);
  // The ACTION_PRESENT view must not carry the ACTION_ABSENT description.
  assert.equal(present.includes("ACTION_ABSENT"), false);
  assert.equal(present.includes("no matching action"), false);
});

test("destination copy quotes an unrecognised statement instead of describing it", () => {
  const detail = buildViewModel(stateFor(destinationWith("ACTION_PARTIALLY_OBSERVED"))).destination.detail;
  assert.match(detail, /ACTION_PARTIALLY_OBSERVED/);
  assert.match(detail, /not in the published demo vocabulary/);
});

test("destination copy reflects the actual subject values", () => {
  const other = { ...destinationWith("ACTION_PRESENT"), subject: { order_id: "ORD-2001", amount_cents: 12550, currency: "EUR" } };
  const detail = buildViewModel(stateFor(other)).destination.detail;
  assert.match(detail, /ORD-2001/);
  assert.match(detail, /125\.50 EUR/);
});

test("an unavailable destination is described as absent evidence, not as failure", () => {
  const view = buildViewModel({ site, destination: null, destinationUnavailable: true, comparison: { verdict: "INSUFFICIENT_EVIDENCE", diff: [], reason: "DESTINATION_UNAVAILABLE" } });
  assert.equal(view.destination.status, "DESTINATION_UNAVAILABLE");
  assert.match(view.destination.detail, /no evidence/i);
  assert.match(view.destination.detail, /not treated as failure/i);
  assert.equal(view.destination.integrity, "No signed record yet");
});

test("no destination prose is present before any destination has been checked", () => {
  const view = buildViewModel({ site: null, destination: null, comparison: { verdict: "INSUFFICIENT_EVIDENCE", diff: [] } });
  assert.equal(view.destination.status, "NOT CHECKED");
  assert.equal(view.destination.detail.includes("ACTION_ABSENT"), false);
  assert.equal(view.site.detail.includes("SUCCESS_DECLARED"), false);
});

test("the established list is derived from the records actually held", () => {
  const view = buildViewModel(stateFor(destinationWith("ACTION_PRESENT")));
  assert.ok(view.established.some((line) => line.includes("ACTION_PRESENT")));
  assert.equal(view.established.some((line) => line.includes("ACTION_ABSENT")), false);
  assert.ok(view.established.some((line) => /agree on every compared field/.test(line)));
});

test("a failed verdict recomputation is stated in the established list", () => {
  const view = buildViewModel(stateFor(destinationWith("ACTION_ABSENT"), { verification: { overall: "SIGNATURE_VALID", verdict_matches: false, bundle_status: "COMPARISON_ALTERED" } }));
  assert.ok(view.established.some((line) => line.includes("does NOT match")));
  assert.equal(view.verificationStatus, "COMPARISON_ALTERED");
});

test("the comparison view exposes the statement conflict for rendering", () => {
  const view = buildViewModel(stateFor(destinationWith("ACTION_ABSENT")));
  assert.equal(view.comparison.verdict, "DISAGREEMENT");
  assert.equal(view.comparison.isDisagreement, true);
  const statement = view.comparison.diff.find((row) => row.field === "statement");
  assert.equal(statement.site_value, "SUCCESS_DECLARED");
  assert.equal(statement.destination_value, "ACTION_ABSENT");
  assert.equal(statement.match, false);
});

test("the view never names a correct source or scores the sources", () => {
  const view = buildViewModel(stateFor(destinationWith("ACTION_ABSENT")));
  // Scanned over the affirmative panes only: the disclaimer pane is required to
  // say that which source is correct is NOT established, so scanning it for the
  // same words would reject the very sentence being checked for.
  const affirmative = JSON.stringify([view.site, view.destination, view.comparison, view.established]).toLowerCase();
  for (const token of ["confidence", "score", "probability", "trustworthy", "is correct", "lying", "fraud"]) {
    assert.equal(affirmative.includes(token), false, `unexpected token in view model: ${token}`);
  }
  assert.ok(view.notEstablished.some((line) => line.includes("Which source is correct")));
});

test("the page renders its source copy from the view model, with no hardcoded statement prose", () => {
  const app = fs.readFileSync("src/app.js", "utf8");
  assert.match(app, /buildViewModel/);
  for (const token of ["ACTION_ABSENT", "ACTION_PRESENT", "SUCCESS_DECLARED", "no matching action"]) {
    assert.equal(app.includes(token), false, `app.js still hardcodes ${token}`);
  }
  const html = fs.readFileSync("src/index.html", "utf8");
  for (const token of ["ACTION_ABSENT", "ACTION_PRESENT", "SUCCESS_DECLARED"]) {
    assert.equal(html.includes(token), false, `index.html still hardcodes ${token}`);
  }
});
