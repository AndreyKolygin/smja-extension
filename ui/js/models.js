// models.js — список моделей и сохранение выбора
import { state } from "./state.js";

export function populateModels() {
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

  const savedId = state.settings?.ui?.chosenModel;
  if (savedId && models.some(m => m.id === savedId)) {
    sel.value = savedId; state.chosenModel = savedId;
  } else if (models.length) {
    sel.value = models[0].id; state.chosenModel = models[0].id;
    // автосохранение выбора
    state.settings.ui = state.settings.ui || {};
    state.settings.ui.chosenModel = state.chosenModel;
    chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload: state.settings }).catch(()=>{});
  }
}

export function wireModelSelector() {
  document.getElementById("modelSelect")?.addEventListener("change", async (e) => {
    state.chosenModel = e.target.value;
    if (state.settings) {
      state.settings.ui = state.settings.ui || {};
      state.settings.ui.chosenModel = state.chosenModel;
      try { await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload: state.settings }); } catch {}
    }
  });
}
