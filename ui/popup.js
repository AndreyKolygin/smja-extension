// popup.js — точка входа
import { state, fetchSettings, getActiveTab, setActiveTab, setJobInput, setResult, setLastMeta } from "./js/state.js";
import { populateModels, wireModelSelector } from "./js/models.js";
import { populateCvSelect, wireCvSelector } from "./js/cv.js";
import { startSelection, clearSelection, wireCopy, wireSave, wireSaveToNotion, wireAnalyzeButtons, wireJobInputSync, ensureContentScript, detectAndToggleFastStart, updateNotionButtonVisibility } from "./js/actions.js";
import { wireRuntimeMessages, warmLoadCaches } from "./js/messaging.js";
import { loadLocale, applyTranslations, getSavedLang, t } from "./js/i18n.js";

let __jdaInitStarted = false;

function isExtensionContextValid() {
  try {
    return !!(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function safeRuntimeGetManifest() {
  if (!isExtensionContextValid()) return {};
  try {
    return chrome.runtime.getManifest?.() || {};
  } catch {
    return {};
  }
}

function safeRuntimeGetURL(path) {
  if (!isExtensionContextValid()) return path;
  try {
    return chrome.runtime.getURL(path);
  } catch {
    return path;
  }
}

function wireUI() {
  const menu = document.getElementById("menu");
  if (menu) {
    menu.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const manifest = safeRuntimeGetManifest();
      const optionsPath = (manifest.options_ui && manifest.options_ui.page)
        || manifest.options_page
        || "ui/options.html"; // safe default
      const url = safeRuntimeGetURL(optionsPath);

      let fallbackTimer = null;
      const openFallback = () => {
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        try { window.open(url, "_blank"); } catch {}
      };

      if (!isExtensionContextValid()) {
        openFallback();
        return;
      }

      try {
        // MV3-safe path; if it fails or not supported, fallback fires
        fallbackTimer = setTimeout(openFallback, 400);
        chrome.runtime.openOptionsPage(() => {
          if (chrome.runtime.lastError) {
            console.debug("[POPUP] openOptionsPage lastError:", chrome.runtime.lastError.message);
            openFallback();
          } else {
            // success → cancel fallback
            if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
          }
        });
      } catch (err) {
        console.debug("[POPUP] openOptionsPage threw:", err);
        openFallback();
      }
    });
  }

  document.getElementById("selectBtn")?.addEventListener("click", startSelection);
  document.getElementById("clearBtn")?.addEventListener("click", clearSelection);
  wireModelSelector();
  wireCvSelector();
  wireAnalyzeButtons();
  wireCopy();
  wireSave();
  wireSaveToNotion();
  wireJobInputSync();
  wireRuntimeMessages();
}

// lightweight i18n bootstrap for the popup
async function initI18nPopup() {
  try {
    const lang = await getSavedLang?.() || "en";
    // load resources and apply translations to current DOM
    const dict = await loadLocale(lang);
    await applyTranslations(dict);
    // No language selector in popup by design; controlled from Options.
    console.debug("[POPUP] i18n applied:", lang);
  } catch (e) {
    console.debug("[POPUP] i18n init skipped/failed:", e && (e.message || e));
  }
}

async function init() {
  if (__jdaInitStarted) return;
  __jdaInitStarted = true;
  console.debug("[POPUP] init()");
  await initI18nPopup();
  const tab = await getActiveTab();
  setActiveTab(tab);
  console.debug("[POPUP] active tab =", tab?.url);

  if (!tab?.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
    document.body.innerHTML = `
      <div class="container">
        <div class="header">
          <div class="select hidden" aria-hidden="true"></div>
          <button id="menu" data-i18n="ui.menu.options" class="menu" title="Settings" data-i18n-attr-title="ui.menu.optionsMenu" >☰</button>
        </div>
        <div class="row">
          <p class="muted" data-i18n="ui.popup.warning">Content cannot be analyzed.</p>
          <p class="muted" data-i18n="ui.popup.warning2">Only http and https URLs are supported.</p>
        </div>
      </div>
    `;
    wireUI();
    return;
  }

  wireUI();
  if (!state.settings) {
    state.settings = await fetchSettings();
  }
  updateNotionButtonVisibility();
  console.debug("[POPUP] settings loaded", state.settings);
  populateModels();
  populateCvSelect();
  warmLoadCaches();

  await detectAndToggleFastStart();

  console.debug("[POPUP] init done");
}



document.addEventListener("DOMContentLoaded", init);
if (document.readyState !== 'loading') {
  setTimeout(() => init(), 0);
}
