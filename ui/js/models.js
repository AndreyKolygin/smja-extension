// ui/js/models.js
import { state } from "./state.js";

const LAST_MODEL_KEY = "lastModelId";

export async function populateModels() {
  const sel = document.getElementById("modelSelect");
  if (!sel) return;

  sel.innerHTML = "";
  sel.disabled = true;

  const settings = state.settings || {};
  const providers = settings.providers || [];
  const models = (settings.models || []).filter(m => m.active);

  if (!models.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No active models";
    sel.appendChild(opt);
    sel.disabled = true;
    state.chosenModel = null;
    return;
  }

  // восстановить последнюю выбранную
  let lastId = null;
  try {
    const res = await chrome.storage.local.get([LAST_MODEL_KEY]);
    lastId = res?.[LAST_MODEL_KEY] || null;
  } catch {}

  for (const m of models) {
    const prov = providers.find(p => p.id === m.providerId);
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.displayName} — ${prov?.name || "?"}`;
    sel.appendChild(opt);
  }

  // выставить текущее значение
  const exists = models.some(m => m.id === lastId);
  const chosen = exists ? lastId : models[0].id;
  sel.value = chosen;
  sel.disabled = false;

  state.chosenModel = chosen;
  try { chrome.storage.local.set({ [LAST_MODEL_KEY]: chosen }); } catch {}
}

export function wireModelSelector() {
  const sel = document.getElementById("modelSelect");
  if (!sel) return;

  sel.addEventListener("change", (e) => {
    const id = e.target.value || null;
    state.chosenModel = id;
    try { chrome.storage.local.set({ [LAST_MODEL_KEY]: id }); } catch {}
  });
}