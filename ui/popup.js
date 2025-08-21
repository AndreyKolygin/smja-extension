// ui/popup.js — popup UI wiring (MV3)
const SETTINGS_KEY = "jdaSettings";

let state = {
  selectedText: "",
  lastResponse: "",
  timerId: 0,
  timerStart: 0,
  settings: null,
  chosenModel: null
};

function setProgress(text) {
  const el = document.getElementById("progress");
  if (el) el.textContent = text;
}

function startTimer(prefix = "Progress") {
  state.timerStart = performance.now();
  stopTimer();
  state.timerId = setInterval(() => {
    const ms = performance.now() - state.timerStart;
    setProgress(`${prefix}: ${ms.toFixed(0)} ms`);
  }, 100);
}

function stopTimer(done = false, ms = 0) {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = 0;
  if (done) setProgress(`Done: ${(ms / 1000).toFixed(2)}s`);
}

async function fetchSettings() {
  try { return await chrome.runtime.sendMessage({ type: "GET_SETTINGS" }); }
  catch { return null; }
}

function populateModels() {
  const sel = document.getElementById("modelSelect");
  if (!sel || !state?.settings) return;
  sel.innerHTML = "";
  const models = (state.settings.models || []).filter(m => m.active);
  for (const m of models) {
    const prov = state.settings.providers.find(p => p.id === m.providerId);
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.displayName} — ${prov?.name || "?"}`;
    sel.appendChild(opt);
  }
    // выбрать сохранённую модель, если есть
  const savedId = state.settings?.ui?.chosenModel;
  if (savedId && models.some(m => m.id === savedId)) {
    sel.value = savedId;
    state.chosenModel = savedId;
  } else if (models.length) {
    // нет сохранённого выбора — берём первую активную и сразу сохраняем в settings
    sel.value = models[0].id;
    state.chosenModel = models[0].id;
    if (state.settings) {
      state.settings.ui = state.settings.ui || {};
      state.settings.ui.chosenModel = state.chosenModel;
      // без await — не блокируем UI
      chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload: state.settings }).catch(()=>{});
    }
  }
}

function analyzeSelectedText() {
  const resEl = document.getElementById("result");
  if (!state.selectedText) { if (resEl) resEl.value = "Select a job description first."; return; }
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
    stopTimer(true, resp?.ms || 0);
    if (resp?.ok) { state.lastResponse = resp.text; if (resEl) resEl.value = resp.text; }
    else { if (resEl) resEl.value = "Error: " + (resp?.error || "Unknown"); }
  });
}

async function startSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/select.js"] });
  await chrome.tabs.sendMessage(tab.id, { type: "START_SELECTION" });
}

async function clearSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) { try { await chrome.tabs.sendMessage(tab.id, { type: "CLEAR_SELECTION" }); } catch {} }
  state.selectedText = "";
  const r = document.getElementById("result");
  if (r) r.value = "";
  setProgress("Progress: 0 ms");
}

function wireUI() {
  // Burger → options page
  document.getElementById("menu")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById("modelSelect")?.addEventListener("change", async (e) => {
    state.chosenModel = e.target.value;
    if (state.settings) {
      state.settings.ui = state.settings.ui || {};
      state.settings.ui.chosenModel = state.chosenModel;
      try { await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload: state.settings }); } catch {}
    }
  });

  document.getElementById("selectBtn")?.addEventListener("click", startSelection);
  document.getElementById("clearBtn")?.addEventListener("click", clearSelection);
  document.getElementById("refreshBtn")?.addEventListener("click", analyzeSelectedText);

  document.getElementById("copyBtn")?.addEventListener("click", async () => {
    const txt = document.getElementById("result")?.value || "";
    try { await navigator.clipboard.writeText(txt); setProgress("Copied to clipboard"); setTimeout(()=>setProgress(""), 1200);} catch {}
  });

  document.getElementById("saveBtn")?.addEventListener("click", async () => {
    const content = document.getElementById("result")?.value || "";
    try { chrome.storage.local.set({ lastResult: { text: content, when: Date.now(), ms: 0, providerId: null, modelId: null } }, () => {}); } catch {}
    const blob = new Blob([content], { type: "text/markdown" });
    const reader = new FileReader();
    reader.onload = async () => {
      const url = reader.result;
      await chrome.downloads.download({ url, filename: `jda_result_${Date.now()}.md`, saveAs: true });
    };
    reader.readAsDataURL(blob);
  });

  // Messages from content script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "SELECTION_RESULT") {
      state.selectedText = msg.text;
      const r = document.getElementById("result");
      if (r) r.value = `Selected ${state.selectedText.length} chars. Click Refresh to analyze or use the floating button.`;
    } else if (msg?.type === "SELECTION_ANALYZE") {
      state.selectedText = msg.text;
      const r = document.getElementById("result");
      if (r) r.value = `Selected ${state.selectedText.length} chars. Running analysis...`;
      analyzeSelectedText();
    }
    else if (msg?.type === "LLM_RESULT") {
      state.lastResponse = msg.text || "";
      const r = document.getElementById("result");
      if (r) r.value = state.lastResponse;
      stopTimer(true, 0);
    }
  });
}

async function init() {
  wireUI();
  state.settings = await fetchSettings();
  populateModels();
  try {
    chrome.storage.local.get('lastResult', (res) => {
      const lr = res && res.lastResult;
      if (!lr) return;
      const r = document.getElementById('result');
      if (r) r.value = lr.text || '';
      const p = document.getElementById('progress');
      if (p && lr.when) {
        const age = Math.max(0, Date.now() - lr.when);
        p.textContent = `Last result • ${(age/1000).toFixed(1)}s ago`;
      }
    });
  } catch {}
}

document.addEventListener("DOMContentLoaded", init);
