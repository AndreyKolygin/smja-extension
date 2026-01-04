// ui/js/options-models.js
import { $id, persistSettings, safeShowModal } from './options-util.js';

// добавь импорт вверху файла
import { applyTranslations, t } from './i18n.js';

export function renderModels(settings){
  const tbody = document.querySelector("#modelsTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  for (const m of settings.models) {
    const provider = settings.providers.find(p => p.id === m.providerId);
    const tr = document.createElement("tr");
    tr.dataset.id = m.id;
    const activeLabel = t('options.tbl.active', 'Active');
    tr.innerHTML = `
      <td class="drag" data-i18n-attr-title="options.models.dragTitle" title="Drag to reorder"><button class="icon-only icon-left i-grab drag-handle" draggable="true" aria-label="Drag" data-i18n-attr-aria-label="options.models.dragAria"></button></td>
      <td class="table-toggle">
        <label class="toggle toggle--compact toggle--icon-only">
          <span class="sr-only" data-i18n="options.tbl.active">${activeLabel}</span>
          <span class="toggle__control">
            <input type="checkbox"
                   class="toggle__input"
                   data-role="active"
                   ${m.active ? "checked" : ""}
                   data-i18n-attr-aria-label="options.tbl.active"
                   aria-label="${activeLabel}">
            <span class="toggle__track" aria-hidden="true">
              <span class="toggle__thumb"></span>
            </span>
          </span>
        </label>
      </td>
      <td contenteditable="true" data-role="display">${m.displayName ?? ""}</td>
      <td>${provider?.name || "?"}</td>
      <td contenteditable="true" data-role="modelId">${m.modelId ?? ""}</td>
      <td class="nowrap">
        <button class="btn edit icon-left i-pen"
                data-i18n="options.btn.edit"
                data-i18n-attr-title="options.btn.editTitle"
                title="Edit model and settings">Edit</button>

        <button class="btn edit-prompt icon-left i-doc-add"
                data-role="edit-sys-prompt"
                data-i18n="options.btn.editSysPrompt"
                data-i18n-attr-title="options.btn.editSysPromptTitle"
                title="Edit system prompt for this model">Edit system prompt</button>

        <button class="btn delete icon-left i-trash"
                data-i18n="options.btn.delete"
                data-i18n-attr-title="options.btn.deleteTitle"
                title="Delete model">Delete</button>
      </td>`;

    // events
    tr.querySelector('input[type="checkbox"][data-role="active"]')?.addEventListener("change", async (e) => {
      m.active = e.target.checked;
      await persistSettings(settings);
    });
    tr.querySelector('[data-role="display"]')?.addEventListener("input", (e) => m.displayName = e.target.textContent);
    tr.querySelector('[data-role="display"]')?.addEventListener("blur", () => persistSettings(settings));
    tr.querySelector('[data-role="modelId"]')?.addEventListener("input", (e) => m.modelId = e.target.textContent);
    tr.querySelector('[data-role="modelId"]')?.addEventListener("blur", () => persistSettings(settings));

    tr.querySelector("button.edit")?.addEventListener("click", () => editModel(settings, m));
    tr.querySelector('button[data-role="edit-sys-prompt"]')?.addEventListener("click", () => editModelSystemPrompt(settings, m));
    tr.querySelector("button.delete")?.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation?.();
      const label = (m.displayName || m.modelId || t('options.confirm.modelFallback', 'this model'));
      const promptText = t('options.confirm.deleteModel', 'Delete model “{label}”?')
        .replace('{label}', label);
      if (!confirm(promptText)) return;
      settings.models = settings.models.filter(x => x !== m);
      renderModels(settings);
      await persistSettings(settings);
    });

    tbody.appendChild(tr);

    // ⟵ ВАЖНО: применяем переводы к только что добавленной строке
    applyTranslations(tr);
  }

  wireModelReorder(settings);
}

export function wireModelModals(settings){
  const addModelBtn = document.getElementById("addModelBtn");
  addModelBtn?.addEventListener("click", () => editModel(settings, null));
}

function editModel(settings, m){
  const dlg = document.getElementById("modelModal");
  const providerSelect = document.getElementById("modelProvider");
  const displayInput = document.getElementById("modelDisplay");
  const idInput = document.getElementById("modelId");
  const maxTokensInput = document.getElementById("modelMaxTokens");
  const temperatureInput = document.getElementById("modelTemperature");
  const topPInput = document.getElementById("modelTopP");
  const topKInput = document.getElementById("modelTopK");
  const frequencyPenaltyInput = document.getElementById("modelFrequencyPenalty");
  const presencePenaltyInput = document.getElementById("modelPresencePenalty");
  const repetitionPenaltyInput = document.getElementById("modelRepetitionPenalty");
  const minPInput = document.getElementById("modelMinP");
  const topAInput = document.getElementById("modelTopA");
  if (!dlg || !providerSelect || !displayInput || !idInput) {
    // fallback prompts
    const providerRequiredMsg = t('options.alert.addProviderFirst', 'Add a provider first.');
    if (!settings.providers.length) { alert(providerRequiredMsg); return; }
    const displayName = prompt(t('options.prompt.displayName', 'Display name:'), m?.displayName || '');
    if (displayName === null) return;
    const modelId = prompt(t('options.prompt.modelId', 'Model ID:'), m?.modelId || '');
    if (modelId === null) return;
    const providerName = prompt(t('options.prompt.provider', 'Provider:'), (settings.providers.find(p=>p.id===m?.providerId)?.name) || settings.providers[0]?.name || '');
    const prov = settings.providers.find(p => p.name === providerName) || settings.providers[0];
    if (!prov) { alert(providerRequiredMsg); return; }
    if (m) {
      m.displayName = displayName.trim();
      m.modelId = modelId.trim();
      m.providerId = prov.id;
    } else {
      const id = "model_" + Math.random().toString(36).slice(2,8);
      settings.models.push({ id, providerId: prov.id, displayName: displayName.trim(), modelId: modelId.trim(), active: true, systemPrompt: "" });
    }
    renderModels(settings); persistSettings(settings); return;
  }

  // modal path
  providerSelect.innerHTML = "";
  for (const p of settings.providers) {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = `${p.name} (${p.type})`;
    providerSelect.appendChild(opt);
  }
  const PARAM_LIMITS = {
    maxTokens: { min: 0, max: null, step: 1 },
    temperature: { min: 0, max: 2, step: 0.01 },
    topP: { min: 0, max: 1, step: 0.01 },
    topK: { min: 0, max: 100, step: 1 },
    frequencyPenalty: { min: -2, max: 2, step: 0.01 },
    presencePenalty: { min: -2, max: 2, step: 0.01 },
    repetitionPenalty: { min: 0.1, max: 2, step: 0.01 },
    minP: { min: 0, max: 1, step: 0.001 },
    topA: { min: 0, max: 1, step: 0.001 }
  };
  const OPENAI_COMPAT = ['openai', 'deepseek', 'huggingface', 'meta', 'perplexity', 'xai', 'custom'];
  const SUPPORT_BY_TYPE = {
    openrouter: ['maxTokens','temperature','topP','topK','frequencyPenalty','presencePenalty','repetitionPenalty','minP','topA'],
    openai: ['maxTokens','temperature','topP','frequencyPenalty','presencePenalty'],
    azure: ['maxTokens','temperature','topP','frequencyPenalty','presencePenalty'],
    gemini: ['maxTokens','temperature','topP','topK'],
    ollama: ['maxTokens','temperature','topP','topK','frequencyPenalty','presencePenalty','repetitionPenalty'],
    anthropic: ['maxTokens']
  };
  const INPUTS = {
    maxTokens: maxTokensInput,
    temperature: temperatureInput,
    topP: topPInput,
    topK: topKInput,
    frequencyPenalty: frequencyPenaltyInput,
    presencePenalty: presencePenaltyInput,
    repetitionPenalty: repetitionPenaltyInput,
    minP: minPInput,
    topA: topAInput
  };
  const RANGE_LABELS = {
    maxTokens: '0+',
    temperature: '0–2',
    topP: '0–1',
    topK: '0–100',
    frequencyPenalty: '-2–2',
    presencePenalty: '-2–2',
    repetitionPenalty: '0.1–2',
    minP: '0–1',
    topA: '0–1'
  };
  const setSamplingVisibility = () => {
    const prov = settings.providers.find(p => p.id === providerSelect.value);
    const type = prov?.type || 'custom';
    const supported = SUPPORT_BY_TYPE[type] || (OPENAI_COMPAT.includes(type) ? SUPPORT_BY_TYPE.openai : []);
    Object.entries(INPUTS).forEach(([key, input]) => {
      if (!input) return;
      const row = input.closest('.form-row');
      const hint = row?.querySelector('[data-role="param-hint"]');
      const isSupported = supported.includes(key);
      if (row) row.hidden = !isSupported;
      if (isSupported && hint) {
        hint.textContent = t('options.modal.model.paramRange', 'Range: {{range}}')
          .replace('{{range}}', RANGE_LABELS[key] || '—');
      } else if (hint) {
        hint.textContent = '';
      }
      const limits = PARAM_LIMITS[key];
      if (limits) {
        if (limits.min != null) input.min = String(limits.min);
        if (limits.max != null) input.max = String(limits.max);
        if (limits.step != null) input.step = String(limits.step);
      }
    });
  };
  const setNumberValue = (el, value) => {
    if (!el) return;
    if (value === null || value === undefined || value === '') {
      el.value = '';
    } else {
      el.value = String(value);
    }
  };
  if (m) {
    providerSelect.value = m.providerId || (settings.providers[0]?.id || '');
    displayInput.value = m.displayName || '';
    idInput.value = m.modelId || '';
    setNumberValue(maxTokensInput, m.maxTokens);
    setNumberValue(temperatureInput, m.temperature);
    setNumberValue(topPInput, m.topP);
    setNumberValue(topKInput, m.topK);
    setNumberValue(frequencyPenaltyInput, m.frequencyPenalty);
    setNumberValue(presencePenaltyInput, m.presencePenalty);
    setNumberValue(repetitionPenaltyInput, m.repetitionPenalty);
    setNumberValue(minPInput, m.minP);
    setNumberValue(topAInput, m.topA);
  } else {
    providerSelect.value = (settings.providers[0]?.id || '');
    displayInput.value = '';
    idInput.value = '';
    setNumberValue(maxTokensInput, '');
    setNumberValue(temperatureInput, '');
    setNumberValue(topPInput, '');
    setNumberValue(topKInput, '');
    setNumberValue(frequencyPenaltyInput, '');
    setNumberValue(presencePenaltyInput, '');
    setNumberValue(repetitionPenaltyInput, '');
    setNumberValue(minPInput, '');
    setNumberValue(topAInput, '');
  }
  setSamplingVisibility();
  if (providerSelect.__samplingHandler) {
    providerSelect.removeEventListener('change', providerSelect.__samplingHandler);
  }
  providerSelect.__samplingHandler = setSamplingVisibility;
  providerSelect.addEventListener('change', setSamplingVisibility);

  safeShowModal(dlg);
  applyTranslations(dlg);

  const saveBtn = document.getElementById('saveModelBtn');
  const restore = saveBtn.onclick;

  const cancelBtn = document.getElementById('cancelModelBtn');
  if (cancelBtn) {
    const onCancel = (ev) => {
      try { ev.preventDefault(); ev.stopPropagation?.(); } catch {}
      // Force-close even if required fields exist
      try { dlg.close?.(); } catch {}
      // restore save handler if we modified it later
      saveBtn.onclick = restore || null;
    };
    cancelBtn.onclick = onCancel;
    dlg.addEventListener('cancel', onCancel, { once: true }); // Esc key
  }

  const readNumber = (el, { int = false } = {}) => {
    if (!el) return null;
    const raw = String(el.value || '').trim();
    if (!raw) return null;
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    return int ? Math.round(num) : num;
  };
  const clampValue = (key, value) => {
    if (value == null) return null;
    const limits = PARAM_LIMITS[key];
    if (!limits) return value;
    let v = value;
    if (limits.min != null && v < limits.min) v = limits.min;
    if (limits.max != null && v > limits.max) v = limits.max;
    return v;
  };

  saveBtn.onclick = () => {
    const maxTokens = clampValue('maxTokens', readNumber(maxTokensInput, { int: true }));
    const temperature = clampValue('temperature', readNumber(temperatureInput));
    const topP = clampValue('topP', readNumber(topPInput));
    const topK = clampValue('topK', readNumber(topKInput, { int: true }));
    const frequencyPenalty = clampValue('frequencyPenalty', readNumber(frequencyPenaltyInput));
    const presencePenalty = clampValue('presencePenalty', readNumber(presencePenaltyInput));
    const repetitionPenalty = clampValue('repetitionPenalty', readNumber(repetitionPenaltyInput));
    const minP = clampValue('minP', readNumber(minPInput));
    const topA = clampValue('topA', readNumber(topAInput));

    const applySampling = (target) => {
      target.maxTokens = maxTokens;
      target.temperature = temperature;
      target.topP = topP;
      target.topK = topK;
      target.frequencyPenalty = frequencyPenalty;
      target.presencePenalty = presencePenalty;
      target.repetitionPenalty = repetitionPenalty;
      target.minP = minP;
      target.topA = topA;
    };
    if (m) {
      m.providerId = providerSelect.value;
      m.displayName = displayInput.value.trim();
      m.modelId = idInput.value.trim();
      applySampling(m);
    } else {
      const id = "model_" + Math.random().toString(36).slice(2,8);
      const next = {
        id,
        providerId: providerSelect.value,
        displayName: displayInput.value.trim(),
        modelId: idInput.value.trim(),
        active: true,
        systemPrompt: ""
      };
      applySampling(next);
      settings.models.push(next);
    }
    renderModels(settings);
    persistSettings(settings);
    dlg.close?.();
    saveBtn.onclick = restore || null;
  };
}

function editModelSystemPrompt(settings, m){
  const dlg = document.getElementById('modelPromptModal');
  const textarea = document.getElementById('modelPromptText');
  const saveBtn = document.getElementById('saveModelPromptBtn');
  const cancelBtn = document.getElementById('cancelModelPromptBtn');

  if (!dlg || !textarea || !saveBtn || !cancelBtn){
    const text = prompt('Edit system prompt for model (blank = inherit global):', m.systemPrompt || '');
    if (text !== null){ m.systemPrompt = text; persistSettings(settings); }
    return;
  }
  textarea.value = m.systemPrompt || '';
  safeShowModal(dlg);
  applyTranslations(dlg);

  const oldSave = saveBtn.onclick, oldCancel = cancelBtn.onclick;
  saveBtn.onclick = () => { m.systemPrompt = textarea.value; persistSettings(settings); dlg.close?.(); saveBtn.onclick = oldSave||null; cancelBtn.onclick = oldCancel||null; };
  cancelBtn.onclick = () => { dlg.close?.(); saveBtn.onclick = oldSave||null; cancelBtn.onclick = oldCancel||null; };
}

// ------- Drag & Drop reorder -------
function wireModelReorder(settings){
  const tbody = document.querySelector('#modelsTable tbody');
  if (!tbody || tbody.__reorderWired) return;
  tbody.__reorderWired = true;

  let draggingId = null;

  tbody.addEventListener('dragstart', (ev) => {
    const handle = ev.target.closest('.drag-handle');
    if (!handle) return;
    const tr = handle.closest('tr');
    if (!tr) return;
    draggingId = tr.dataset.id || null;
    try {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', draggingId || '');
    } catch {}
    tr.classList.add('dragging');
  });

  tbody.addEventListener('dragend', (ev) => {
    const tr = ev.target.closest('tr');
    tr?.classList.remove('dragging');
    draggingId = null;
  });

  tbody.addEventListener('dragover', (ev) => {
    if (!draggingId) return;
    ev.preventDefault();
  });

  tbody.addEventListener('drop', async (ev) => {
    if (!draggingId) return;
    ev.preventDefault();
    const afterEl = getRowAfterY(tbody, ev.clientY);
    const ids = Array.from(tbody.querySelectorAll('tr')).map(r => r.dataset.id);
    const from = settings.models.findIndex(x => x.id === draggingId);
    if (from < 0) return;
    let to = settings.models.length; // default append to end
    if (afterEl) {
      const targetId = afterEl.dataset.id;
      to = ids.findIndex(id => id === targetId);
    } else {
      // drop to the end → keep to as length (append)
    }
    // moving before 'afterEl': compute insert index
    if (to > from) to -= 1; // account for removal shift
    if (from === to) return; // no change

    const item = settings.models.splice(from, 1)[0];
    settings.models.splice(Math.max(0, to), 0, item);
    renderModels(settings);
    await persistSettings(settings);
  });
}

function getRowAfterY(tbody, y){
  const rows = [...tbody.querySelectorAll('tr:not(.dragging)')];
  return rows.find(row => {
    const rect = row.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  }) || null;
}
