// options.js — options page logic
const SETTINGS_KEY = "jdaSettings";
let settings = null;
let changedPrompt = false;

function $id(id) { const el = document.getElementById(id); if (!el) throw new Error(`Missing DOM node: #${id}`); return el; }
function safeShowModal(dlg) { if (dlg && typeof dlg.showModal === "function") dlg.showModal(); else dlg?.setAttribute("open", "open"); }
function maskKey(k){ if(!k) return ""; const last = String(k).slice(-6); return `...${last}`; }

async function ensureHostPermission(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const pattern = `${u.protocol}//${u.host}/*`;
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

async function persistSettings(){
  try {
    const clone = { ...settings };
    delete clone.version; // исключаем версию из кеша
    await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload: clone });
  } catch(e){
    console.warn('[JDA] persist failed', e);
  }
}

function normalizeSettings(obj){
  const base = {
    general: { helpUrl: "https://github.com/AndreyKolygin/smja-extension" },
    providers: [],
    models: [],
    cv: "",
    systemTemplate: "",
    outputTemplate: ""
  };
  const s = Object.assign({}, base, obj || {});
  if (!Array.isArray(s.providers)) s.providers = [];
  if (!Array.isArray(s.models)) s.models = [];
  return s;
}

async function exportSettings(){
  try {
    const redacted = JSON.parse(JSON.stringify(settings || {}));
    if (Array.isArray(redacted.providers)) {
      for (const p of redacted.providers) { if (p) p.apiKey = ""; }
    }
    const data = JSON.stringify(redacted, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const r = new FileReader();
    r.onload = async () => {
      await chrome.downloads.download({ url: r.result, filename: `jda_settings_${Date.now()}.json`, saveAs: true });
    };
    r.readAsDataURL(blob);
  } catch(e){ alert('Export failed: ' + (e?.message || e)); }
}

async function importSettingsFromFile(file){
  try {
    const text = await file.text();
    let obj; try { obj = JSON.parse(text); } catch(e){ alert('Invalid JSON file.'); return; }
    const merged = normalizeSettings(obj);
    // Preserve existing API keys if the import leaves them blank
    try {
      const current = settings || { providers: [] };
      if (Array.isArray(merged.providers)) {
        for (const mp of merged.providers) {
          if (!mp) continue;
          if (!mp.apiKey) {
            // match by id first, fallback by (type+baseUrl)
            const found = (current.providers||[]).find(cp => cp.id === mp.id) ||
                          (current.providers||[]).find(cp => cp.type === mp.type && cp.baseUrl === mp.baseUrl);
            if (found && found.apiKey) mp.apiKey = found.apiKey;
          }
        }
      }
    } catch {}
    settings = merged;

    // Перепривязать поля и таблицы
    $id('cv').value = settings.cv || '';
    $id('systemTemplate').value = settings.systemTemplate || '';
    $id('outputTemplate').value = settings.outputTemplate || '';
    renderProviders();
    renderModels();

    await persistSettings();
    alert('Settings imported successfully.');
  } catch(e){
    alert('Import failed: ' + (e?.message || e));
  }
}

function wireSettingsIO(){
  $id('exportSettingsBtn')?.addEventListener('click', exportSettings);
  const fileInput = $id('importSettingsFile');
  $id('importSettingsBtn')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async (e) => {
    const f = e.target?.files?.[0];
    if (!f) return;
    await importSettingsFromFile(f);
    e.target.value = '';
  });
}

let __autosaveTimer = null;
function debouncePersist(){
  if (__autosaveTimer) clearTimeout(__autosaveTimer);
  __autosaveTimer = setTimeout(() => { persistSettings(); }, 500);
}

function setupAutosave(){
  // Any input/change in the options page (but NOT inside modals) triggers persist
  document.addEventListener('input', (e) => {
    if (e.target && (e.target.closest('#providerModal') || e.target.closest('#modelModal') || e.target.closest('#modelPromptModal'))) return; // ignore modal edits
    // Map known fields from page to settings before saving
    if (e.target && e.target.id === 'cv') settings.cv = e.target.value;
    if (e.target && e.target.id === 'systemTemplate') settings.systemTemplate = e.target.value;
    if (e.target && e.target.id === 'outputTemplate') settings.outputTemplate = e.target.value;
    debouncePersist();
  }, true);
  document.addEventListener('change', (e) => {
    if (e.target && (e.target.closest('#providerModal') || e.target.closest('#modelModal'))) return; // ignore modal edits
    // For checkboxes or other controls outside modals we already update in specific handlers; just persist.
    debouncePersist();
  }, true);
}

async function loadSettings() {
  try { settings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" }); } catch { settings = null; }
  if (!settings) { settings = { version: "0.1.0", general: { helpUrl: "https://github.com/AndreyKolygin/smja-extension" }, providers: [], models: [], cv: "", systemTemplate: "", outputTemplate: "" }; }
  const verEl = document.getElementById("version");
  if (verEl) verEl.textContent = "0.1.0"; // версия из кода

  const helpLink = document.getElementById("helpLink");
  if (helpLink) helpLink.href = settings.general?.helpUrl || "https://github.com/AndreyKolygin/smja-extension";
  $id("cv").value = settings.cv || "";
  $id("systemTemplate").value = settings.systemTemplate || "";
  $id("outputTemplate").value = settings.outputTemplate || "";
  settings.providers = Array.isArray(settings.providers) ? settings.providers : [];
  settings.models = Array.isArray(settings.models) ? settings.models : [];
  renderProviders(); renderModels(); initPromptChangeTracking(); wireModals(); wireSave(); wireSettingsIO();
  injectSingleColumnLayout(); renameGeneralToCV();
  setupAutosave();
}

function initPromptChangeTracking() {
  const sys = $id("systemTemplate"), out = $id("outputTemplate"), btn = $id("resetCacheBtn"), hint = $id("resetHint"), cv = $id("cv");
  function markChanged() { changedPrompt = true; btn.disabled = false; hint.textContent = "Prompts changed since last save."; }
  sys.addEventListener("input", markChanged); out.addEventListener("input", markChanged);

  // Immediate persist on paste and blur to avoid debounce loss (e.g., user closes page right after paste)
  sys.addEventListener("paste", () => { setTimeout(() => { settings.systemTemplate = sys.value; persistSettings(); }, 0); });
  sys.addEventListener("blur", () => { settings.systemTemplate = sys.value; persistSettings(); });

  // Also align CV and Output with the same reliability
  if (cv) {
    cv.addEventListener("paste", () => { setTimeout(() => { settings.cv = cv.value; persistSettings(); }, 0); });
    cv.addEventListener("blur", () => { settings.cv = cv.value; persistSettings(); });
  }
  out.addEventListener("paste", () => { setTimeout(() => { settings.outputTemplate = out.value; persistSettings(); }, 0); });
  out.addEventListener("blur", () => { settings.outputTemplate = out.value; persistSettings(); });

  btn.addEventListener("click", () => { changedPrompt = false; btn.disabled = true; hint.textContent = "Prompt cache reset."; });

  // Flush pending debounce before unload
  window.addEventListener('beforeunload', () => {
    if (__autosaveTimer) { clearTimeout(__autosaveTimer); __autosaveTimer = null; }
    // Ensure latest values are in the model before final persist
    settings.systemTemplate = sys.value;
    settings.outputTemplate = out.value;
    if (cv) settings.cv = cv.value;
    persistSettings();
  });
}

function renderProviders() {
  const tbody = document.querySelector("#providersTable tbody"); if (!tbody) return; tbody.innerHTML = "";
  for (const p of settings.providers) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.name ?? ""}</td>
      <td>${p.baseUrl ?? ""}</td>
      <td>${p.type ?? ""}</td>
      <td>${p.apiKey ? maskKey(p.apiKey) : ""}</td>
      <td>
        <button class="btn edit" title="Edit LLM provider settings">Edit</button>
        <button class="btn delete" title="Delete LLM provider">Delete</button>
      </td>`;

    // Edit handler
    tr.querySelector("button.edit")?.addEventListener("click", () => editProvider(p));
    // Delete handler
    tr.querySelector("button.delete")?.addEventListener("click", async () => { settings.providers = settings.providers.filter(x => x !== p); renderProviders(); await persistSettings(); });

    tbody.appendChild(tr);
  }
}

function renderModels() {
  const tbody = document.querySelector("#modelsTable tbody"); if (!tbody) return; tbody.innerHTML = "";
  for (const m of settings.models) {
    const provider = settings.providers.find(p => p.id === m.providerId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" ${m.active ? "checked" : ""}></td>
      <td contenteditable="true">${m.displayName ?? ""}</td>
      <td>${provider?.name || "?"}</td>
      <td contenteditable="true">${m.modelId ?? ""}</td>
      <td>
        <button class="btn edit" title="Edit model and settings">Edit</button>
        <button class="btn edit-prompr" title="Edit system prompt for this model">Edit system prompt</button>
        <button class="btn delete" title="Delete model">Delete</button>
      </td>`;

    tr.querySelector("input")?.addEventListener("change", async (e) => { m.active = e.target.checked; await persistSettings(); });
    tr.children[1]?.addEventListener("input", (e) => m.displayName = e.target.textContent);
    tr.children[1]?.addEventListener("blur", persistSettings);
    tr.children[3]?.addEventListener("input", (e) => m.modelId = e.target.textContent);
    tr.children[3]?.addEventListener("blur", persistSettings);

    tr.querySelector("button.edit")?.addEventListener("click", () => editModel(m));
    tr.querySelectorAll("button")[1]?.addEventListener("click", () => editModelSystemPrompt(m));
    tr.querySelector("button.delete")?.addEventListener("click", async () => {
      settings.models = settings.models.filter(x => x !== m);
      renderModels();
      await persistSettings();
    });

    tbody.appendChild(tr);
  }
}

function editModel(m){
  const dlg = document.getElementById("modelModal");
  const providerSelect = document.getElementById("modelProvider");
  const displayInput = document.getElementById("modelDisplay");
  const idInput = document.getElementById("modelId");

  if (!dlg || !providerSelect || !displayInput || !idInput) {
    // Fallback via prompts
    const displayName = prompt('Display name:', m.displayName || '');
    if (displayName === null) return;
    const modelId = prompt('Model ID:', m.modelId || '');
    if (modelId === null) return;
    let providerName = prompt('Provider (type exact name from list):', (settings.providers.find(p=>p.id===m.providerId)?.name) || (settings.providers[0]?.name || ''));
    const prov = settings.providers.find(p => p.name === providerName) || settings.providers[0];
    if (!prov) { alert('Add a provider first.'); return; }
    m.displayName = displayName.trim();
    m.modelId = modelId.trim();
    m.providerId = prov.id;
    renderModels();
    persistSettings();
    return;
  }

  // Modal path: populate providers, select current
  providerSelect.innerHTML = '';
  for (const p of settings.providers) { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = `${p.name} (${p.type})`; providerSelect.appendChild(opt); }
  providerSelect.value = m.providerId || (settings.providers[0]?.id || '');
  displayInput.value = m.displayName || '';
  idInput.value = m.modelId || '';

  safeShowModal(dlg);

  const saveBtn = document.getElementById('saveModelBtn');
  const old = saveBtn.onclick; // preserve add-model handler
  saveBtn.onclick = () => {
    m.providerId = providerSelect.value;
    m.displayName = displayInput.value.trim();
    m.modelId = idInput.value.trim();
    renderModels();
    persistSettings();
    dlg.close?.();
    saveBtn.onclick = old || null; // restore original
  };
}

function editModelSystemPrompt(m){
  const dlg = document.getElementById('modelPromptModal');
  const textarea = document.getElementById('modelPromptText');
  const saveBtn = document.getElementById('saveModelPromptBtn');
  const cancelBtn = document.getElementById('cancelModelPromptBtn');

  if (!dlg || !textarea || !saveBtn || !cancelBtn){
    // Fallback через prompt(), если нет разметки модалки
    const text = prompt('Edit system prompt for model (leave blank to inherit global):', m.systemPrompt || '');
    if (text !== null){ m.systemPrompt = text; persistSettings(); }
    return;
  }

  textarea.value = m.systemPrompt || '';
  safeShowModal(dlg);

  const oldSave = saveBtn.onclick; 
  const oldCancel = cancelBtn.onclick;

  saveBtn.onclick = () => {
    m.systemPrompt = textarea.value;
    persistSettings();
    dlg.close?.();
    saveBtn.onclick = oldSave || null;
    cancelBtn.onclick = oldCancel || null;
  };
  cancelBtn.onclick = () => {
    dlg.close?.();
    saveBtn.onclick = oldSave || null;
    cancelBtn.onclick = oldCancel || null;
  };
}

function editModelPrompt(model) {
  const text = prompt("Edit system prompt for model (leave blank to inherit global):", model.systemPrompt || "");
  if (text !== null) {
    model.systemPrompt = text;
    persistSettings();
  }
}

function editProvider(p){
  // Try modal editor if markup exists, else fallback to prompts
  const dlg = document.getElementById("providerModal");
  const preset = document.getElementById("providerPreset");
  const base = document.getElementById("providerBaseUrl");
  const key = document.getElementById("providerApiKey");
  const link = document.getElementById("apiKeyLink");

  if (!dlg || !preset || !base || !key || !link){
    // prompt fallback
    const name = prompt("Provider name:", p.name || "");
    if (name === null) return;
    const baseUrl = prompt("Base URL:", p.baseUrl || "");
    if (baseUrl === null) return;
    const apiKey = prompt("API key (leave blank to keep):", "");
    p.name = name.trim();
    p.baseUrl = baseUrl.trim();
    if (apiKey !== null && apiKey !== "") p.apiKey = apiKey.trim();
    renderProviders();
    persistSettings();
    return;
  }

  // If modal exists, prefill it and repurpose the Save button for editing
  // Try to select a matching preset by type if available
  try{
    if (p.type){
      for (let i=0;i<preset.options.length;i++){ if (preset.options[i].value === p.type){ preset.selectedIndex = i; break; } }
    }
  }catch{}

  base.value = p.baseUrl || "";
  key.value = p.apiKey || "";
  // We keep existing link href from preset change; do not override if unknown

  safeShowModal(dlg);

  const saveBtn = document.getElementById("saveProviderBtn");
  const oldOnClick = saveBtn.onclick;
  saveBtn.onclick = async () => {
    p.name = preset.options[preset.selectedIndex]?.text || p.name || "";
    p.type = preset.value || p.type || "custom";
    p.baseUrl = base.value.trim();
    p.apiKey = key.value.trim();
    try {
      const granted = await ensureHostPermission(p.baseUrl);
      if (!granted) console.warn("[JDA] Host permission not granted for", p.baseUrl);
    } catch {}
    renderProviders();
    await persistSettings();
    dlg.close?.();
    // restore previous handler (for Add flow)
    saveBtn.onclick = oldOnClick || null;
  };
}

function wireModals() {
  const addProviderBtn = document.getElementById("addProviderBtn");
  addProviderBtn?.addEventListener("click", () => {
    const dlg = document.getElementById("providerModal");
    const preset = document.getElementById("providerPreset");
    const base = document.getElementById("providerBaseUrl");
    const key = document.getElementById("providerApiKey");
    const link = document.getElementById("apiKeyLink");

    if (!dlg || !preset || !base || !key || !link) { return simplePromptAddProvider(); }

    const presets = {
      custom: { type: "custom", baseUrl: "", url: "#" },
      anthropic: { type: "anthropic", baseUrl: "https://api.anthropic.com/v1", url: "https://console.anthropic.com" },
      azure: { type: "azure", baseUrl: "https://YOUR-RESOURCE-NAME.openai.azure.com", url: "https://portal.azure.com" },
      deepseek: { type: "deepseek", baseUrl: "https://api.deepseek.com/v1", url: "https://platform.deepseek.com" },
      gemini: { type: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", url: "https://aistudio.google.com/app/apikey" },
      huggingface: { type: "huggingface", baseUrl: "https://api-inference.huggingface.co", url: "https://huggingface.co/settings/tokens" },
      meta: { type: "meta", baseUrl: "https://api.meta.ai", url: "https://developers.facebook.com" },
      ollama: { type: "ollama", baseUrl: "http://localhost:11434", url: "https://ollama.com" },
      openai: { type: "openai", baseUrl: "https://api.openai.com/v1", url: "https://platform.openai.com/api-keys" },
      openrouter: { type: "openrouter", baseUrl: "https://openrouter.ai/api/v1", url: "https://openrouter.ai/keys" },
      perplexity: { type: "perplexity", baseUrl: "https://api.perplexity.ai", url: "https://www.perplexity.ai/settings/api" },
      xai: { type: "xai", baseUrl: "https://api.x.ai/v1", url: "https://developer.x.ai/docs/getting-started" }
    };
    function applyPreset() { const p = presets[preset.value]; base.value = p.baseUrl; link.href = p.url; }
    preset.addEventListener("change", applyPreset); applyPreset();
    safeShowModal(dlg);
    document.getElementById("saveProviderBtn").onclick = async () => {
      const id = (preset.value + "_" + Math.random().toString(36).slice(2,8));
      const baseUrl = base.value.trim();
      // request optional host permission for this provider domain
      try {
        const granted = await ensureHostPermission(baseUrl);
        if (!granted) console.warn("[JDA] Host permission not granted for", baseUrl);
      } catch {}

      settings.providers.push({ id, name: preset.options[preset.selectedIndex].text, type: presets[preset.value].type, baseUrl, apiKey: key.value.trim() });
      renderProviders();
      await persistSettings();
      dlg.close?.();
    };
  });

  const addModelBtn = document.getElementById("addModelBtn");
  addModelBtn?.addEventListener("click", () => {
    const dlg = document.getElementById("modelModal");
    const providerSelect = document.getElementById("modelProvider");
    const displayInput = document.getElementById("modelDisplay");
    const idInput = document.getElementById("modelId");
    if (!dlg || !providerSelect || !displayInput || !idInput) { return simplePromptAddModel(); }

    providerSelect.innerHTML = "";
    for (const p of settings.providers) { const opt = document.createElement("option"); opt.value = p.id; opt.textContent = `${p.name} (${p.type})`; providerSelect.appendChild(opt); }
    safeShowModal(dlg);
    document.getElementById("saveModelBtn").onclick = () => {
      const id = "model_" + Math.random().toString(36).slice(2,8);
      const displayName = displayInput.value.trim();
      const modelId = idInput.value.trim();
      const providerId = providerSelect.value;
      settings.models.push({ id, providerId, displayName, modelId, active: true, systemPrompt: "" });
      renderModels();
      persistSettings();
      dlg.close?.();
    };
  });
}

function wireSave() {
  $id("saveBtn").addEventListener("click", async () => {
    settings.cv = $id("cv").value;
    settings.systemTemplate = $id("systemTemplate").value;
    settings.outputTemplate = $id("outputTemplate").value;
    await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload: settings });
    alert("Saved.");
    changedPrompt = false;
    $id("resetCacheBtn").disabled = true;
    $id("resetHint").textContent = "";
  });
}

function injectSingleColumnLayout() {
  try { document.body.classList.add('single-column'); } catch {}
}
function renameGeneralToCV() {
  const n = document.querySelector('#generalTitle, #general h2, .general h2, h2');
  if (n && /General/i.test(n.textContent || "")) n.textContent = "Your CV and Prompts";
}

async function simplePromptAddProvider() {
  const name = prompt("Provider name (e.g., OpenAI, Ollama):", "OpenAI");
  if (name === null) return;
  const baseUrl = prompt("Base URL:", "https://api.openai.com/v1");
  if (baseUrl === null) return;
  const apiKey = prompt("API key (optional):", "");
  const id = (name.toLowerCase().replace(/\s+/g,'_') + '_' + Math.random().toString(36).slice(2,8));
  const provider = { id, name, type: name.toLowerCase(), baseUrl: (baseUrl||'').trim(), apiKey: (apiKey||'').trim() };
  try {
    const granted = await ensureHostPermission(provider.baseUrl);
    if (!granted) console.warn("[JDA] Host permission not granted for", provider.baseUrl);
  } catch {}
  settings.providers.push(provider);
  renderProviders();
  persistSettings();
}
function simplePromptAddModel() {
  if (!settings.providers.length) { alert('Add a provider first.'); return; }
  const displayName = prompt('Model display name:', 'gpt-4o mini');
  if (displayName === null) return;
  const modelId = prompt('Model ID (as in the provider):', 'gpt-4o-mini');
  if (modelId === null) return;
  const providerName = prompt('Provider (type exact name from list):', settings.providers[0].name);
  const prov = settings.providers.find(p => p.name === providerName) || settings.providers[0];
  const id = 'model_' + Math.random().toString(36).slice(2,8);
  settings.models.push({ id, providerId: prov.id, displayName, modelId, active: true, systemPrompt: '' });
  renderModels();
}

document.addEventListener("DOMContentLoaded", () => {
  loadSettings().catch(e => { console.error("[JDA options] init failed:", e); alert("Settings UI failed to initialize. See DevTools console for details."); });
});
