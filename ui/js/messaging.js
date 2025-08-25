// messaging.js — сообщения из content/select.js
import { state, setResult, stopTimer, setJobInput, setProgress, setLastMeta } from "./state.js";

export function wireRuntimeMessages() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "LLM_RESULT") {
      state.lastResponse = msg.text || "";
      setResult(state.lastResponse);     // <-- рисуем в resultView
      setLastMeta(Date.now());
      const elapsed = Math.max(0, performance.now() - state.timerStart);
      stopTimer(true, elapsed);
    }
    if (msg?.type === "SELECTION_RESULT") {
      const txt = msg.text || "";
      state.selectedText = txt;
      setJobInput(txt);
    }
  });
}

// прогрев последнего результата/выделения при открытии попапа
export function warmLoadCaches() {
  chrome.storage.local.get(["lastResult"], (res) => {
    const lr = res?.lastResult;
    if (lr?.text) {
      state.lastResponse = lr.text;
      setResult(lr.text);          // <-- рисуем из кэша
      setLastMeta(lr.when);
    }
  });
}
