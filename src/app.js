import { createStore, registerWebMcpTools } from "./webmcp-tools.js";
import { makeBundle } from "./evidence.js";

const $ = (id) => document.getElementById(id);
const timeline = [];

function log(kind, tool, result) {
  timeline.push({ at: new Date().toLocaleTimeString(), kind, tool, result });
  renderTimeline();
}

function renderTimeline() {
  $("timeline").replaceChildren(...timeline.map((row) => {
    const li = document.createElement("li");
    li.textContent = `${row.at} · ${row.kind} · ${row.tool} · ${row.result}`;
    return li;
  }));
}

function render(state) {
  $("site-status").textContent = state.site?.statement || "NO CLAIM";
  $("site-detail").textContent = state.site
    ? "This is what the web application reported. It is a claim, not an outcome."
    : "No refund claim has been recorded yet.";

  $("destination-status").textContent = state.destination?.statement || "NOT CHECKED";
  $("destination-detail").textContent = state.destination
    ? "The simulated destination has no record of this action."
    : "No destination evidence has been fetched yet.";

  $("verdict").textContent = state.comparison?.verdict || "INSUFFICIENT_EVIDENCE";
  $("verdict-detail").textContent = state.comparison?.verdict === "DISAGREEMENT"
    ? "The two sources do not tell the same story."
    : state.comparison?.verdict === "AGREEMENT"
      ? "The two available sources agree on the compared fields."
      : "One source is missing. AI Evidence in Action will not guess.";

  document.querySelector(".comparison-card").classList.toggle("disagreement", state.comparison?.verdict === "DISAGREEMENT");

  $("diff").replaceChildren(...(state.comparison?.diff || []).map((row) => {
    const div = document.createElement("div");
    div.className = "diff-row";
    for (const value of [row.field, String(row.site_value), String(row.destination_value)]) {
      const span = document.createElement("span");
      span.textContent = value;
      div.append(span);
    }
    return div;
  }));

  const established = [];
  if (state.site) established.push("The site declared success for the synthetic refund request.");
  if (state.destination) established.push("The simulated destination returned an ACTION_ABSENT record.");
  if (state.comparison?.verdict === "DISAGREEMENT") established.push("The currently held records conflict.");
  $("established").replaceChildren(...(established.length ? established : ["No claim has been recorded yet."]).map((value) => {
    const li = document.createElement("li");
    li.textContent = value;
    return li;
  }));

  const notEstablished = [
    "Whether money actually moved.",
    "Which source is correct or why the records differ.",
    "The identity of any real-world party."
  ];
  $("not-established").replaceChildren(...notEstablished.map((value) => {
    const li = document.createElement("li");
    li.textContent = value;
    return li;
  }));
}

const store = createStore(render, log);
render(store.state);

async function runScriptedAgent() {
  const requestId = `demo-${Date.now()}`;
  const first = store.requestRefund({ order_id: "ORD-1042", amount_cents: 6400, request_id: requestId });
  if (!first.ok) return;
  store.getEvidence({ claim_id: first.claim.claim_id, source: "destination" });
  store.compare({ claim_id: first.claim.claim_id });
  store.verify({ claim_id: first.claim.claim_id });
}

$("run-demo").addEventListener("click", runScriptedAgent);
$("reset-demo").addEventListener("click", () => {
  timeline.length = 0;
  renderTimeline();
  store.reset();
  $("bundle-output").textContent = "";
});

$("copy-bundle").addEventListener("click", async () => {
  const serialized = JSON.stringify(makeBundle(store.state.site, store.state.destination, store.state.comparison), null, 2);
  if (navigator.clipboard) await navigator.clipboard.writeText(serialized);
  $("bundle-output").textContent = serialized;
});

$("verify-bundle").addEventListener("click", () => {
  if (!store.state.site) {
    $("bundle-output").textContent = "No evidence bundle yet. Run the demo first.";
    return;
  }
  const result = store.verify({ claim_id: store.state.site.claim_id });
  $("bundle-output").textContent = JSON.stringify(result, null, 2);
});

try {
  const registration = await registerWebMcpTools(store, log);
  if (registration.supported) {
    $("agent-status").textContent = "Agent surface: ready";
  } else {
    $("agent-status").textContent = "Agent surface: unavailable";
    $("unsupported").hidden = false;
  }
} catch (error) {
  $("agent-status").textContent = "Agent surface: registration error";
  $("unsupported").hidden = false;
  log("ERROR", "registration", error?.message || String(error));
}
