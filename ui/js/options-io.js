// ui/js/options-io.js
import { getNormalizedSettings, persistSettings } from './options-util.js';
import { renderProviders } from './options-providers.js';
import { renderModels } from './options-models.js';
import { renderSites } from './options-sites.js';
import { renderIntegrations } from './options-integrations.js';
import { initCvManager } from './options-cv.js';
import { t } from './i18n.js';

// утилита: merge массива по id, с опцией сохранить существующие (по умолчанию true)
function mergeById(existing = [], incoming = [], { preserveExisting = true, onMerge = null } = {}) {
  const map = new Map();
  for (const x of existing) if (x?.id) map.set(x.id, { ...x });
  for (const y of incoming) {
    if (!y || !y.id) continue;
    if (map.has(y.id) && preserveExisting) {
      const merged = { ...map.get(y.id), ...y };
      if (onMerge) onMerge(merged, map.get(y.id), y);
      map.set(y.id, merged);
    } else {
      map.set(y.id, { ...y });
    }
  }
  return Array.from(map.values());
}

// специальная логика: не затирать API key пустым значением
function preserveApiKeys(mergedProviders = [], prevProviders = []) {
  const prevMap = new Map(prevProviders.filter(p => p?.id).map(p => [p.id, p]));
  for (const p of mergedProviders) {
    const prev = prevMap.get(p.id);
    if (prev && (!p.apiKey || p.apiKey === '')) {
      p.apiKey = prev.apiKey || '';
    }
  }
  return mergedProviders;
}

const randomCvId = () => `cv_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;

function cloneCvList(list = []) {
  return (list || []).map(cv => ({
    id: cv?.id || randomCvId(),
    title: cv?.title || '',
    content: cv?.content || '',
    updatedAt: Number.isFinite(cv?.updatedAt) ? Number(cv.updatedAt) : 0,
    isDefault: !!cv?.isDefault
  }));
}

async function applyImport(settings, imported, { mode = 'merge', groups = [] } = {}) {
  const src = getNormalizedSettings(imported);
  const tgt = settings;

  const want = (g) => groups.length === 0 || groups.includes(g);

  // Providers
  if (want('providers')) {
    if (mode === 'replace') {
      tgt.providers = preserveApiKeys(src.providers || [], []);
    } else {
      const merged = mergeById(tgt.providers || [], src.providers || [], {
        preserveExisting: true,
        onMerge: (mergedItem, prevItem, newItem) => {
          // если новый apiKey пустой — оставляем старый
          if (!newItem.apiKey) mergedItem.apiKey = prevItem.apiKey || '';
        }
      });
      tgt.providers = preserveApiKeys(merged, tgt.providers || []);
    }
  }

  // Models
  if (want('models')) {
    if (mode === 'replace') {
      tgt.models = src.models || [];
    } else {
      tgt.models = mergeById(tgt.models || [], src.models || [], { preserveExisting: true });
    }
  }

  // Sites (auto-extract rules)
  if (want('sites')) {
    if (mode === 'replace') {
      tgt.sites = src.sites || [];
    } else {
      tgt.sites = mergeById(tgt.sites || [], src.sites || [], { preserveExisting: true });
    }
  }

  // Prompts (CVs/systemTemplate/outputTemplate)
  if (want('prompts')) {
    if (!Array.isArray(tgt.cvs)) tgt.cvs = [];
    if (mode === 'replace') {
      tgt.cvs = cloneCvList(src.cvs || []);
      if ((!tgt.cvs || !tgt.cvs.length) && src.cv) {
        tgt.cvs = [{
          id: randomCvId(),
          title: t('options.cv.defaultName', 'CV {{index}}').replace('{{index}}', 1),
          content: src.cv,
          updatedAt: Date.now(),
          isDefault: true
        }];
      }
      tgt.systemTemplate = src.systemTemplate || '';
      tgt.outputTemplate = src.outputTemplate || '';
    } else {
      if (Array.isArray(src.cvs) && src.cvs.length) {
        tgt.cvs = [...(tgt.cvs || []), ...cloneCvList(src.cvs)];
      } else if (src.cv) {
        const title = t('options.cv.defaultName', 'CV {{index}}')
          .replace('{{index}}', (tgt.cvs?.length || 0) + 1);
        tgt.cvs = [
          ...(tgt.cvs || []),
          {
            id: randomCvId(),
            title,
            content: src.cv,
            updatedAt: Date.now(),
            isDefault: false
          }
        ];
      }
      if (src.systemTemplate) tgt.systemTemplate = src.systemTemplate;
      if (src.outputTemplate) tgt.outputTemplate = src.outputTemplate;
    }
    if (src.activeCvId && Array.isArray(tgt.cvs) && tgt.cvs.some(cv => cv.id === src.activeCvId)) {
      tgt.activeCvId = src.activeCvId;
    } else if (!tgt.activeCvId && tgt.cvs?.length) {
      tgt.activeCvId = tgt.cvs[0].id;
    }
  }

  if (want('integrations')) {
    const srcIntegr = src.integrations || {};
    if (!tgt.integrations) tgt.integrations = {};
    const srcNotion = srcIntegr.notion && typeof srcIntegr.notion === 'object' ? srcIntegr.notion : null;

    if (mode === 'replace') {
      if (srcNotion) {
        tgt.integrations.notion = JSON.parse(JSON.stringify(srcNotion));
      }
    } else if (srcNotion) {
      const dest = {
        enabled: tgt.integrations.notion?.enabled ?? false,
        token: tgt.integrations.notion?.token ?? '',
        databaseId: tgt.integrations.notion?.databaseId ?? '',
        fields: Array.isArray(tgt.integrations.notion?.fields) ? [...tgt.integrations.notion.fields] : []
      };
      if (typeof srcNotion.enabled === 'boolean') dest.enabled = srcNotion.enabled;
      if (srcNotion.databaseId) dest.databaseId = srcNotion.databaseId;
      if (Object.prototype.hasOwnProperty.call(srcNotion, 'token') && srcNotion.token) {
        dest.token = srcNotion.token;
      }
      if (Array.isArray(srcNotion.fields) && srcNotion.fields.length) {
        dest.fields = mergeById(dest.fields || [], srcNotion.fields, { preserveExisting: true });
      }
      tgt.integrations.notion = dest;
    }
  }

  await persistSettings(tgt, { immediate: true });

  // перерисуем таблицы/поля
  renderProviders(tgt);
  renderModels(tgt);
  renderSites(tgt);
  renderIntegrations(tgt);
  initCvManager(tgt);
  const sys = document.getElementById('systemTemplate');
  const out = document.getElementById('outputTemplate');
  if (sys) sys.value = tgt.systemTemplate || '';
  if (out) out.value = tgt.outputTemplate || '';
}

async function doExport(settings, { groups = [], includeProviderKeys = false, includeIntegrationSecrets = false } = {}) {
  // pick-only selected groups; when empty, export them all
  const want = (g) => groups.length === 0 || groups.includes(g);

  const src = settings || {};
  const out = {};

  if (want('providers')) {
    const list = Array.isArray(src.providers) ? JSON.parse(JSON.stringify(src.providers)) : [];
    if (!includeProviderKeys) {
      for (const p of list) { if (p) p.apiKey = ''; }
    }
    out.providers = list;
  }
  if (want('models')) {
    out.models = Array.isArray(src.models) ? JSON.parse(JSON.stringify(src.models)) : [];
  }
  if (want('sites')) {
    out.sites = Array.isArray(src.sites) ? JSON.parse(JSON.stringify(src.sites)) : [];
  }
  if (want('cv')) {
    if (Array.isArray(src.cvs) && src.cvs.length) {
      out.cvs = JSON.parse(JSON.stringify(src.cvs));
      out.activeCvId = src.activeCvId || src.cvs[0]?.id || '';
    }
    const fallbackCv = Array.isArray(src.cvs) && src.cvs.length
      ? src.cvs.find(cv => cv.id === (src.activeCvId || '')) || src.cvs[0]
      : null;
    out.cv = (fallbackCv?.content || src.cv || '');
  }
  if (want('systemTemplate')) {
    out.systemTemplate = src.systemTemplate || '';
  }
  if (want('outputTemplate')) {
    out.outputTemplate = src.outputTemplate || '';
  }
  if (want('integrations')) {
    const integr = src.integrations ? JSON.parse(JSON.stringify(src.integrations)) : {};
    if (!includeIntegrationSecrets && integr?.notion) {
      integr.notion.token = '';
    }
    if (integr && Object.keys(integr).length > 0) {
      out.integrations = integr;
    }
  }

  const data = JSON.stringify(out, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const r = new FileReader();
  r.onload = async () => {
    await chrome.downloads.download({
      url: r.result,
      filename: `jda_settings_${Date.now()}.json`,
      saveAs: true
    });
  };
  r.readAsDataURL(blob);
}

function setupDropZone() {
  const dropZone = document.getElementById('dropZone');
  const textArea = document.getElementById('importText');
  const fileInput = document.getElementById('importFileInput');
  if (!dropZone || !textArea || !fileInput) return;

  // Click / keyboard to open file picker
  const openPicker = () => { try { fileInput.click(); } catch {} };
  dropZone.addEventListener('click', openPicker);
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
  });

  // Drag & drop
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || ''));
        textArea.value = JSON.stringify(obj, null, 2);
      } catch (err) {
        const msg = err && err.message ? err.message : err;
        alert(t('options.alert.invalidJson', 'Invalid JSON: {{error}}').replace('{{error}}', msg));
      }
    };
    reader.readAsText(f);
  });

  // Hidden input change → load into textarea
  fileInput.addEventListener('change', async (e) => {
    const f = e.target && e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const obj = JSON.parse(txt);
      textArea.value = JSON.stringify(obj, null, 2);
    } catch (err) {
      const msg = err && err.message ? err.message : err;
      alert(t('options.alert.invalidJson', 'Invalid JSON: {{error}}').replace('{{error}}', msg));
    } finally {
      fileInput.value = '';
    }
  });
}

document.addEventListener("DOMContentLoaded", setupDropZone);

function openImportDialog(settings) {
  const dlg = document.getElementById('importModal');
  const fileInput = document.getElementById('importFileInput');
  if (!dlg || !fileInput) return;

  // безопасно открыть
  try { dlg.showModal(); } catch { dlg.setAttribute('open', 'open'); }

  const cancelBtn = document.getElementById('cancelImportBtn');
  const doImportBtn = document.getElementById('doImportBtn');

  const onCancel = () => {
    dlg.close?.();
    cleanup();
  };
  const onChoose = async (e) => {
    e?.preventDefault?.();
    const mode = (dlg.querySelector('input[name="importMode"]:checked')?.value) || 'merge';
    const groups = Array.from(dlg.querySelectorAll('input[name="grp"]:checked')).map(x => x.value);
    const ta = document.getElementById('importText');
    const raw = (ta && ta.value || '').trim();
    if (!raw) { alert(t('options.alert.importPaste', 'Paste JSON first or drop a file.')); return; }
    try {
      const obj = JSON.parse(raw);
      await applyImport(settings, obj, { mode, groups });
      alert(t('options.alert.importSuccess', 'Settings imported successfully.'));
      if (ta) ta.value = '';
      if (fileInput) fileInput.value = '';
      dlg.close?.();
    } catch (err) {
      const msg = err && err.message ? err.message : err;
      alert(t('options.alert.importFailed', 'Import failed: {{error}}').replace('{{error}}', msg));
    } finally {
      cleanup();
    }
  };

  function cleanup() {
    cancelBtn?.removeEventListener('click', onCancel);
    doImportBtn?.removeEventListener('click', onChoose);
  }

  cancelBtn?.addEventListener('click', onCancel);
  doImportBtn?.addEventListener('click', onChoose);
}

export function wireImportExport(settings) {
  const exportBtn = document.getElementById('exportSettingsBtn');
  const importBtn = document.getElementById('importSettingsBtn');
  
  exportBtn?.addEventListener('click', () => openExportDialog(settings));
  importBtn?.addEventListener('click', () => openImportDialog(settings));
}

function openExportDialog(settings){
  const dlg = document.getElementById('exportModal');
  if (!dlg) { doExport(settings); return; }

  try { dlg.showModal(); } catch { dlg.setAttribute('open','open'); }

  const cancelBtn = document.getElementById('cancelExportBtn');
  const doBtn = document.getElementById('doExportBtn');

  const onCancel = () => { try { dlg.close?.(); } catch {}; cleanup(); };
  const onDo = async (e) => {
    e?.preventDefault?.();
    const groups = Array.from(dlg.querySelectorAll('input[name="exgrp"]:checked')).map(x => x.value);
    const includeProviderKeys = !!dlg.querySelector('input[name="exprovkeys"]')?.checked;
    const includeIntegrationSecrets = !!dlg.querySelector('input[name="exintsecret"]')?.checked;
    try {
      await doExport(settings, { groups, includeProviderKeys, includeIntegrationSecrets });
      dlg.close?.();
    } catch (err) {
      const msg = String(err && (err.message || err));
      alert(t('options.alert.exportFailed', 'Export failed: {{error}}').replace('{{error}}', msg));
    } finally {
      cleanup();
    }
  };

  function cleanup(){
    cancelBtn?.removeEventListener('click', onCancel);
    doBtn?.removeEventListener('click', onDo);
  }

  cancelBtn?.addEventListener('click', onCancel);
  doBtn?.addEventListener('click', onDo);
}
