// popup.js — точка входа
import { state, fetchSettings, getActiveTab, setActiveTab, setJobInput, setResult, setLastMeta } from "./js/state.js";
import { populateModels, wireModelSelector } from "./js/models.js";
import { startSelection, clearSelection, wireCopy, wireSave, wireAnalyzeButtons, wireJobInputSync, ensureContentScript, detectAndToggleFastStart } from "./js/actions.js";
import { wireRuntimeMessages, warmLoadCaches } from "./js/messaging.js";
import { loadLocale, applyTranslations, getSavedLang } from "./js/i18n.js";

let __jdaInitStarted = false;

function wireUI() {
  const menu = document.getElementById("menu");
  if (menu) {
    menu.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const manifest = chrome.runtime.getManifest?.() || {};
      const optionsPath = (manifest.options_ui && manifest.options_ui.page)
        || manifest.options_page
        || "ui/options.html"; // safe default
      const url = chrome.runtime.getURL(optionsPath);

      let fallbackTimer = null;
      const openFallback = () => {
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        try { window.open(url, "_blank"); } catch {}
      };

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
  wireAnalyzeButtons();
  wireCopy();
  wireSave();
  wireJobInputSync();
  wireRuntimeMessages();
}

async function hydrateFromStorage() {
  const { lastSelection, lastResult } = await chrome.storage.local.get(["lastSelection", "lastResult"]);
  try {
    if (lastSelection) {
      // support either setter name used by app
      window?.app?.setJobText?.(lastSelection);
      window?.app?.setJobInput?.(lastSelection);
    }
    if (lastResult?.text) {
      // support either renderer name used by app
      window?.app?.setAnalysisResult?.(lastResult);
      window?.app?.renderAnalysis?.(lastResult);
    }
  } catch (e) {
    console.debug("[UI] hydrateFromStorage error:", e);
  }
}

// первичная загрузка при открытии popup/overlay
document.addEventListener("DOMContentLoaded", () => {
  hydrateFromStorage();
});
if (document.readyState !== 'loading') {
  setTimeout(() => hydrateFromStorage(), 0);
}

// лайв-синхронизация: когда SW кладёт новый результат
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.lastSelection || changes.lastResult) {
    hydrateFromStorage();
  }
});

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
  let tab = null;
  let initialCache = null;

  // no overlay context bootstrap

  if (!tab) {
    tab = await getActiveTab();
    setActiveTab(tab);
  }
  console.debug("[POPUP] active tab =", tab?.url);

  if (!tab?.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
    document.body.innerHTML = `
      <div class="container">
        <div class="header">
          <div class="select hidden" aria-hidden="true"></div>
          <button id="menu" data-i18n="ui.menu.options" class="menu" title="Settings" data-i18n-title="ui.menu.optionsMenu" >☰</button>
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
  console.debug("[POPUP] settings loaded", state.settings);
  populateModels();
  if (initialCache) {
    try {
      const { lastSelection, lastResult } = initialCache;
      if (lastSelection) {
        state.selectedText = lastSelection;
        setJobInput(lastSelection);
        try { chrome.storage.local.set({ lastSelection }); } catch {}
      }
      if (lastResult?.text) {
        state.lastResponse = lastResult.text;
        setResult(lastResult.text);
        try { setLastMeta(lastResult.when); } catch {}
      }
    } catch (e) {
      console.debug('[POPUP] hydrate from context failed:', e);
      warmLoadCaches();
    }
  } else {
    warmLoadCaches();
  }

  // Диагностический статус для Fast Start (создаём до вызова)
  let fs = document.getElementById("fastStartStatus");
  if (!fs) {
    const row = document.createElement("div");
    row.className = "row";
    fs = document.createElement("div");
    fs.id = "fastStartStatus";
    fs.className = "muted"; // стиль из common.css/popup.css
    row.appendChild(fs);
    document.querySelector(".container")?.appendChild(row);
  }
  fs.textContent = "Fast start: checking…";

  await detectAndToggleFastStart({
    onDebug: (...args) => console.debug("[FastStart]", ...args),
    onStatus: (text) => {
      const el = document.getElementById("fastStartStatus");
      if (el) el.textContent = `Fast start: ${text}`;
    }
  });

  console.debug("[POPUP] init done");
}



document.addEventListener("DOMContentLoaded", init);
if (document.readyState !== 'loading') {
  setTimeout(() => init(), 0);
}
