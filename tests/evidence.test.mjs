import test from "node:test";
import assert from "node:assert/strict";
import { compareRecords, SCHEMA } from "../src/evidence.js";

const site = {
  schema: SCHEMA,
  statement: "SUCCESS_DECLARED",
  subject: { order_id: "ORD-1042", amount_cents: 6400, currency: "USD" }
};

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
  assert.equal(result.diff.find((row) => row.field === "amount_cents").match, false);
});
