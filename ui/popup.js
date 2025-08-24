// popup.js — точка входа
import { state, fetchSettings } from "./js/state.js";
import { populateModels, wireModelSelector } from "./js/models.js";
import { startSelection, clearSelection, wireCopy, wireSave, wireAnalyzeButtons, wireJobInputSync } from "./js/actions.js";
import { wireRuntimeMessages, warmLoadCaches } from "./js/messaging.js";

function wireUI() {
  document.getElementById("menu")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
    document.body.innerHTML = `
      <div class="container">
        <div class="header">
          <div class="select hidden" aria-hidden="true"></div>
          <button id="menu" class="menu" title="Settings">☰</button>
        </div>
        <div class="row">
          <p class="muted">
            Content cannot be analyzed.
          </p>
          <p class="muted">
            Only http and https URLs are supported.
          </p>
        </div>
      </div>
    `;
    // wire only existing controls (wireUI is safe due to optional chaining)
    wireUI();
    return;
  }

  wireUI();
  state.settings = await fetchSettings();
  populateModels();
  warmLoadCaches();
}
document.addEventListener("DOMContentLoaded", init);
