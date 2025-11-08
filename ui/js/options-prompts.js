// ui/js/options-prompts.js
import { $id, persistSettings } from './options-util.js';
import { applyTranslations, t } from './i18n.js';

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
  host.textContent = message || t('options.prompts.cacheNotice', 'Cache cleared.');
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
  function markChanged() {
    if (btn) btn.disabled = false;
    if (hint) hint.textContent = t('options.prompts.changed', 'Prompts changed since last save.');
  }
  sys.addEventListener("input", markChanged);
  out.addEventListener("input", markChanged);
  cv?.addEventListener('input', markChanged);

  btn?.addEventListener("click", async () => {
    console.debug('[JDA options] Reset cache clicked');
    btn.disabled = true;
    if (hint) hint.textContent = t('options.prompts.resetDone', 'Prompt cache reset.');

    const KEYS = ['lastResult', 'lastError', 'lastSelection', 'lastExport'];
    let removedList = [];
    try {
      const before = await storageGet(KEYS);
      await safeRemoveLocal(KEYS);
      removedList = KEYS.filter(k => typeof before[k] !== 'undefined');
    } catch {}

    const message = removedList.length
      ? t('options.prompts.cacheRemoved', 'Cache cleared: {{items}}.').replace('{{items}}', removedList.join(', '))
      : t('options.prompts.cacheNone', 'Cache cleared: nothing to remove.');
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
  const cv = document.getElementById('cv');
  const sys = document.getElementById('systemTemplate');
  const out = document.getElementById('outputTemplate');

  const queuePersist = () => {
    if (__autosaveTimer) clearTimeout(__autosaveTimer);
    __autosaveTimer = setTimeout(() => {
      __autosaveTimer = null;
      persistSettings(settings);
    }, 500);
  };

  if (cv) {
    const update = () => {
      const val = (cv.value || '').trim();
      if (val) settings.cv = val;
      queuePersist();
    };
    cv.addEventListener('input', update);
    cv.addEventListener('blur', update);
  }

  if (sys) {
    const update = () => {
      settings.systemTemplate = sys.value;
      queuePersist();
    };
    sys.addEventListener('input', update);
    sys.addEventListener('blur', update);
  }

  if (out) {
    const update = () => {
      settings.outputTemplate = out.value;
      queuePersist();
    };
    out.addEventListener('input', update);
    out.addEventListener('blur', update);
  }
}

export function injectSingleColumnLayout() {
  try { document.body.classList.add('single-column'); } catch {}
}
export function renameGeneralToCV() {
  const title = document.querySelector('.card_general h2');
  if (title) title.setAttribute('data-i18n', 'options.title.general');
}

async function safeRemoveLocal(keys){
  return new Promise((resolve) => {
    try {
      if (!chrome?.storage?.local?.remove) return resolve();
      chrome.storage.local.remove(keys, () => resolve());
    } catch { resolve(); }
  });
}
