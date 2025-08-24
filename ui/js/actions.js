// actions.js — Select/Clear/Analyze/Copy/Save
import { state, setProgress, startTimer, stopTimer, setResult } from "./state.js";

export async function startSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/select.js"] });
  await chrome.tabs.sendMessage(tab.id, { type: "START_SELECTION" });
}

export async function clearSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) { try { await chrome.tabs.sendMessage(tab.id, { type: "CLEAR_SELECTION" }); } catch {} }
  state.selectedText = "";
  const r = document.getElementById("result"); if (r) r.value = "";
  const ji = document.getElementById("jobInput"); if (ji) ji.value = "";
  setProgress("Progress: 0 ms");
  try { chrome.storage.local.remove(["lastResult","lastError","lastSelection"], ()=>{}); } catch {}
  state.lastResponse = "";
}

export function wireCopy() {
  document.getElementById("copyBtn")?.addEventListener("click", async () => {
    const txt = document.getElementById("result")?.value || "";
    try { await navigator.clipboard.writeText(txt); setProgress("Copied to clipboard"); setTimeout(()=>setProgress(""), 1200);} catch {}
  });
}

export function wireSave() {
  document.getElementById("saveBtn")?.addEventListener("click", async () => {
    const content = document.getElementById("result")?.value || "";
    try { chrome.storage.local.set({ lastResult: { text: content, when: Date.now(), ms: 0, providerId: null, modelId: null } }, ()=>{}); } catch {}
    const blob = new Blob([content], { type: "text/markdown" });
    const reader = new FileReader();
    reader.onload = async () => {
      const url = reader.result;
      await chrome.downloads.download({ url, filename: `jda_result_${Date.now()}.md`, saveAs: true });
    };
    reader.readAsDataURL(blob);
  });
}

export function wireAnalyzeButtons() {
  const analyzeSelectedText = () => {
    const jobVal = document.getElementById("jobInput")?.value?.trim() || "";
    if (jobVal) state.selectedText = jobVal;

    const resEl = document.getElementById("result");
    if (!state.selectedText) { if (resEl) resEl.value = "Add a job description (select on page or paste above)"; return; }
    const models = (state.settings?.models || []).filter(m => m.active);
    const selected = models.find(m => m.id === (state.chosenModel || document.getElementById("modelSelect")?.value));
    if (!selected) { if (resEl) resEl.value = "No active model is selected."; return; }

    startTimer("Progress");
    chrome.runtime.sendMessage({
      type: "CALL_LLM",
      payload: {
        modelId: selected.modelId,
        providerId: selected.providerId,
        cv: state.settings.cv || "",
        systemTemplate: state.settings.systemTemplate || "",
        outputTemplate: state.settings.outputTemplate || "",
        modelSystemPrompt: selected.systemPrompt || "",
        text: state.selectedText
      }
    }).then((resp) => {
      const elapsed = Math.max(0, performance.now() - state.timerStart);
      stopTimer(true, (resp && typeof resp.ms === 'number') ? resp.ms : elapsed);
      if (resp?.ok) { state.lastResponse = resp.text; setResult(resp.text); }
      else { setResult("Error: " + (resp?.error || "Unknown")); }
    });
  };

  document.getElementById("refreshBtn")?.addEventListener("click", analyzeSelectedText);
  document.getElementById("analyzeBtn")?.addEventListener("click", analyzeSelectedText);
}

export function wireJobInputSync() {
  document.getElementById("jobInput")?.addEventListener("input", (e) => { state.selectedText = e.target.value; });
}
