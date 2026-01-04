// ui/js/models.js
import { state, resetOutputTokenEstimate } from "./state.js";

/** Активные модели: всё, что НЕ active === false */
function getActiveModels() {
  const all = Array.isArray(state.settings?.models) ? state.settings.models : [];
  return all.filter(m => m && m.providerId && m.modelId && m.active !== false);
}

async function restoreChosenId(models) {
  // сперва из state
  if (state.chosenModel && models.some(m => m.id === state.chosenModel)) {
    return state.chosenModel;
  }
  // затем из chrome.storage.local.ui
  try {
    const res = await new Promise(resolve =>
      chrome.storage.local.get(["ui"], r => resolve(r || {}))
    );
    const saved = res?.ui?.chosenModel;
    if (saved && models.some(m => m.id === saved)) return saved;
  } catch {}
  // по умолчанию — первая
  return models[0]?.id || "";
}

export async function populateModels() {
  const sel = document.getElementById("modelSelect");
  if (!sel) return;

  sel.innerHTML = "";
  sel.disabled = true;

  const models = getActiveModels();
  const providers = Array.isArray(state.settings?.providers) ? state.settings.providers : [];

  if (!models.length) {
    const opt = new Option("No models configured", "", false, false);
    opt.disabled = true;
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }

  for (const m of models) {
    const prov = providers.find(p => p.id === m.providerId);
    const label =
      (m.displayName && m.displayName.trim()) ||
      (m.modelId && m.modelId.trim()) ||
      "(unnamed)";
    const text = prov ? `${label} — ${prov.name}` : label;
    sel.appendChild(new Option(text, m.id));
  }

  const chosen = await restoreChosenId(models);
  if (chosen) sel.value = chosen;
  state.chosenModel = sel.value || models[0].id;
  sel.disabled = false;

  // страховка: если почему-то опций нет, добавим хотя бы одну
  if (!sel.options.length && models[0]) {
    sel.appendChild(new Option(models[0].displayName || models[0].modelId || "model", models[0].id));
    sel.value = models[0].id;
    state.chosenModel = models[0].id;
  }
}

export function wireModelSelector() {
  const sel = document.getElementById("modelSelect");
  if (!sel) return;
  sel.addEventListener("change", () => {
    state.chosenModel = sel.value;
    try {
      chrome.storage.local.get(["ui"], (r) => {
        const ui = Object.assign({}, r?.ui || {}, { chosenModel: sel.value });
        chrome.storage.local.set({ ui }, () => {});
      });
    } catch {}
    resetOutputTokenEstimate();
  });
}
