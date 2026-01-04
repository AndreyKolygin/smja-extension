// messaging.js — сообщения из content/select.js
import { state, setResult, stopTimer, setJobInput, setLastMeta, setTemplateMeta, setCachedBadge, setOutputTokenEstimateFromText, resetOutputTokenEstimate, updateTokenEstimate } from "./state.js";

export function wireRuntimeMessages() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "LLM_RESULT") {
      state.lastResponse = msg.text || "";
      setResult(state.lastResponse);          // рисуем в resultView
      setCachedBadge(!!msg.cached);
      setOutputTokenEstimateFromText(state.lastResponse);
      try { setLastMeta(Date.now()); } catch {}
      const elapsed = Math.max(0, performance.now() - state.timerStart);
      stopTimer(true, elapsed);
    }

    // ЕДИНСТВЕННЫЙ обработчик текста выделения
    if (msg?.type === "SELECTION_RESULT" || msg?.type === "SELECTION_ANALYZE") {
      const txt = msg.text || "";
      state.selectedText = txt;
      setJobInput(txt);
      setTemplateMeta([]);
      try { chrome.storage.local.set({ lastSelection: txt }); } catch {}
    }
  });
}

// Прогрев кэшей при открытии попапа — одна функция
export function warmLoadCaches() {
  chrome.storage.local.get(["lastResult", "lastSelection"], (res) => {
    const lr = res?.lastResult;
    if (lr?.text) {
      state.lastResponse = lr.text;
      setResult(lr.text);                 // отрисовать из кэша
      setCachedBadge(!!lr.cached);
      setOutputTokenEstimateFromText(lr.text);
      try { setLastMeta(lr.when); } catch {}
    } else {
      resetOutputTokenEstimate();
    }
    setTemplateMeta([]);
    const sel = res?.lastSelection;
    if (sel) {
      state.selectedText = sel;
      setJobInput(sel);
    }
    updateTokenEstimate();
  });
}
