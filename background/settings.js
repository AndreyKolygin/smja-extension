// background/settings.js — работа с настройками и режимами UI

import { getDefaultSettings } from '../shared/defaults.js';

export const SETTINGS_KEY = 'jdaSettings';

export function normalizeSettings(obj) {
  const base = {
    general: { helpUrl: 'https://github.com/AndreyKolygin/smja-extension' },
    providers: [],
    models: [],
    sites: [],
    cv: '',
    systemTemplate: '',
    outputTemplate: ''
  };
  const s = Object.assign({}, base, obj || {});
  if (!Array.isArray(s.providers)) s.providers = [];
  if (!Array.isArray(s.models)) s.models = [];
  if (!Array.isArray(s.sites)) s.sites = [];

  if (!s.general || typeof s.general !== 'object') s.general = {};
  const m = s.general.uiDefaultMode;
  s.general.uiDefaultMode = (m === 'overlay') ? 'overlay' : 'popup';

  return s;
}

export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', (res) => {
      let s = res.settings;
      if (!s) {
        const seeded = normalizeSettings(getDefaultSettings());
        chrome.storage.local.set({ settings: seeded }, () => resolve(seeded));
        return;
      }

      const normalized = normalizeSettings(s);
      try {
        if (JSON.stringify(normalized) !== JSON.stringify(s)) {
          chrome.storage.local.set({ settings: normalized }, () => resolve(normalized));
        } else {
          resolve(normalized);
        }
      } catch {
        resolve(normalized);
      }
    });
  });
}

export async function saveSettings(newSettings) {
  const normalized = normalizeSettings(newSettings);
  return new Promise((resolve) => {
    chrome.storage.local.set({ settings: normalized }, () => resolve(normalized));
  });
}

export async function applyUiMode() {
  try { await chrome.action.setPopup({ popup: 'ui/popup.html' }); } catch {}
}

export async function applyUiModeForTab(tabId) {
  try { await chrome.action.setPopup({ tabId, popup: 'ui/popup.html' }); } catch {}
}

export async function resetSettings({ keepApiKeys = true } = {}) {
  const current = await getSettings();
  const next = normalizeSettings(getDefaultSettings());

  if (keepApiKeys) {
    const prevMap = new Map((current?.providers || []).filter(p => p?.id).map(p => [p.id, p]));
    for (const p of next.providers) {
      const prev = prevMap.get(p.id);
      if (prev) {
        if (prev.apiKey) p.apiKey = prev.apiKey;
        if (prev.orgId) p.orgId = prev.orgId;
        if (prev.projectId) p.projectId = prev.projectId;
        if (prev.timeoutMs) p.timeoutMs = prev.timeoutMs;
      }
    }
  }

  try {
    await new Promise((resolve) => chrome.storage.local.remove(['lastResult', 'lastError', 'lastSelection', 'lastExport'], () => resolve()));
  } catch {}

  await saveSettings(next);
  return next;
}
