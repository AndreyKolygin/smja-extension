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
    tr.innerHTML = `
      <td><input type="checkbox" ${m.active ? "checked" : ""}></td>
      <td contenteditable="true">${m.displayName ?? ""}</td>
      <td>${provider?.name || "?"}</td>
      <td contenteditable="true">${m.modelId ?? ""}</td>
      <td>
        <button class="btn edit"
                data-i18n="options.btn.edit"
                data-i18n-attr-title="options.btn.editTitle"
                title="Edit model and settings">Edit</button>

        <button class="btn edit-prompt"
                data-role="edit-sys-prompt"
                data-i18n="options.btn.editSysPrompt"
                data-i18n-attr-title="options.btn.editSysPromptTitle"
                title="Edit system prompt for this model">Edit system prompt</button>

        <button class="btn delete"
                data-i18n="options.btn.delete"
                data-i18n-attr-title="options.btn.deleteTitle"
                title="Delete model">Delete</button>
      </td>`;

    // events
    tr.querySelector("input")?.addEventListener("change", async (e) => {
      m.active = e.target.checked;
      await persistSettings(settings);
    });
    tr.children[1]?.addEventListener("input", (e) => m.displayName = e.target.textContent);
    tr.children[1]?.addEventListener("blur", () => persistSettings(settings));
    tr.children[3]?.addEventListener("input", (e) => m.modelId = e.target.textContent);
    tr.children[3]?.addEventListener("blur", () => persistSettings(settings));

    tr.querySelector("button.edit")?.addEventListener("click", () => editModel(settings, m));
    tr.querySelector('button[data-role="edit-sys-prompt"]')?.addEventListener("click", () => editModelSystemPrompt(settings, m));
    tr.querySelector("button.delete")?.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation?.();
      const label = (m.displayName || m.modelId || "this model");
      const promptText = t('options.confirm.deleteModel', `Delete model “${label}”?`)
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
  if (!dlg || !providerSelect || !displayInput || !idInput) {
    // fallback prompts
    if (!settings.providers.length) { alert('Add a provider first.'); return; }
    const displayName = prompt('Display name:', m?.displayName || '');
    if (displayName === null) return;
    const modelId = prompt('Model ID:', m?.modelId || '');
    if (modelId === null) return;
    const providerName = prompt('Provider:', (settings.providers.find(p=>p.id===m?.providerId)?.name) || settings.providers[0]?.name || '');
    const prov = settings.providers.find(p => p.name === providerName) || settings.providers[0];
    if (!prov) { alert('Add a provider first.'); return; }
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
  if (m) {
    providerSelect.value = m.providerId || (settings.providers[0]?.id || '');
    displayInput.value = m.displayName || '';
    idInput.value = m.modelId || '';
  } else {
    providerSelect.value = (settings.providers[0]?.id || '');
    displayInput.value = '';
    idInput.value = '';
  }

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

  saveBtn.onclick = () => {
    if (m) {
      m.providerId = providerSelect.value;
      m.displayName = displayInput.value.trim();
      m.modelId = idInput.value.trim();
    } else {
      const id = "model_" + Math.random().toString(36).slice(2,8);
      settings.models.push({
        id,
        providerId: providerSelect.value,
        displayName: displayInput.value.trim(),
        modelId: idInput.value.trim(),
        active: true,
        systemPrompt: ""
      });
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
