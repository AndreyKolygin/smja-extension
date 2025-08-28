// ui/js/options-providers.js
import { $id, persistSettings, ensureHostPermission, safeShowModal, maskKey } from './options-util.js';

const PRESETS = {
  custom:      { type: "custom",     baseUrl: "",                                           url: "#" },
  anthropic:   { type: "anthropic",  baseUrl: "https://api.anthropic.com/v1",               url: "https://console.anthropic.com/" },
  azure:       { type: "azure",      baseUrl: "https://YOUR-RESOURCE-NAME.openai.azure.com",url: "https://portal.azure.com/" },
  deepseek:    { type: "deepseek",   baseUrl: "https://api.deepseek.com/v1",                url: "https://platform.deepseek.com/api_keys" },
  gemini:      { type: "gemini",     baseUrl: "https://generativelanguage.googleapis.com/v1beta", url: "https://aistudio.google.com/app/apikey" },
  huggingface: { type: "huggingface",baseUrl: "https://api-inference.huggingface.co",       url: "https://huggingface.co/settings/tokens" },
  meta:        { type: "meta",       baseUrl: "https://api.llama-api.com",                  url: "https://llama.developer.meta.com/docs/api-keys/" },
  ollama:      { type: "ollama",     baseUrl: "http://localhost:11434",                     url: "https://ollama.com" },
  openai:      { type: "openai",     baseUrl: "https://api.openai.com/v1",                  url: "https://platform.openai.com/api-keys" },
  openrouter:  { type: "openrouter", baseUrl: "https://openrouter.ai/api/v1",               url: "https://openrouter.ai/keys" },
  perplexity:  { type: "perplexity", baseUrl: "https://api.perplexity.ai",                  url: "https://docs.perplexity.ai/getting-started/quickstart" },
  xai:         { type: "xai",        baseUrl: "https://api.x.ai/v1",                         url: "https://docs.x.ai/docs/get-started" }
};
const PROVIDER_HELP = {
  custom:      "Enter provider-specific info manually.",
  anthropic:   "Anthropic Console → API keys.",
  azure:       "Azure Portal → your Azure OpenAI resource → Keys & Endpoint.",
  deepseek:    "DeepSeek Platform → API Keys.",
  gemini:      "Google AI Studio → API keys.",
  huggingface: "Hugging Face → Settings → Access Tokens.",
  meta:        "Meta Llama developers: request access and create API key.",
  ollama:      "Local Ollama, API key not required.",
  openai:      "OpenAI Platform → API Keys.",
  openrouter:  "OpenRouter dashboard → Keys.",
  perplexity:  "Perplexity docs/portal → API Keys.",
  xai:         "X.AI docs → Get started (API keys)."
};

export function renderProviders(settings){
  const tbody = document.querySelector("#providersTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  for (const p of settings.providers) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${p.baseUrl}</td>
      <td>${p.apiKey ? "…" + (p.apiKey.slice(-6)) : ""}</td>
      <td class="nowrap">
        <button class="btn edit" data-action="edit-provider" data-id="${p.id}" title="Edit LLM provider settings">Edit</button>
        <button class="btn danger" data-action="delete-provider" data-id="${p.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  const table = document.getElementById("providersTable");
  if (!table.__wired) {
    table.__wired = true;
    table.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const prov = settings.providers.find(x => x.id === id);
      if (!prov) return;

      if (action === "edit-provider") {
        openProviderModal(settings, prov);
      } else if (action === "delete-provider") {
        if (confirm(`Delete provider “${prov.name}”?`)) {
          settings.providers = settings.providers.filter(x => x.id !== id);
          renderProviders(settings);
          await persistSettings(settings);
        }
      }
    });
  }
}

export function wireProviderModals(settings){
  const addProviderBtn = document.getElementById("addProviderBtn");
  addProviderBtn?.addEventListener("click", () => openProviderModal(settings, null));
}

function openProviderModal(settings, provider) {
  const dlg = document.getElementById("providerModal");
  const preset = document.getElementById("providerPreset");
  const base = document.getElementById("providerBaseUrl");
  const key = document.getElementById("providerApiKey");
  const link = document.getElementById("apiKeyLink");
  const helpEl = document.getElementById("apiKeyHelp");
  if (!dlg || !preset || !base || !key || !link) return;

  // init presets
  function applyPreset(preserveBase){
    const p = PRESETS[preset.value];
    if (!preserveBase || !base.value) base.value = p.baseUrl || "";
    link.href = p.url || "#"; link.target = "_blank"; link.rel = "noopener noreferrer";
    if (helpEl) helpEl.textContent = PROVIDER_HELP[preset.value] || "";
  }
  preset.addEventListener("change", () => applyPreset(false));

  if (provider) {
    // edit
    // try select by type
    const type = provider.type && PRESETS[provider.type] ? provider.type : 'custom';
    preset.value = type;
    base.value = provider.baseUrl || "";
    key.value = provider.apiKey || "";
    applyPreset(true);
  } else {
    // add
    preset.value = 'openai';
    base.value = PRESETS.openai.baseUrl;
    key.value = '';
    applyPreset(false);
  }

  safeShowModal(dlg);
  const saveBtn = document.getElementById("saveProviderBtn");
  const restore = saveBtn.onclick;

  saveBtn.onclick = async () => {
    if (provider) {
      provider.name = preset.options[preset.selectedIndex].text;
      provider.type = PRESETS[preset.value].type;
      provider.baseUrl = base.value.trim();
      provider.apiKey = key.value.trim();
    } else {
      const id = (preset.value + "_" + Math.random().toString(36).slice(2,8));
      settings.providers.push({
        id,
        name: preset.options[preset.selectedIndex].text,
        type: PRESETS[preset.value].type,
        baseUrl: base.value.trim(),
        apiKey: key.value.trim()
      });
    }
    try { await ensureHostPermission(base.value.trim()); } catch {}
    renderProviders(settings);
    await persistSettings(settings);
    dlg.close?.();
    saveBtn.onclick = restore || null;
  };
}
