import { createStore, registerWebMcpTools } from "./webmcp-tools.js";
import { makeBundle } from "./evidence.js";

const $ = (id) => document.getElementById(id);
const timeline = [];
function log(kind, tool, result) { timeline.push({ at: new Date().toLocaleTimeString(), kind, tool, result }); renderTimeline(); }
function renderTimeline() { $("timeline").replaceChildren(...timeline.map((row) => { const li = document.createElement("li"); li.textContent = `${row.at} · ${row.kind} · ${row.tool} · ${row.result}`; return li; })); }
function signatureText(record) { if (!record) return "No signed record yet"; if (record.integrity?.status === "SIGNED") return `SIGNED · ${record.integrity.key_id}`; return record.integrity?.status || "NOT SIGNED"; }

function render(state) {
  $("site-status").textContent = state.site?.statement || "NO CLAIM";
  $("site-detail").textContent = state.site ? "This is what the web application reported. It is a signed claim, not proof of an external outcome." : "No refund claim has been recorded yet.";
  $("site-integrity").textContent = signatureText(state.site);
  const destinationStatus = state.destination?.statement || (state.destinationUnavailable ? "DESTINATION_UNAVAILABLE" : "NOT CHECKED");
  $("destination-status").textContent = destinationStatus;
  $("destination-detail").textContent = state.destination ? "The simulated destination returned a signed record reporting no matching action." : state.destinationUnavailable ? "The simulated destination did not return evidence. No failure outcome is inferred." : "No destination evidence has been fetched yet.";
  $("destination-integrity").textContent = signatureText(state.destination);
  $("verdict").textContent = (state.comparison?.verdict || "INSUFFICIENT_EVIDENCE").replaceAll("_", " ");
  $("verdict-detail").textContent = state.comparison?.verdict === "DISAGREEMENT" ? "The two available signed records do not tell the same story." : state.comparison?.verdict === "AGREEMENT" ? "The two available sources agree on the compared fields." : state.destinationUnavailable ? "The comparison source is unavailable. Missing evidence is not treated as failure." : "One source is missing. AI Evidence in Action will not guess.";
  document.querySelector(".comparison-card").classList.toggle("disagreement", state.comparison?.verdict === "DISAGREEMENT");
  $("diff").replaceChildren(...(state.comparison?.diff || []).map((row) => { const div = document.createElement("div"); div.className = "diff-row"; for (const value of [row.field, String(row.site_value), String(row.destination_value)]) { const span = document.createElement("span"); span.textContent = value; div.append(span); } return div; }));
  const established = [];
  if (state.site) established.push("The site declared success for the synthetic refund request and signed that declaration with its demo key.");
  if (state.destination) established.push("The simulated destination returned a signed ACTION_ABSENT record.");
  if (state.comparison?.verdict === "DISAGREEMENT") established.push("The currently held records conflict on the reported outcome.");
  if (state.verification?.overall === "SIGNATURE_VALID") established.push("The current signed records pass hash and Ed25519 signature verification against the published demo keys.");
  $("established").replaceChildren(...(established.length ? established : ["No claim has been recorded yet."]).map((value) => { const li = document.createElement("li"); li.textContent = value; return li; }));
  const notEstablished = ["Whether money actually moved.", "Which source is correct or why the records differ.", "The identity of any real-world party.", "That the simulated sources are organizationally independent.", "Trusted wall-clock time or exactly-once execution outside this demo."];
  $("not-established").replaceChildren(...notEstablished.map((value) => { const li = document.createElement("li"); li.textContent = value; return li; }));
  $("verification-status").textContent = state.verification?.overall || "NOT VERIFIED YET";
}

const store = createStore(render, log); render(store.state);
async function executeRegisteredTool(name, input) {
  if (!document.modelContext?.getTools || !document.modelContext?.executeTool) return null;
  const tools = await document.modelContext.getTools();
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Registered tool ${name} was not discovered.`);
  const raw = await document.modelContext.executeTool(tool, input);
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function runScriptedAgent() {
  $("run-demo").disabled = true;
  try {
    const requestId = `demo-${Date.now()}`;
    const input = { order_id: "ORD-1042", amount_cents: 6400, request_id: requestId };
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
$("copy-bundle").addEventListener("click", async () => { const serialized = JSON.stringify(makeBundle(store.state.site, store.state.destination, store.state.comparison), null, 2); if (navigator.clipboard) await navigator.clipboard.writeText(serialized); $("bundle-output").textContent = serialized; });
$("download-bundle").addEventListener("click", () => { if (!store.state.site) { $("bundle-output").textContent = "No evidence bundle yet. Run the demo first."; return; } const serialized = JSON.stringify(makeBundle(store.state.site, store.state.destination, store.state.comparison), null, 2); const url = URL.createObjectURL(new Blob([serialized], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "ai-evidence-in-action-bundle.json"; link.click(); URL.revokeObjectURL(url); });
$("verify-bundle").addEventListener("click", async () => { if (!store.state.site) { $("bundle-output").textContent = "No evidence bundle yet. Run the demo first."; return; } const result = await store.verify({ claim_id: store.state.site.claim_id }); $("bundle-output").textContent = JSON.stringify(result, null, 2); });
try { const registration = await registerWebMcpTools(store, log); if (registration.supported) $("agent-status").textContent = "Agent surface: ready"; else { $("agent-status").textContent = "Agent surface: unavailable"; $("unsupported").hidden = false; } } catch (error) { $("agent-status").textContent = "Agent surface: registration error"; $("unsupported").hidden = false; log("ERROR", "registration", error?.message || String(error)); }
