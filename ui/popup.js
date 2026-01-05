// popup.js — точка входа
import { state, fetchSettings, getActiveTab, setActiveTab, setJobInput, setResult, setLastMeta, updateTokenEstimate } from "./js/state.js";
import { populateModels, wireModelSelector } from "./js/models.js";
import { populateCvSelect, wireCvSelector } from "./js/cv.js";
import { startSelection, clearSelection, wireCopy, wireSave, wireSaveToNotion, wireAnalyzeButtons, wireJobInputSync, ensureContentScript, detectAndToggleFastStart, updateNotionButtonVisibility } from "./js/actions.js";
import { wireRuntimeMessages, warmLoadCaches } from "./js/messaging.js";
import { loadLocale, applyTranslations, getSavedLang, t } from "./js/i18n.js";

let __jdaInitStarted = false;
const THEME_KEY = "popupTheme";
const THEME_SEQUENCE = ["dark", "system", "light"];
const themeState = {
  preference: "system",
  effective: "light",
  media: null,
  mediaListener: null,
  storageListener: null,
  messageListener: null,
  initPromise: null,
  root: null
};

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

function getPopupRoot() {
  if (themeState.root && document.body.contains(themeState.root)) {
    return themeState.root;
  }
  themeState.root = document.querySelector(".popup") || null;
  return themeState.root;
}

function readStoredThemePreference() {
  return new Promise((resolve) => {
    if (!isExtensionContextValid() || !chrome?.storage?.local) {
      resolve("system");
      return;
    }
    try {
      chrome.storage.local.get({ [THEME_KEY]: "system" }, (res) => {
        resolve(res?.[THEME_KEY] || "system");
      });
    } catch {
      resolve("system");
    }
  });
}

function computeEffectiveTheme(pref) {
  if (pref === "system") {
    return themeState.media?.matches ? "dark" : "light";
  }
  return pref === "dark" ? "dark" : "light";
}

function setPopupThemeClass(effective) {
  document.body.dataset.theme = effective;
  const root = getPopupRoot();
  if (!root) return;
  if (effective === "dark") {
    root.classList.add("theme-dark");
  } else {
    root.classList.remove("theme-dark");
  }
}

function applyThemePreference(preference, { persist = false } = {}) {
  const normalized = THEME_SEQUENCE.includes(preference) ? preference : "system";
  const effective = computeEffectiveTheme(normalized);
  themeState.preference = normalized;
  themeState.effective = effective;
  setPopupThemeClass(effective);
  updateThemeToggleUI();
  if (persist && isExtensionContextValid() && chrome?.storage?.local) {
    try {
      chrome.storage.local.set({ [THEME_KEY]: normalized });
    } catch {}
  }
}

function updateThemeToggleUI() {
  const wrap = document.querySelector(".jda-theme-toggle");
  if (!wrap) return;
  const pref = themeState.preference || "system";
  wrap.querySelectorAll("[data-theme-option]").forEach((btn) => {
    const value = btn.getAttribute("data-theme-option");
    const active = value === pref;
    btn.dataset.active = active ? "true" : "false";
    btn.setAttribute("aria-checked", active ? "true" : "false");
  });
}

function wireSidePanelHeader() {
  const toolbar = document.querySelector(".sidepanel-toolbar");
  if (!toolbar) return;
  const toggle = toolbar.querySelector(".jda-theme-toggle");
  toggle?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-option]");
    if (!btn) return;
    const pref = btn.getAttribute("data-theme-option");
    applyThemePreference(pref, { persist: true });
  });

  toolbar.querySelector("#menu")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const manifest = safeRuntimeGetManifest();
    const optionsPath = (manifest.options_ui && manifest.options_ui.page)
      || manifest.options_page
      || "ui/options.html";
    const url = safeRuntimeGetURL(optionsPath);
    try {
      chrome.runtime.openOptionsPage(() => {
        if (chrome.runtime.lastError) window.open(url, "_blank");
      });
    } catch {
      try { window.open(url, "_blank"); } catch {}
    }
  });

  toolbar.querySelector("#metaOverlay")?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await chrome.runtime.sendMessage({ type: "TOGGLE_META_OVERLAY" });
    } catch {}
  });

  toolbar.querySelector('[data-action="close"]')?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await chrome.runtime.sendMessage({ type: "CLOSE_SIDE_PANEL" });
    } catch {}
  });
}

function initThemeControl() {
  if (themeState.initPromise) return themeState.initPromise;
  const run = async () => {
    themeState.media = window.matchMedia?.("(prefers-color-scheme: dark)") || null;
    if (themeState.media) {
      themeState.mediaListener = () => {
        if (themeState.preference === "system") {
          applyThemePreference("system", { persist: false });
        }
      };
      themeState.media.addEventListener?.("change", themeState.mediaListener);
      themeState.media.addListener?.(themeState.mediaListener);
    }

    if (isExtensionContextValid() && chrome?.storage?.onChanged) {
      themeState.storageListener = (changes, area) => {
        if (area === "local" && changes[THEME_KEY]) {
          const nextPref = changes[THEME_KEY].newValue || "system";
          if (nextPref !== themeState.preference) {
            applyThemePreference(nextPref, { persist: false });
          }
        }
      };
      chrome.storage.onChanged.addListener(themeState.storageListener);
    }

    themeState.messageListener = (event) => {
      const data = event?.data;
      if (!data || data.source !== "JDA_OVERLAY" || data.type !== "JDA_THEME_SYNC") return;
      if (data.preference) {
        applyThemePreference(data.preference, { persist: false });
      } else if (data.theme) {
        applyThemePreference(data.theme === "dark" ? "dark" : "light", { persist: false });
      }
    };
    window.addEventListener("message", themeState.messageListener);

    const stored = await readStoredThemePreference();
    applyThemePreference(stored, { persist: false });
  };
  themeState.initPromise = run().catch((err) => {
    console.debug("[POPUP] theme init failed:", err);
  }).finally(() => {
    themeState.initPromise = null;
  });
  return themeState.initPromise;
}

function cleanupThemeControl() {
  if (themeState.media && themeState.mediaListener) {
    themeState.media.removeEventListener?.("change", themeState.mediaListener);
    themeState.media.removeListener?.(themeState.mediaListener);
  }
  themeState.media = null;
  themeState.mediaListener = null;
  if (themeState.storageListener && isExtensionContextValid() && chrome?.storage?.onChanged) {
    try {
      chrome.storage.onChanged.removeListener(themeState.storageListener);
    } catch {}
  }
  themeState.storageListener = null;
  if (themeState.messageListener) {
    window.removeEventListener("message", themeState.messageListener);
  }
  themeState.messageListener = null;
  themeState.root = null;
}

function isSupportedUrl(url) {
  return !!(url && (url.startsWith("http://") || url.startsWith("https://")));
}

function showUnsupportedWarning() {
  const panel = document.getElementById("unsupportedPanel");
  const body = document.querySelector(".body-analyzer");
  const content = document.querySelector(".popup-content");
  if (panel) {
    panel.classList.add("is-visible");
    panel.hidden = false;
  }
  if (body) {
    body.hidden = true;
  }
  if (content) {
    content.hidden = true;
  }
}

function hideUnsupportedWarning() {
  const panel = document.getElementById("unsupportedPanel");
  const body = document.querySelector(".body-analyzer");
  const content = document.querySelector(".popup-content");
  if (panel) {
    panel.classList.remove("is-visible");
    panel.hidden = true;
  }
  if (body) {
    body.hidden = false;
  }
  if (content) {
    content.hidden = false;
  }
}

let __lastSupported = true;
async function updateSupportedState(tab) {
  const url = tab?.url || tab?.pendingUrl || '';
  const supported = isSupportedUrl(url);
  if (supported === __lastSupported) return;
  __lastSupported = supported;
  if (!supported) {
    showUnsupportedWarning();
  } else {
    hideUnsupportedWarning();
    setResult(state.lastResponse || "");
    await detectAndToggleFastStart();
  }
}

function wireUI() {
  const menu = document.getElementById("menu");
  const unsupportedSettings = document.getElementById("unsupportedSettings");
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
  if (unsupportedSettings) {
    unsupportedSettings.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu?.click();
    });
  }

  document.getElementById("refreshView")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.location.reload();
  });

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
  await initThemeControl();
  const params = new URLSearchParams(window.location.search || '');
  const isSidePanel = params.get('context') === 'sidepanel';
  if (isSidePanel) {
    document.body.dataset.context = 'sidepanel';
    const toolbar = document.querySelector(".sidepanel-toolbar");
    if (toolbar) toolbar.hidden = false;
    wireSidePanelHeader();
  }
  const tab = await getActiveTab();
  setActiveTab(tab);
  console.debug("[POPUP] active tab =", tab?.url);

  wireUI();
  // ensure footer buttons match current result state
  setResult(state.lastResponse || "");
  if (!state.settings) {
    state.settings = await fetchSettings();
  }
  updateNotionButtonVisibility();
  console.debug("[POPUP] settings loaded", state.settings);
  populateModels();
  populateCvSelect();
  warmLoadCaches();
  updateTokenEstimate();

  __lastSupported = isSupportedUrl(tab?.url || tab?.pendingUrl || '');
  if (!__lastSupported) {
    showUnsupportedWarning();
  } else {
    hideUnsupportedWarning();
  }

  await detectAndToggleFastStart();

  console.debug("[POPUP] init done");
}



document.addEventListener("DOMContentLoaded", init);
if (document.readyState !== 'loading') {
  setTimeout(() => init(), 0);
}
window.addEventListener("beforeunload", cleanupThemeControl);

if (chrome?.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener(async () => {
    try {
      const tab = await getActiveTab({ refresh: true });
      setActiveTab(tab);
      await updateSupportedState(tab);
    } catch {}
  });
}
if (chrome?.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo || (!changeInfo.url && changeInfo.status !== 'complete')) return;
    if (state.activeTab?.id && tabId !== state.activeTab.id) return;
    updateSupportedState(tab);
  });
}
