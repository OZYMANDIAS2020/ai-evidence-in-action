import test from "node:test";
import assert from "node:assert/strict";
import { compareRecords, COMPARED_FIELDS, SCHEMA } from "../src/evidence.js";

const site = {
  schema: SCHEMA,
  statement: "SUCCESS_DECLARED",
  subject: { order_id: "ORD-1042", amount_cents: 6400, currency: "USD" }
};

const row = (result, field) => result.diff.find((entry) => entry.field === field);

test("missing destination is insufficient evidence", () => {
  const result = compareRecords(site, null);
  assert.equal(result.verdict, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(result.missing, ["destination"]);
});

test("destination absence is disagreement", () => {
  const destination = { statement: "ACTION_ABSENT", subject: { ...site.subject } };
  assert.equal(compareRecords(site, destination).verdict, "DISAGREEMENT");
});

test("present matching destination is agreement", () => {
  const destination = { statement: "ACTION_PRESENT", subject: { ...site.subject } };
  assert.equal(compareRecords(site, destination).verdict, "AGREEMENT");
});

test("field mismatch is disagreement", () => {
  const destination = { statement: "ACTION_PRESENT", subject: { ...site.subject, amount_cents: 640 } };
  const result = compareRecords(site, destination);
  assert.equal(result.verdict, "DISAGREEMENT");
  assert.equal(row(result, "amount_cents").match, false);
});

test("the comparison carries the two statements and marks the conflict", () => {
  const destination = { statement: "ACTION_ABSENT", subject: { ...site.subject } };
  const result = compareRecords(site, destination);
  const statement = row(result, "statement");
  assert.equal(statement.site_value, "SUCCESS_DECLARED");
  assert.equal(statement.destination_value, "ACTION_ABSENT");
  assert.equal(statement.match, false);
  // The visible conflict must be the statement row, not a verdict asserted over
  // four rows that all agree.
  assert.deepEqual(result.diff.filter((entry) => entry.match === false).map((entry) => entry.field), ["statement"]);
  assert.equal(result.verdict, "DISAGREEMENT");
});

test("every required field is compared, statement first", () => {
  const destination = { statement: "ACTION_ABSENT", subject: { ...site.subject } };
  const fields = compareRecords(site, destination).diff.map((entry) => entry.field);
  assert.deepEqual(fields, ["statement", "order_id", "amount_cents", "currency"]);
  for (const field of ["statement", "order_id", "amount_cents", "currency"]) assert.ok(COMPARED_FIELDS.includes(field));
});

test("an agreeing statement pair matches on every row", () => {
  const destination = { statement: "ACTION_PRESENT", subject: { ...site.subject } };
  const result = compareRecords(site, destination);
  assert.equal(row(result, "statement").match, true);
  assert.equal(result.diff.every((entry) => entry.match), true);
});

test("a statement outside the published table is not comparable, not a disagreement", () => {
  const destination = { statement: "ACTION_PARTIALLY_OBSERVED", subject: { ...site.subject } };
  const result = compareRecords(site, destination);
  assert.equal(result.verdict, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.reason, "STATEMENT_NOT_COMPARABLE");
  assert.equal(row(result, "statement").destination_value, "ACTION_PARTIALLY_OBSERVED");
});

test("the comparison emits no score, probability or truth attribution", () => {
  const destination = { statement: "ACTION_ABSENT", subject: { ...site.subject } };
  const serialized = JSON.stringify(compareRecords(site, destination)).toLowerCase();
  for (const token of ["confidence", "score", "probability", "trust", "likely", "correct_source", "winner"]) {
    assert.equal(serialized.includes(token), false, `unexpected token in comparison output: ${token}`);
  }
});
