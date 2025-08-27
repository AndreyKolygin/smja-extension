// popup.js — точка входа
import { state, fetchSettings } from "./js/state.js";
import { populateModels, wireModelSelector } from "./js/models.js";
import { startSelection, clearSelection, wireCopy, wireSave, wireAnalyzeButtons, wireJobInputSync, ensureContentScript, detectAndToggleFastStart } from "./js/actions.js";
import { wireRuntimeMessages, warmLoadCaches } from "./js/messaging.js";

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

async function init() {
  console.debug("[POPUP] init()");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.debug("[POPUP] active tab =", tab?.url);

  if (!tab?.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
    document.body.innerHTML = `
      <div class="container">
        <div class="header">
          <div class="select hidden" aria-hidden="true"></div>
          <button id="menu" class="menu" title="Settings">☰</button>
        </div>
        <div class="row">
          <p class="muted">Content cannot be analyzed.</p>
          <p class="muted">Only http and https URLs are supported.</p>
        </div>
      </div>
    `;
    wireUI();
    return;
  }

 wireUI();
  state.settings = await fetchSettings();
  console.debug("[POPUP] settings loaded", state.settings);
  populateModels();
  warmLoadCaches();

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
