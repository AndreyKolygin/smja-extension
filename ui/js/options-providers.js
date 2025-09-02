// ui/js/options-providers.js
import { $id, persistSettings, ensureHostPermission, safeShowModal, maskKey } from './options-util.js';
import { applyTranslations } from './i18n.js';

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
const PROVIDER_HELP_KEY = {
  custom:      'options.modal.provider.help.custom',
  anthropic:   'options.modal.provider.help.anthropic',
  azure:       'options.modal.provider.help.azure',
  deepseek:    'options.modal.provider.help.deepseek',
  gemini:      'options.modal.provider.help.gemini',
  huggingface: 'options.modal.provider.help.huggingface',
  meta:        'options.modal.provider.help.meta',
  ollama:      'options.modal.provider.help.ollama',
  openai:      'options.modal.provider.help.openai',
  openrouter:  'options.modal.provider.help.openrouter',
  perplexity:  'options.modal.provider.help.perplexity',
  xai:         'options.modal.provider.help.xai'
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
      <td class="prov-name" contenteditable="true" title="Click to edit name">${p.name ?? ""}</td>
      <td>${p.baseUrl}</td>
      <td>${p.type || "custom"}</td>
      <td>${maskKey(p.apiKey)}</td>
      <td class="nowrap">
        <button class="btn edit icon-left i-pen" data-action="edit-provider" data-id="${p.id}" data-i18n-title="options.title.editllmProvider" title="Edit LLM provider settings" data-i18n="options.btn.edit"></button>
        <button class="btn delete icon-left i-paperbin" data-action="delete-provider" data-id="${p.id}" data-i18n="options.btn.delete"></button>
      </td>
    `;
    tbody.appendChild(tr);

    // inline edit: Name
    const nameCell = tr.querySelector(".prov-name");
    nameCell?.addEventListener("input", (e) => { p.name = e.currentTarget.textContent.trim(); });
    nameCell?.addEventListener("blur", async () => { await persistSettings(settings); });
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
  const nameI = document.getElementById("providerName");
  const helpEl = document.getElementById("apiKeyHelp");
  const form = dlg.querySelector('form');

  // Disable native form validation entirely; we'll validate manually in JS.
  if (form) form.setAttribute('novalidate', 'novalidate');
  // Ensure Cancel never triggers required validation popups.
  if (nameI) nameI.removeAttribute('required');

  if (!dlg || !preset || !base || !key || !link) {
       alert("Provider dialog markup is missing");
       return;
     }

  // removed: if (nameI) { nameI.setAttribute('required',''); }

  // init presets
  function applyPreset(preserveBase){
    const p = PRESETS[preset.value];
    if (!preserveBase || !base.value) base.value = p.baseUrl || "";
    link.href = p.url || "#"; 
    link.target = "_blank"; 
    link.rel = "noopener noreferrer";
    if (helpEl) {
      const key = PROVIDER_HELP_KEY[preset.value] || 'options.modal.provider.help';
      helpEl.setAttribute('data-i18n', key);
      helpEl.textContent = ''; // clear to let applyTranslations fill it
    }
    // re-translate the dialog after dynamic changes
    applyTranslations(dlg);
  }
  preset.addEventListener("change", () => applyPreset(false));

  if (provider) {
    // edit
    // try select by type
    const type = provider.type && PRESETS[provider.type] ? provider.type : 'custom';
    preset.value = type;
    base.value = provider.baseUrl || "";
    key.value = provider.apiKey || "";
    if (nameI) {
      nameI.value = provider.name || preset.options[preset.selectedIndex]?.text || "";
    }
    applyPreset(true);
    applyTranslations(dlg);
  } else {
    // add
    preset.value = 'openai';
    base.value = PRESETS.openai.baseUrl;
    key.value = '';
    if (nameI) nameI.value = '';
    applyPreset(false);
    applyTranslations(dlg);
  }

  applyTranslations(dlg);
  safeShowModal(dlg);
  applyTranslations(dlg);
  const saveBtn = document.getElementById("saveProviderBtn");
  if (saveBtn) saveBtn.setAttribute('type','button');
  if (form) {
    form.addEventListener('submit', (ev) => { ev.preventDefault(); }, { once: true });
  }
  const restore = saveBtn.onclick;

  const cancelBtn = document.getElementById('cancelProviderBtn');
  if (cancelBtn) {
    cancelBtn.setAttribute('type','button');
    cancelBtn.setAttribute('formnovalidate','true');
    const prevCancel = cancelBtn.onclick;
    cancelBtn.onclick = (e) => {
      // Make Cancel behave like pressing Escape: just close, no validation.
      e.preventDefault();
      e.stopPropagation();
      try { dlg.close?.(); } catch {}
      // restore original save handler if any
      saveBtn.onclick = restore || null;
      if (prevCancel) { try { prevCancel(e); } catch {} }
      return false;
    };
  }

  // Ensure ESC closes the dialog without triggering validation
  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') {
      const form = dlg.querySelector('form');
      if (form) {
        const prevNV = form.noValidate;
        form.noValidate = true;
        try { dlg.close?.(); } catch {}
        setTimeout(() => { form.noValidate = prevNV; }, 0);
        ev.preventDefault();
        ev.stopPropagation();
      }
    }
  };
  dlg.addEventListener('keydown', onKeyDown, { once: true });

  saveBtn.onclick = async () => {
    const nameVal = (nameI?.value || '').trim();
    if (!nameVal) {
      if (nameI && nameI.reportValidity) nameI.reportValidity();
      else alert('Please fill out the Name field.');
      nameI?.focus();
      return;
    }
    if (provider) {
      provider.name = nameVal;
      provider.type = PRESETS[preset.value].type;
      provider.baseUrl = base.value.trim();
      provider.apiKey = key.value.trim();
    } else {
      const id = (preset.value + "_" + Math.random().toString(36).slice(2,8));
      settings.providers.push({
        id,
        name: nameVal,
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
