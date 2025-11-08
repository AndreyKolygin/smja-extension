// background/settings.js — работа с настройками и режимами UI

import { getDefaultSettings, DEFAULTS } from '../shared/defaults.js';

export const SETTINGS_KEY = 'jdaSettings';

function randomId() {
  return `nf_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}

function cloneDefaultNotion() {
  const base = DEFAULTS?.NOTION || {};
  return {
    enabled: !!base.enabled,
    token: base.token || '',
    databaseId: base.databaseId || '',
    fields: Array.isArray(base.fields) ? base.fields.map(f => ({ ...f })) : []
  };
}

const NOTION_TYPES = new Set(['title', 'rich_text', 'url', 'number', 'checkbox', 'date', 'multi_select', 'status']);
const NOTION_SOURCES = new Set(['analysis', 'jobDescription', 'selectedText', 'url', 'provider', 'model', 'timestamp', 'cv', 'pageTitle', 'custom']);
const SITE_STRATEGIES = new Set(['css', 'chain', 'script']);

function normalizeNotionField(field, idx = 0) {
  const base = {
    id: randomId(),
    label: '',
    propertyName: '',
    propertyType: 'rich_text',
    source: 'analysis',
    staticValue: ''
  };
  const raw = field && typeof field === 'object' ? field : {};
  const id = String(raw.id || '') || `${base.id}_${idx}`;
  const propertyType = NOTION_TYPES.has(raw.propertyType) ? raw.propertyType : (raw.propertyType === 'title' ? 'title' : 'rich_text');
  const source = NOTION_SOURCES.has(raw.source) ? raw.source : 'analysis';
  return {
    id,
    label: typeof raw.label === 'string' ? raw.label : '',
    propertyName: typeof raw.propertyName === 'string' ? raw.propertyName : '',
    propertyType,
    source,
    staticValue: typeof raw.staticValue === 'string' ? raw.staticValue : ''
  };
}

function normalizeChainStep(step, idx = 0) {
  const raw = step && typeof step === 'object' ? step : {};
  const selector = typeof raw.selector === 'string' ? raw.selector.trim() : '';
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  let nth = null;
  if (Number.isFinite(raw.nth)) {
    nth = Math.max(0, Math.floor(raw.nth));
  } else if (typeof raw.nth === 'string' && raw.nth.trim()) {
    const parsed = Number(raw.nth.trim());
    if (Number.isFinite(parsed)) nth = Math.max(0, Math.floor(parsed));
  }
  return selector
    ? { selector, text, nth }
    : { selector: '', text: '', nth: null };
}

function normalizeChainGroup(group, idx = 0, fallbackId = '') {
  const raw = group && typeof group === 'object' ? group : {};
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((step, i) => normalizeChainStep(step, i)).filter(st => st.selector)
    : [];
  if (!steps.length) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `${fallbackId || 'cg'}_${idx}`,
    label: typeof raw.label === 'string' ? raw.label : '',
    active: raw.active === undefined ? true : !!raw.active,
    steps
  };
}

function normalizeSiteRule(rule, idx = 0) {
  const baseId = `site_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
  const raw = rule && typeof rule === 'object' ? rule : {};
  const strategy = SITE_STRATEGIES.has(raw.strategy) ? raw.strategy : 'css';
  const host = typeof raw.host === 'string' ? raw.host.trim() : '';
  const selector = typeof raw.selector === 'string' ? raw.selector.trim() : '';
  const comment = typeof raw.comment === 'string' ? raw.comment.trim() : '';
  const script = typeof raw.script === 'string' ? raw.script.trim() : '';
  const active = raw.active === undefined ? true : !!raw.active;
  const chain = Array.isArray(raw.chain) ? raw.chain.map((step, i) => normalizeChainStep(step, i)).filter(st => st.selector) : [];

  const hasChainFlag = Object.prototype.hasOwnProperty.call(raw, 'chainSequential');
  const chainSequential = hasChainFlag ? !!raw.chainSequential : false;
  let chainGroups = [];
  if (Array.isArray(raw.chainGroups) && raw.chainGroups.length) {
    chainGroups = raw.chainGroups
      .map((group, groupIdx) => normalizeChainGroup(group, groupIdx, baseId))
      .filter(Boolean);
  } else if (chain.length) {
    chainGroups = [normalizeChainGroup({ id: `${baseId}_cg0`, steps: chain }, 0, baseId)].filter(Boolean);
  }
  const activeGroups = chainGroups.filter(group => group.active !== false);
  const flattenedChain = activeGroups.length
    ? activeGroups.reduce((acc, group) => acc.concat(group.steps), [])
    : (chainGroups.length ? [] : chain);

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : baseId,
    host,
    strategy,
    selector: strategy === 'css' ? selector : selector || '',
    comment,
    active,
    chain: flattenedChain,
    chainGroups,
    script: strategy === 'script' ? script : '',
    chainSequential
  };
}

function normalizeNotionSettings(notion) {
  const base = cloneDefaultNotion();
  const raw = notion && typeof notion === 'object' ? notion : {};
  const fieldsSource = Array.isArray(raw.fields) ? raw.fields : base.fields;
  return {
    enabled: !!raw.enabled,
    token: typeof raw.token === 'string' ? raw.token : '',
    databaseId: typeof raw.databaseId === 'string' ? raw.databaseId : '',
    fields: fieldsSource.map((f, idx) => normalizeNotionField(f, idx))
  };
}

export function normalizeSettings(obj) {
  const base = {
    general: { helpUrl: 'https://github.com/AndreyKolygin/smja-extension' },
    providers: [],
    models: [],
    sites: [],
    cv: '',
    systemTemplate: '',
    outputTemplate: '',
    integrations: {
      notion: cloneDefaultNotion()
    }
  };
  const s = Object.assign({}, base, obj || {});
  if (!Array.isArray(s.providers)) s.providers = [];
  if (!Array.isArray(s.models)) s.models = [];
  if (!Array.isArray(s.sites)) s.sites = [];
  s.sites = s.sites.map((rule, idx) => normalizeSiteRule(rule, idx));

  if (!s.general || typeof s.general !== 'object') s.general = {};

  if (!s.integrations || typeof s.integrations !== 'object') s.integrations = {};
  s.integrations.notion = normalizeNotionSettings(s.integrations.notion);

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
    if (current?.integrations?.notion) {
      next.integrations.notion = normalizeNotionSettings({
        ...current.integrations.notion
      });
    }
  }

  try {
    await new Promise((resolve) => chrome.storage.local.remove(['lastResult', 'lastError', 'lastSelection', 'lastExport'], () => resolve()));
  } catch {}

  await saveSettings(next);
  return next;
}
