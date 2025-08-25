// actions.js — Select/Clear/Analyze/Copy/Save
import { state, setProgress, startTimer, stopTimer, setResult, setLastMeta } from "./state.js";

let __anBtnTicker = 0;
let __anBtnStart = 0;

function startAnalyzeButtonTimer() {
  const btn = document.getElementById("analyzeBtn");
  if (!btn) return;
  btn.disabled = true;
  __anBtnStart = performance.now();
  if (__anBtnTicker) clearInterval(__anBtnTicker);
  // мгновенный показ
  btn.textContent = `0.0s…`;
  __anBtnTicker = setInterval(() => {
    const s = (performance.now() - __anBtnStart) / 1000;
    btn.textContent = `${s.toFixed(1)}s…`;
  }, 100);
}

function stopAnalyzeButtonTimer(finalMs, isError = false) {
  const btn = document.getElementById("analyzeBtn");
  if (!btn) return;
  if (__anBtnTicker) clearInterval(__anBtnTicker);
  __anBtnTicker = 0;

  const label = isError ? "Error" : `Done: ${(finalMs / 1000).toFixed(2)}s`;
  btn.textContent = label;
  // вернуть в исходное состояние через 5с
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = "Analyze";
  }, 5000);
}

export async function startSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/select.js"] });
  await chrome.tabs.sendMessage(tab.id, { type: "START_SELECTION" });
}

export async function clearSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) { try { await chrome.tabs.sendMessage(tab.id, { type: "CLEAR_SELECTION" }); } catch {}
  }
  state.selectedText = "";
  const ji = document.getElementById("jobInput"); if (ji) ji.value = "";
  setResult("");
  setLastMeta(null);
  setProgress("Progress: 0 ms");
  try { chrome.storage.local.remove(["lastResult","lastError","lastSelection"], ()=>{}); } catch {}
  state.lastResponse = "";
}

export function wireCopy() {
  document.getElementById("copyBtn")?.addEventListener("click", async () => {
    const txt = state.lastResponse || "";
    try { await navigator.clipboard.writeText(txt); setProgress("Copied to clipboard"); setTimeout(()=>setProgress(""),1200);} catch {}
  });
}

document.getElementById("saveBtn")?.addEventListener("click", async () => {
  const analysis = document.getElementById("resultView")?.innerText || "";
  const jobDesc = document.getElementById("jobInput")?.value?.trim() || "";

  let md = `# Position matching result\n\n`;
  md += analysis ? analysis + "\n\n" : "_(no analysis result)_\n\n";
  if (jobDesc) {
    md += `---\n\n## Original job description\n\n${jobDesc}\n`;
  }

  const blob = new Blob([md], { type: "text/markdown" });
  const reader = new FileReader();
  reader.onload = async () => {
    const url = reader.result;
    await chrome.downloads.download({
      url,
      filename: `jda_result_${Date.now()}.md`,
      saveAs: true
    });
  };
  reader.readAsDataURL(blob);
});


export function wireAnalyzeButtons() {
  const analyzeSelectedText = () => {
    const jobVal = document.getElementById("jobInput")?.value?.trim() || "";
    if (jobVal) state.selectedText = jobVal;

    if (!state.selectedText) {
      setResult("Add a job description (select on page or paste above)");
      return;
    }
    const models = (state.settings?.models || []).filter(m => m.active);
    const selected = models.find(m => m.id === (state.chosenModel || document.getElementById("modelSelect")?.value));
    if (!selected) { setResult("No active model is selected."); return; }

    // сохранить текущий ввод для восстановления
    try { chrome.storage.local.set({ lastSelection: state.selectedText }, ()=>{}); } catch {}

    // таймер в строке Progress + таймер на кнопке
    startTimer("Progress");
    startAnalyzeButtonTimer();

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
      const ms = (resp && typeof resp.ms === "number") ? resp.ms : elapsed;
      stopTimer(true, ms);

      if (resp?.ok) {
        state.lastResponse = resp.text || "";
        setResult(state.lastResponse);
        setLastMeta(Date.now());
        try { chrome.storage.local.set({ lastResult: { text: state.lastResponse, when: Date.now(), ms } }, ()=>{}); } catch {}
        stopAnalyzeButtonTimer(ms, false);
      } else {
        setResult("Error: " + (resp?.error || "Unknown"));
        stopAnalyzeButtonTimer(elapsed || 0, true);
      }
    }).catch(() => {
      const elapsed = Math.max(0, performance.now() - state.timerStart);
      stopTimer(true, elapsed);
      setResult("Error: request failed");
      stopAnalyzeButtonTimer(elapsed || 0, true);
    });
  };

  document.getElementById("refreshBtn")?.addEventListener("click", analyzeSelectedText);
  document.getElementById("analyzeBtn")?.addEventListener("click", analyzeSelectedText);
}

export function wireSave() {
  const btn = document.getElementById("saveBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    // analysis: исходный markdown из состояния (не из HTML)
    const analysisMd = state.lastResponse?.trim() || "";
    // job description: из textarea
    const jobDesc = document.getElementById("jobInput")?.value?.trim() || "";

    // собираем markdown-файл
    let md = `# Position matching result\n\n`;
    md += analysisMd ? analysisMd + "\n\n" : "_(no analysis result)_\n\n";
    if (jobDesc) {
      md += `---\n\n## Original job description\n\n${jobDesc}\n`;
    }

    try {
      // сохраняем также в local кэш (необязательно, но полезно)
      chrome.storage.local.set({ lastExport: { when: Date.now(), size: md.length } }, () => {});
    } catch {}

    const blob = new Blob([md], { type: "text/markdown" });
    const reader = new FileReader();
    reader.onload = async () => {
      const url = reader.result;
      await chrome.downloads.download({
        url,
        filename: `jda_result_${Date.now()}.md`,
        saveAs: true
      });
    };
    reader.readAsDataURL(blob);
  });
}

export function wireJobInputSync() {
  document.getElementById("jobInput")?.addEventListener("input", (e) => {
    state.selectedText = e.target.value;
    try { chrome.storage.local.set({ lastSelection: state.selectedText }, ()=>{}); } catch {}
  });
}
