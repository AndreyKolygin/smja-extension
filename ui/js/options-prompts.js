// ui/js/options-prompts.js
import { $id, persistSettings } from './options-util.js';
import { applyTranslations } from './i18n.js';

let __autosaveTimer = null;

// ——— helpers for cache notice & storage ———
function ensureNoticeHost() {
  let host = document.getElementById('cacheNotice');
  if (!host) {
    host = document.createElement('div');
    host.id = 'cacheNotice';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.className = 'notice success muted';
    const hint = document.getElementById('resetHint');
    if (hint && hint.parentNode) {
      hint.parentNode.insertBefore(host, hint.nextSibling);
    } else {
      document.body.appendChild(host);
    }
  }
  return host;
}

function showCacheNotice(message){
  const host = ensureNoticeHost();
  host.textContent = message || 'Cache cleared.';
  host.hidden = false;
  clearTimeout(showCacheNotice.__tid);
  showCacheNotice.__tid = setTimeout(() => { host.hidden = true; }, 4000);
}

function storageGet(keys){
  return new Promise((resolve) => {
    try {
      if (!chrome?.storage?.local?.get) return resolve({});
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
    } catch {
      resolve({});
    }
  });
}

export function initPrompts(settings){
  $id("cv").value = settings.cv || "";
  $id("systemTemplate").value = settings.systemTemplate || "";
  $id("outputTemplate").value = settings.outputTemplate || "";

  applyTranslations(document);

  const sys = $id("systemTemplate"), out = $id("outputTemplate"), btn = $id("resetCacheBtn"), hint = $id("resetHint"), cv = $id("cv");
  // ensure Clear Cache is clickable regardless of initial HTML attribute
  if (btn) {
    btn.disabled = false;           // override any static disabled
    btn.removeAttribute('disabled');
  }
  function markChanged() { if (btn) btn.disabled = false; if (hint) hint.textContent = "Prompts changed since last save."; }
  sys.addEventListener("input", markChanged); out.addEventListener("input", markChanged);

  sys.addEventListener("paste", () => { setTimeout(() => { settings.systemTemplate = sys.value; persistSettings(settings); }, 0); });
  sys.addEventListener("blur", () => { settings.systemTemplate = sys.value; persistSettings(settings); });

  if (cv) {
    cv.addEventListener("paste", () => {
      setTimeout(() => {
        const v = (cv.value || "").trim();
        if (v) { settings.cv = v; persistSettings(settings); }
      }, 0);
    });
    cv.addEventListener("blur", () => {
      const v = (cv.value || "").trim();
      if (v) { settings.cv = v; persistSettings(settings); }
    });
  }
  out.addEventListener("paste", () => { setTimeout(() => { settings.outputTemplate = out.value; persistSettings(settings); }, 0); });
  out.addEventListener("blur", () => { settings.outputTemplate = out.value; persistSettings(settings); });

  btn?.addEventListener("click", async () => {
    console.debug('[JDA options] Reset cache clicked');
    btn.disabled = true;
    if (hint) hint.textContent = 'Prompt cache reset.';

    const KEYS = ['lastResult', 'lastError', 'lastSelection', 'lastExport'];
    let removedList = [];
    try {
      const before = await storageGet(KEYS);
      await safeRemoveLocal(KEYS);
      removedList = KEYS.filter(k => typeof before[k] !== 'undefined');
    } catch {}

    const message = removedList.length
      ? `Cache cleared: ${removedList.join(', ')}.`
      : 'Cache cleared: nothing to remove.';
    showCacheNotice(message);
  });

  window.addEventListener('beforeunload', () => {
    if (__autosaveTimer) { clearTimeout(__autosaveTimer); __autosaveTimer = null; }
    settings.systemTemplate = sys.value;
    settings.outputTemplate = out.value;
    if (cv) settings.cv = cv.value;
  });
}

export function setupAutosave(settings){
  function debouncePersist(){
    if (__autosaveTimer) clearTimeout(__autosaveTimer);
    __autosaveTimer = setTimeout(() => { persistSettings(settings); }, 500);
  }

  document.addEventListener('input', (e) => {
    if (e.target && (e.target.closest('#providerModal') || e.target.closest('#modelModal') || e.target.closest('#modelPromptModal'))) return;
    if (e.target && e.target.id === 'cv') {
      const v = (e.target.value || '').trim();
      if (v) settings.cv = v; // do not persist empty CV
    }
    if (e.target && e.target.id === 'systemTemplate') settings.systemTemplate = e.target.value;
    if (e.target && e.target.id === 'outputTemplate') settings.outputTemplate = e.target.value;
    debouncePersist();
  }, true);

  document.addEventListener('change', () => debouncePersist(), true);
}

export function injectSingleColumnLayout() {
  try { document.body.classList.add('single-column'); } catch {}
}
export function renameGeneralToCV() {
  const n = document.querySelector('#generalTitle, #general h2, .general h2, h2');
  if (n && /General/i.test(n.textContent || "")) n.setAttribute('data-i18n', 'your_cv_and_prompts');
}

async function safeRemoveLocal(keys){
  return new Promise((resolve) => {
    try {
      if (!chrome?.storage?.local?.remove) return resolve();
      chrome.storage.local.remove(keys, () => resolve());
    } catch { resolve(); }
  });
}
