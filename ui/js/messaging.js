// messaging.js — сообщения из content/select.js
import { state, setResult, stopTimer, setJobInput, setProgress } from "./state.js";

export function wireRuntimeMessages() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "SELECTION_RESULT") {
      state.selectedText = msg.text;
      setJobInput(state.selectedText);
      const r = document.getElementById("result");
      if (r) r.value = `Selected ${state.selectedText.length} chars. Click Refresh/Analyze to run.`;
    } else if (msg?.type === "SELECTION_ANALYZE") {
      state.selectedText = msg.text;
      setJobInput(state.selectedText);
      const r = document.getElementById("result");
      if (r) r.value = `Selected ${state.selectedText.length} chars. Running analysis...`;
      // Анализ запускается кнопкой Analyze/Refresh; автозапуск оставили в content-кнопке
    } else if (msg?.type === "LLM_RESULT") {
      state.lastResponse = msg.text || "";
      setResult(state.lastResponse);
      const elapsed = Math.max(0, performance.now() - state.timerStart);
      stopTimer(true, elapsed);
    }
  });
}

// прогрев последнего результата/выделения при открытии попапа
export function warmLoadCaches() {
  try {
    chrome.storage.local.get('lastResult', (res) => {
      const lr = res?.lastResult;
      if (!lr) return;
      setResult(lr.text || "");
      if (lr.when) {
        const age = Math.max(0, Date.now() - lr.when);
        setProgress(`Last result • ${(age/1000).toFixed(1)}s ago`);
      }
    });
    chrome.storage.local.get('lastSelection', (res) => {
      const ls = res?.lastSelection;
      if (!ls) return;
      setJobInput(ls);
      state.selectedText = ls;
    });
  } catch {}
}
