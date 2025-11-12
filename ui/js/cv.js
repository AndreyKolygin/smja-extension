// ui/js/cv.js — manage CV selector in popup
import { state } from "./state.js";
import { t } from "./i18n.js";

let storageSyncReady = false;

function getCvList() {
  return Array.isArray(state.settings?.cvs) ? state.settings.cvs : [];
}

function ensureStorageSync() {
  if (storageSyncReady || !chrome?.storage?.onChanged) return;
  storageSyncReady = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.ui) {
      const nextId = changes.ui.newValue?.chosenCvId || null;
      if (nextId && nextId !== state.chosenCvId) {
        state.chosenCvId = nextId;
        syncSelectValue(nextId);
      }
    }
    if (changes.settings?.newValue) {
      state.settings = changes.settings.newValue;
      populateCvSelect();
    }
  });
}

function persistChosenCv(id) {
  if (!chrome?.storage?.local) return;
  try {
    chrome.storage.local.get(["ui"], (res) => {
      const ui = Object.assign({}, res?.ui || {}, { chosenCvId: id || null });
      chrome.storage.local.set({ ui }, () => {});
    });
  } catch {}
}

async function restoreChosenId(cvs) {
  if (state.chosenCvId && cvs.some(cv => cv.id === state.chosenCvId)) {
    return state.chosenCvId;
  }
  try {
    const res = await new Promise(resolve => chrome.storage.local.get(["ui"], r => resolve(r || {})));
    const saved = res?.ui?.chosenCvId;
    if (saved && cvs.some(cv => cv.id === saved)) return saved;
  } catch {}
  if (state.settings?.activeCvId && cvs.some(cv => cv.id === state.settings.activeCvId)) {
    return state.settings.activeCvId;
  }
  return cvs[0]?.id || "";
}

export async function populateCvSelect() {
  const sel = document.getElementById("cvSelect");
  if (!sel) return;
  sel.innerHTML = "";
  sel.disabled = true;

  const cvs = getCvList();
  if (!cvs.length) {
    const opt = new Option(t('ui.popup.cvMissing', 'Add a resume in Settings'), "", false, false);
    opt.disabled = true;
    sel.appendChild(opt);
    return;
  }

  cvs.forEach(cv => {
    const label = cv.title?.trim() || t('ui.popup.cvUntitled', 'Untitled CV');
    sel.appendChild(new Option(label, cv.id));
  });

  const chosen = await restoreChosenId(cvs);
  if (chosen && cvs.some(cv => cv.id === chosen)) {
    sel.value = chosen;
  } else if (sel.options.length) {
    sel.selectedIndex = 0;
  }
  state.chosenCvId = sel.value || cvs[0].id;
  sel.disabled = false;
  ensureStorageSync();
}

export function wireCvSelector() {
  const sel = document.getElementById("cvSelect");
  if (!sel) return;
  ensureStorageSync();
  sel.addEventListener("change", () => {
    state.chosenCvId = sel.value;
    persistChosenCv(sel.value);
  });
}

function syncSelectValue(id) {
  const sel = document.getElementById("cvSelect");
  if (!sel || !id) return;
  const exists = Array.from(sel.options || []).some(opt => opt.value === id);
  if (exists) sel.value = id;
}
