import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * Guards the narrow-viewport comparison table. Each stacked cell must carry its
 * own column label, because below 850px the table header is hidden and the rows
 * collapse to one column — leaving source attribution positional otherwise.
 */
const app = fs.readFileSync("src/app.js", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");
const html = fs.readFileSync("src/index.html", "utf8");

const NARROW_BLOCK = "@media(max-width:850px){";
const narrowStart = css.indexOf(NARROW_BLOCK);
const desktopCss = css.slice(0, narrowStart);
const narrowCss = css.slice(narrowStart);

const EXPECTED_COLUMNS = ["FIELD", "SITE", "DESTINATION", "MATCH"];

test("the comparison columns are declared structurally, in order", () => {
  const labels = [...app.matchAll(/label: "([A-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, EXPECTED_COLUMNS);
});

test("every generated cell carries its column label", () => {
  assert.match(app, /span\.dataset\.label = column\.label/);
  assert.match(app, /span\.textContent = column\.value\(row\)/);
  // The cells must come from the declared columns rather than a hand-built list.
  assert.match(app, /for \(const column of DIFF_COLUMNS\)/);
});

test("the labels name columns, never evidence values", () => {
  const labels = [...app.matchAll(/label: "([A-Z]+)"/g)].map((match) => match[1]);
  for (const forbidden of ["SUCCESS_DECLARED", "ACTION_ABSENT", "ACTION_PRESENT", "ORD-1042", "USD"]) {
    assert.equal(labels.includes(forbidden), false, `evidence value used as a column label: ${forbidden}`);
    assert.equal(css.includes(forbidden), false, `evidence value hardcoded in CSS: ${forbidden}`);
  }
});

test("the static table header uses the same four column names in the same order", () => {
  const head = html.slice(html.indexOf('id="diff-head"'));
  const headers = [...head.slice(0, head.indexOf("</div>")).matchAll(/<span>([A-Z]+)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(headers, EXPECTED_COLUMNS);
});

test("narrow viewports render the label from the cell's own data-label", () => {
  assert.ok(narrowStart > -1, "the narrow-viewport media query is missing");
  assert.match(narrowCss, /\.diff-row span::before\{content:attr\(data-label\)/);
  // The header is hidden at this width, which is exactly why the labels exist.
  assert.match(narrowCss, /\.diff-head\{display:none\}/);
  assert.match(narrowCss, /\.diff-row\{grid-template-columns:1fr/);
});

test("the label is text, not colour or hover", () => {
  const rule = narrowCss.slice(narrowCss.indexOf(".diff-row span::before{"));
  const body = rule.slice(0, rule.indexOf("}"));
  assert.match(body, /content:attr\(data-label\)/);
  assert.match(body, /display:block/);
  assert.equal(narrowCss.includes(":hover"), false, "the label must not depend on hover");
});

test("desktop keeps the four-column table and adds no duplicate labels", () => {
  assert.match(desktopCss, /\.diff-head,\.diff-row\{display:grid;grid-template-columns:minmax\(0,1\.1fr\) minmax\(0,1\.4fr\) minmax\(0,1\.4fr\) 6\.2rem/);
  assert.equal(desktopCss.includes("content:attr(data-label)"), false, "labels are duplicated on desktop");
});

test("the match cell is the bare boolean, so the label is not repeated in the value", () => {
  assert.match(app, /label: "MATCH", value: \(row\) => String\(row\.match\)/);
  assert.equal(app.includes('"MATCH true"'), false);
  assert.equal(app.includes('"MATCH false"'), false);
});
