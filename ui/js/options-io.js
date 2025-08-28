// ui/js/options-io.js
import { $id, persistSettings, normalizeSettings } from './options-util.js';
import { renderProviders } from './options-providers.js';
import { renderModels } from './options-models.js';
import { renderSites } from './options-sites.js';

export function wireImportExport(settingsRef){
  $id('exportSettingsBtn')?.addEventListener('click', () => exportSettings(settingsRef));
  const fileInput = $id('importSettingsFile');
  $id('importSettingsBtn')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async (e) => {
    const f = e.target?.files?.[0];
    if (!f) return;
    await importSettingsFromFile(f, settingsRef);
    e.target.value = '';
  });
}

async function exportSettings(settings){
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

export async function importSettingsFromFile(file, settings){
  try {
    const text = await file.text();
    let obj;
    try { obj = JSON.parse(text); } catch(e){ alert('Invalid JSON file.'); return; }

    const imported = normalizeSettings(obj);
    const current  = normalizeSettings(settings);

    const ALL_SECTIONS = ["providers","models","sites","cv","systemTemplate","outputTemplate","general"];
    const scope = Array.isArray(obj.__import_scope) && obj.__import_scope.length
      ? obj.__import_scope.filter(s => ALL_SECTIONS.includes(s))
      : ALL_SECTIONS;
    const mode = (obj.__import_mode === "replace_section") ? "replace_section" : "merge";

    function mergeArrayBy(findFn, targetArr, incomingArr) {
      if (!Array.isArray(incomingArr) || !incomingArr.length) return targetArr || [];
      if (!Array.isArray(targetArr)) targetArr = [];
      incomingArr.forEach(item => {
        if (!item) return;
        const idx = targetArr.findIndex(x => findFn(x, item));
        if (idx >= 0) {
          const merged = { ...targetArr[idx], ...item };
          if ("apiKey" in item && (!item.apiKey || item.apiKey === "")) {
            merged.apiKey = targetArr[idx].apiKey;
          }
          targetArr[idx] = merged;
        } else {
          targetArr.push(item);
        }
      });
      return targetArr;
    }

    // scalars
    if (scope.includes("cv") && typeof imported.cv === "string" && imported.cv.trim()) current.cv = imported.cv;
    if (scope.includes("systemTemplate") && typeof imported.systemTemplate === "string" && imported.systemTemplate.trim()) current.systemTemplate = imported.systemTemplate;
    if (scope.includes("outputTemplate") && typeof imported.outputTemplate === "string" && imported.outputTemplate.trim()) current.outputTemplate = imported.outputTemplate;
    if (scope.includes("general") && imported.general && typeof imported.general === "object") {
      current.general = { ...current.general, ...imported.general };
    }

    // providers
    if (scope.includes("providers")) {
      if (mode === "replace_section") {
        const incoming = Array.isArray(imported.providers) ? imported.providers.map(p => {
          const found = (current.providers || []).find(cp => cp && ((p.id && cp.id === p.id) || (p.type && p.baseUrl && cp.type === p.type && cp.baseUrl === p.baseUrl)));
          if (found && (!p.apiKey || p.apiKey === "")) return { ...p, apiKey: found.apiKey || "" };
          return p;
        }) : [];
        current.providers = incoming;
      } else {
        current.providers = mergeArrayBy(
          (a,b) => (b.id && a.id === b.id) || (b.type && b.baseUrl && a.type === b.type && a.baseUrl === b.baseUrl),
          current.providers,
          imported.providers
        );
      }
    }

    // models
    if (scope.includes("models")) {
      if (mode === "replace_section") {
        current.models = Array.isArray(imported.models) ? imported.models : [];
      } else {
        current.models = mergeArrayBy(
          (a,b) =>
            (b.id && a.id === b.id) ||
            (b.providerId && b.modelId && a.providerId === b.providerId && a.modelId === b.modelId) ||
            (b.modelId && b.displayName && a.modelId === b.modelId && a.displayName === b.displayName),
          current.models,
          imported.models
        );
      }
    }

    // sites
    if (scope.includes("sites")) {
      if (mode === "replace_section") {
        current.sites = Array.isArray(imported.sites) ? imported.sites : [];
      } else {
        current.sites = mergeArrayBy(
          (a,b) => (b.id && a.id === b.id) || (b.host && b.selector && a.host === b.host && a.selector === b.selector),
          current.sites,
          imported.sites
        );
      }
    }

    // apply
    Object.assign(settings, current);

    // refresh UI
    $id('cv').value = settings.cv || '';
    $id('systemTemplate').value = settings.systemTemplate || '';
    $id('outputTemplate').value = settings.outputTemplate || '';
    renderProviders(settings);
    renderModels(settings);
    renderSites(settings);

    await persistSettings(settings);
    alert('Settings merged successfully.');
  } catch(e){
    alert('Import failed: ' + (e?.message || e));
  }
}
