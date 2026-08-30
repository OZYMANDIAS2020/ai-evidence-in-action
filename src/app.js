import { createStore, registerWebMcpTools } from "./webmcp-tools.js";
import { DEFAULT_SCENARIO, makeBundle, SCENARIOS } from "./evidence.js";
import { buildViewModel } from "./view-model.js";

const $ = (id) => document.getElementById(id);
const timeline = [];
function log(kind, tool, result) { timeline.push({ at: new Date().toLocaleTimeString(), kind, tool, result }); renderTimeline(); }
function renderTimeline() { $("timeline").replaceChildren(...timeline.map((row) => { const li = document.createElement("li"); li.textContent = `${row.at} · ${row.kind} · ${row.tool} · ${row.result}`; return li; })); }
function listItems(id, values) { $(id).replaceChildren(...values.map((value) => { const li = document.createElement("li"); li.textContent = value; return li; })); }

function selectedScenario() {
  const checked = document.querySelector('input[name="scenario"]:checked');
  return SCENARIOS.includes(checked?.value) ? checked.value : DEFAULT_SCENARIO;
}

function render(state) {
  const view = buildViewModel(state);
  $("site-status").textContent = view.site.status;
  $("site-detail").textContent = view.site.detail;
  $("site-integrity").textContent = view.site.integrity;
  $("destination-status").textContent = view.destination.status;
  $("destination-detail").textContent = view.destination.detail;
  $("destination-integrity").textContent = view.destination.integrity;
  $("verdict").textContent = view.comparison.label;
  $("verdict-detail").textContent = view.comparison.detail;
  document.querySelector(".comparison-card").classList.toggle("disagreement", view.comparison.isDisagreement);
  $("diff-head").hidden = view.comparison.diff.length === 0;
  $("diff").replaceChildren(...view.comparison.diff.map((row) => {
    const div = document.createElement("div");
    div.className = `diff-row ${row.match ? "row-match" : "row-mismatch"}`;
    const cells = [row.field, String(row.site_value), String(row.destination_value), row.match ? "MATCH true" : "MATCH false"];
    for (const value of cells) { const span = document.createElement("span"); span.textContent = value; div.append(span); }
    return div;
  }));
  listItems("established", view.established);
  listItems("not-established", view.notEstablished);
  $("verification-status").textContent = view.verificationStatus;
}

const store = createStore(render, log); render(store.state);

/**
 * The only adaptation between this page and the browser's WebMCP runtime, and
 * the only place that knows how this runtime moves values across the boundary.
 *
 * Measured against Chrome 152.0.7977.64 (document.modelContext, flag
 * enable-webmcp-testing), not read off the specification:
 *   - executeTool takes the RegisteredTool from getTools plus its arguments as
 *     a JSON string; passing a plain object fails with "Failed to parse input
 *     arguments".
 *   - results come back as a JSON string.
 * Both are normalised here so nothing downstream has to know either fact.
 */
async function executeRegisteredTool(name, input) {
  if (!document.modelContext?.getTools || !document.modelContext?.executeTool) return null;
  const tools = await document.modelContext.getTools();
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Registered tool ${name} was not discovered.`);
  const raw = await document.modelContext.executeTool(tool, JSON.stringify(input));
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return { ok: false, error: { code: "TOOL_RESULT_UNPARSEABLE", message: raw } }; } }
  return raw;
}

async function runScriptedAgent() {
  $("run-demo").disabled = true;
  try {
    const requestId = `demo-${Date.now()}`;
    const input = { order_id: "ORD-1042", amount_cents: 6400, request_id: requestId, scenario: selectedScenario() };
    const usingWebMcp = Boolean(document.modelContext?.getTools && document.modelContext?.executeTool);
    const first = usingWebMcp ? await executeRegisteredTool("request_refund", input) : await store.requestRefund(input);
    if (!first?.ok) throw new Error(first?.error?.message || "Synthetic refund request failed.");
    const claimId = first.claim.claim_id;
    if (usingWebMcp) {
      await executeRegisteredTool("get_evidence", { claim_id: claimId, source: "destination" });
      await executeRegisteredTool("compare_evidence", { claim_id: claimId });
      const verified = await executeRegisteredTool("verify_evidence", { claim_id: claimId });
      $("bundle-output").textContent = JSON.stringify(verified, null, 2);
    } else {
      await store.getEvidence({ claim_id: claimId, source: "destination" });
      store.compare({ claim_id: claimId });
      const verified = await store.verify({ claim_id: claimId });
      $("bundle-output").textContent = JSON.stringify(verified, null, 2);
    }
  } catch (error) { log("ERROR", "scripted-agent", error?.message || String(error)); $("bundle-output").textContent = `Demo error: ${error?.message || error}`; }
  finally { $("run-demo").disabled = false; }
}

$("run-demo").addEventListener("click", runScriptedAgent);
$("reset-demo").addEventListener("click", () => { timeline.length = 0; renderTimeline(); store.reset(); $("bundle-output").textContent = ""; });
for (const radio of document.querySelectorAll('input[name="scenario"]')) {
  radio.addEventListener("change", () => { timeline.length = 0; renderTimeline(); store.reset(); $("bundle-output").textContent = ""; });
}
// The bundle is shown whether or not the clipboard write is permitted: a denied
// clipboard must not leave a stale verification result on screen.
$("copy-bundle").addEventListener("click", async () => { const serialized = JSON.stringify(makeBundle(store.state.site, store.state.destination, store.state.comparison), null, 2); $("bundle-output").textContent = serialized; try { if (navigator.clipboard) await navigator.clipboard.writeText(serialized); } catch (error) { log("ERROR", "copy-bundle", error?.message || String(error)); } });
$("download-bundle").addEventListener("click", () => { if (!store.state.site) { $("bundle-output").textContent = "No evidence bundle yet. Run the demo first."; return; } const serialized = JSON.stringify(makeBundle(store.state.site, store.state.destination, store.state.comparison), null, 2); const url = URL.createObjectURL(new Blob([serialized], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "ai-evidence-in-action-bundle.json"; link.click(); URL.revokeObjectURL(url); });
$("verify-bundle").addEventListener("click", async () => { if (!store.state.site) { $("bundle-output").textContent = "No evidence bundle yet. Run the demo first."; return; } const result = await store.verify({ claim_id: store.state.site.claim_id }); $("bundle-output").textContent = JSON.stringify(result, null, 2); });
try { const registration = await registerWebMcpTools(store, log); if (registration.supported) $("agent-status").textContent = "Agent surface: ready"; else { $("agent-status").textContent = "Agent surface: unavailable"; $("unsupported").hidden = false; } } catch (error) { $("agent-status").textContent = "Agent surface: registration error"; $("unsupported").hidden = false; log("ERROR", "registration", error?.message || String(error)); }
