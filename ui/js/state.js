// state.js — единое состояние и базовые утилиты
export const SETTINGS_KEY = "settings"; // в SW уже унифицировано на local.settings
export const state = {
  selectedText: "",
  lastResponse: "",
  timerId: 0,
  timerStart: 0,
  settings: null,
  chosenModel: null
};

export function setProgress(text) {
  const el = document.getElementById("progress");
  if (el) el.textContent = text || "";
}

export function startTimer(prefix = "Progress") {
  state.timerStart = performance.now();
  stopTimer();
  state.timerId = setInterval(() => {
    const ms = performance.now() - state.timerStart;
    setProgress(`${prefix}: ${ms.toFixed(0)} ms`);
  }, 100);
}

export function stopTimer(done = false, ms = 0) {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = 0;
  if (done) setProgress(`Done: ${(ms / 1000).toFixed(2)}s`);
}

export async function fetchSettings() {
  try { return await chrome.runtime.sendMessage({ type: "GET_SETTINGS" }); }
  catch { return null; }
}

// утилита для безопасной отрисовки результата
export function setResult(text) {
  const el = document.getElementById("result");
  if (el) el.value = text ?? "";
}
export function setJobInput(text) {
  const el = document.getElementById("jobInput");
  if (el) el.value = text ?? "";
}
