// ui/js/options-main.js
import {
  $id, safeShowModal, maskKey,
  normalizeSettings, persistSettings, ensureHostPermission,
  SETTINGS_KEY
} from './options-util.js';

import { wireImportExport } from './options-io.js';
import { renderProviders, wireProviderModals } from './options-providers.js';
import { renderModels, wireModelModals } from './options-models.js';
import { renderSites, wireSitesModals } from './options-sites.js';
import { initPrompts, setupAutosave, renameGeneralToCV, injectSingleColumnLayout } from './options-prompts.js';

import { loadLocale, applyTranslations, getSavedLang, setSavedLang } from './i18n.js';

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
    settings = normalizeSettings(raw);
  } catch {
    settings = normalizeSettings(null);
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
  if (helpLink) helpLink.href = settings.general?.helpUrl || "https://github.com/andreykolygin/smja-extension";

  // Промпты
  initPrompts(settings);

  // Таблицы
  renderProviders(settings);
  renderModels(settings);
  renderSites(settings);
  applyTranslations(document);

  // Провода
  wireProviderModals(settings);
  wireModelModals(settings);
  wireSitesModals(settings);
  wireImportExport(settings);

  // UI-хелперы
  injectSingleColumnLayout();
  renameGeneralToCV();
  setupAutosave(settings);

  // Save кнопка (общая)
  $id("saveBtn").addEventListener("click", async () => {
    settings.cv = $id("cv").value;
    settings.systemTemplate = $id("systemTemplate").value;
    settings.outputTemplate = $id("outputTemplate").value;
    await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload: settings });
    alert("Saved.");
    const btn = $id("resetCacheBtn");
    const hint = $id("resetHint");
    if (btn) btn.disabled = true;
    if (hint) {
      hint.textContent = "Cache cleared: prompts and temporary results were removed.";
      hint.style.color = "green";
      setTimeout(() => {
        hint.textContent = "";
        hint.style.color = "";
      }, 4000);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    try {
      await initI18n();     // 1) init language & apply translations
      await loadSettings(); // 2) then build the rest of the page
    } catch (e) {
      console.error('[JDA options] init failed:', e);
      alert('Settings UI failed to initialize. See DevTools console for details.');
    }
  })();
});
