// ui/js/options-main.js
import {
  $id, safeShowModal, maskKey,
  getNormalizedSettings, persistSettings
} from './options-util.js';

import { wireImportExport } from './options-io.js';
import { renderProviders, wireProviderModals } from './options-providers.js';
import { renderModels, wireModelModals } from './options-models.js';
import { renderSites, wireSitesModals } from './options-sites.js';
import { initPrompts, setupAutosave, renameGeneralToCV, injectSingleColumnLayout } from './options-prompts.js';
import { initCvManager } from './options-cv.js';
import { renderIntegrations } from './options-integrations.js';

import { loadLocale, applyTranslations, getSavedLang, setSavedLang, t } from './i18n.js';

const TAB_STORAGE_KEY = 'optionsActiveTab';

function initTabs() {
  const tabsRoot = document.getElementById('optionsTabs');
  if (!tabsRoot || tabsRoot.dataset.wired) return;
  tabsRoot.dataset.wired = '1';

  const buttons = Array.from(tabsRoot.querySelectorAll('.tab-button'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  if (!buttons.length || !panels.length) return;

  const panelMap = new Map(panels.map(panel => [panel.dataset.tab, panel]));

  const activate = (tab, { focus = false } = {}) => {
    if (!panelMap.has(tab) && buttons[0]) {
      tab = buttons[0].dataset.tab;
    }
    buttons.forEach(btn => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
      if (isActive) {
        btn.removeAttribute('tabindex');
        if (focus) {
          setTimeout(() => {
            try { btn.focus({ preventScroll: true }); } catch {}
          }, 0);
        }
      } else {
        btn.setAttribute('tabindex', '-1');
      }
    });
    panels.forEach(panel => {
      const isActive = panel.dataset.tab === tab;
      panel.classList.toggle('active', isActive);
      panel.hidden = !isActive;
      panel.setAttribute('aria-hidden', String(!isActive));
    });
    try { chrome.storage.local.set({ [TAB_STORAGE_KEY]: tab }); } catch {}
  };

  buttons.forEach(btn => {
    btn.addEventListener('click', () => activate(btn.dataset.tab, { focus: true }));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const idx = buttons.indexOf(btn);
      if (idx === -1) return;
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const nextIdx = (idx + dir + buttons.length) % buttons.length;
      const nextBtn = buttons[nextIdx];
      if (nextBtn) activate(nextBtn.dataset.tab, { focus: true });
    });
  });

  try {
    chrome.storage.local.get([TAB_STORAGE_KEY], (res) => {
      const stored = res?.[TAB_STORAGE_KEY];
      if (stored && panelMap.has(stored)) {
        activate(stored);
      } else if (buttons[0]) {
        activate(buttons[0].dataset.tab);
      }
    });
  } catch {
    if (buttons[0]) activate(buttons[0].dataset.tab);
  }
}

async function initI18n() {
  let lang = await getSavedLang();
  try {
    await loadLocale(lang);
  } catch (e) {
    console.warn('[i18n] primary locale failed, fallback to en:', e);
    lang = 'en';
    try { await loadLocale('en'); } catch {}
  }
  applyTranslations(document);

  const sel = document.getElementById('uiLang');
  if (sel) {
    sel.value = lang;
    sel.addEventListener('change', async () => {
      const newLang = sel.value || 'en';
      await setSavedLang(newLang);
      try { await loadLocale(newLang); } catch { /* уже будет en */ }
      applyTranslations(document);
    });
  }
}

export let settings = null;

export async function loadSettings() {
  try {
    const raw = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    settings = getNormalizedSettings(raw);
  } catch {
    settings = getNormalizedSettings(null);
  }
  // Версия/ссылки
  const verEl = document.getElementById("version");
  if (verEl) {
    try {
      const manifest = chrome.runtime.getManifest?.() || {};
      verEl.textContent = manifest.version || "";
    } catch {
      verEl.textContent = "";
    }
  }
  const helpLink = document.getElementById("helpLink");
  if (helpLink) helpLink.href = "https://jda.kolygin.com/";

  // Промпты
  initPrompts(settings);
  initCvManager(settings);

  // Таблицы
  renderProviders(settings);
  renderModels(settings);
  renderSites(settings);
  renderIntegrations(settings);

  // Провода
  wireProviderModals(settings);
  wireModelModals(settings);
  wireSitesModals(settings);
  wireImportExport(settings);
  wireResetDefaults();

  // UI-хелперы
  injectSingleColumnLayout();
  renameGeneralToCV();
  setupAutosave(settings);

  // Save кнопка (общая)
  $id("saveBtn").addEventListener("click", async () => {
    const hasFilledCv = Array.isArray(settings.cvs)
      ? settings.cvs.some(cv => (cv?.content || '').trim())
      : false;
    if (!hasFilledCv) {
      alert(t('options.alert.cvRequired', 'Add at least one resume before saving.'));
      return;
    }
    settings.systemTemplate = $id("systemTemplate").value;
    settings.outputTemplate = $id("outputTemplate").value;
    await persistSettings(settings, { immediate: true });
    alert(t('options.alert.saved', 'Saved.'));
    const btn = $id("resetCacheBtn");
    const hint = $id("resetHint");
    if (btn) btn.disabled = true;
    if (hint) {
      hint.textContent = t('options.alert.cacheCleared', 'Cache cleared: prompts and temporary results were removed.');
      hint.classList.add('hint-success');
      setTimeout(() => {
        hint.textContent = "";
        hint.classList.remove('hint-success');
      }, 4000);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    try {
      initTabs();
      await initI18n();     // 1) init language & apply translations
      await loadSettings(); // 2) then build the rest of the page
      wireExternalLinks();
    } catch (e) {
      console.error('[JDA options] init failed:', e);
      alert(t('options.alert.initFailed', 'Settings UI failed to initialize. See DevTools console for details.'));
    }
  })();
});

function wireResetDefaults(){
  const btn = document.getElementById('resetDefaultsBtn');
  if (!btn) return;
  const dlg = document.getElementById('resetDefaultsModal');
  const keep = document.getElementById('keepApiKeys');
  const doBtn = document.getElementById('doResetDefaultsBtn');
  const cancelBtn = document.getElementById('cancelResetDefaultsBtn');

  btn.addEventListener('click', () => {
    try { if (keep) keep.checked = true; } catch {}
    safeShowModal(dlg);
    try { applyTranslations(dlg); } catch {}
  });

  cancelBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    try { dlg?.close?.(); } catch {}
  });

  doBtn?.addEventListener('click', async (e) => {
    e?.preventDefault?.();
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'RESET_DEFAULTS', payload: { keepApiKeys: !!(keep?.checked ?? true) } });
      if (!resp?.ok) {
        const msg = resp?.error || 'Unknown';
        alert(t('options.alert.resetFailed', 'Reset failed: {{error}}').replace('{{error}}', msg));
        return;
      }
      try { dlg?.close?.(); } catch {}
      await loadSettings();
      alert(t('options.alert.resetSuccess', 'Defaults restored.'));
    } catch (err) {
      const msg = String(err && (err.message || err));
      alert(t('options.alert.resetFailed', 'Reset failed: {{error}}').replace('{{error}}', msg));
    }
  });
}

// UI Mode controls removed (overlay is not supported in this build)

function wireExternalLinks() {
  const nodes = document.querySelectorAll('[data-open-url]');
  nodes.forEach(node => {
    if (node.dataset.openUrlWired === '1') return;
    node.dataset.openUrlWired = '1';
    node.addEventListener('click', (event) => {
      event?.preventDefault?.();
      const url = node.dataset.openUrl;
      if (!url) return;
      try {
        if (chrome?.tabs?.create) {
          chrome.tabs.create({ url });
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      } catch {
        try {
          window.open(url, '_blank', 'noopener,noreferrer');
        } catch {}
      }
    });
  });
}
