// background/index.js — точка входа сервис-воркера

import { sanitizeText, requireFields, guardedCall } from './utils.js';
import { getSettings, saveSettings, resetSettings } from './settings.js';
import { callLLMRouter, invalidateLLMProviderCache } from './llm/router.js';
import { saveToNotion } from './integrations/notion.js';
import { normalizeRuleForExec, evaluateRuleInPage, findMatchingRule } from '../shared/rules.js';

const FALLBACK_POPUP = 'ui/popup.html';
const LLM_CACHE_KEY = 'llmResultCacheV1';
const LLM_CACHE_LIMIT = 20;
const MENU_SELECT_DESCRIPTION = 'jda_select_description';
const MENU_AUTO_GRAB = 'jda_auto_grab';
const MENU_OPEN_SIDE_PANEL = 'jda_open_side_panel';
const DEFAULT_EXTRACT_WAIT = 4000; // ms
const DEFAULT_EXTRACT_POLL = 150;  // ms

let llmCache = null;
let llmCachePromise = null;

function hashString(input) {
  const str = String(input || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${(h >>> 0).toString(36)}:${str.length}`;
}

function buildLLMCacheKey(payload) {
  if (!payload) return '';
  const source = {
    providerId: payload.providerId || '',
    modelId: payload.modelId || '',
    systemTemplate: payload.systemTemplate || '',
    outputTemplate: payload.outputTemplate || '',
    modelSystemPrompt: payload.modelSystemPrompt || '',
    cv: payload.cv || '',
    text: payload.text || ''
  };
  return hashString(JSON.stringify(source));
}

function normalizeCache(raw) {
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  return {
    entries: entries.filter(e => e && typeof e.key === 'string' && typeof e.text === 'string')
  };
}

function storageGet(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([key], (res) => resolve(res?.[key]));
    } catch {
      resolve(undefined);
    }
  });
}

function storageSet(patch) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(patch, () => resolve());
    } catch {
      resolve();
    }
  });
}

async function getLLMCache() {
  if (llmCache) return llmCache;
  if (!llmCachePromise) {
    llmCachePromise = storageGet(LLM_CACHE_KEY).then((raw) => {
      llmCache = normalizeCache(raw);
      return llmCache;
    }).finally(() => {
      llmCachePromise = null;
    });
  }
  return llmCachePromise;
}

function findCacheEntry(cache, key) {
  if (!cache || !key) return null;
  const idx = cache.entries.findIndex(e => e.key === key);
  if (idx < 0) return null;
  const [entry] = cache.entries.splice(idx, 1);
  cache.entries.push(entry);
  return entry;
}

function upsertCacheEntry(cache, entry) {
  if (!cache || !entry?.key) return;
  const idx = cache.entries.findIndex(e => e.key === entry.key);
  if (idx >= 0) cache.entries.splice(idx, 1);
  cache.entries.push(entry);
  if (cache.entries.length > LLM_CACHE_LIMIT) {
    cache.entries.splice(0, cache.entries.length - LLM_CACHE_LIMIT);
  }
}

function removeCacheEntry(cache, key) {
  if (!cache || !key) return false;
  const idx = cache.entries.findIndex(e => e.key === key);
  if (idx < 0) return false;
  cache.entries.splice(idx, 1);
  return true;
}

async function persistLLMCache(cache) {
  await storageSet({ [LLM_CACHE_KEY]: cache });
}

function sanitizeTab(tab) {
  if (!tab) return null;
  return {
    id: tab.id ?? null,
    url: tab.url ?? tab.pendingUrl ?? '',
    title: tab.title ?? '',
    windowId: tab.windowId ?? null
  };
}


async function ensureOverlayHelpers(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['shared/i18n-content.js', 'content/meta-overlay.js', 'content/app-overlay.js']
  });
}

async function runOverlayAction(tabId, action = 'toggle') {
  await ensureOverlayHelpers(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (act) => {
      const overlay = window.__JDA_APP_OVERLAY__;
      if (!overlay) return;
      if (act === 'open') overlay.open();
      else if (act === 'close') overlay.close();
      else overlay.toggle();
    },
    args: [action]
  });
}

async function extractFromPageBG(tabId, ruleInput, { waitMs = 4000, pollMs = 150 } = {}) {
  const rule = normalizeRuleForExec(ruleInput);
  if (!rule) return { ok: false, error: 'invalid_rule' };
  const templateTargets = {
    toJob: rule.templateToJob === true,
    toResult: rule.templateToResult === true
  };

  const deadline = Date.now() + Math.max(800, Number(waitMs) || 3000);

  async function readOnceAllFrames() {
    try {
      const injResults = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'ISOLATED',
        func: evaluateRuleInPage,
        args: [rule]
      });

      const texts = [];
      let last = null;
      let templateText = '';
      let templateEntries = null;
      for (const inj of injResults || []) {
        const r = inj?.result;
        if (r) last = r;
        if (r?.ok && r.text) texts.push(r.text);
        if (!templateText && r?.templateText) templateText = r.templateText;
        if (!templateEntries && Array.isArray(r?.templateEntries) && r.templateEntries.length) {
          templateEntries = r.templateEntries;
        }
      }
      if (texts.length) {
        const merged = { ok: true, text: texts.join('\n\n') };
        if (templateText) merged.templateText = templateText;
        if (templateEntries?.length) merged.templateEntries = templateEntries;
        merged.templateTargets = templateTargets;
        return merged;
      }
      const fallback = last || { ok: false, error: 'notfound' };
      if (templateText && !fallback.templateText) fallback.templateText = templateText;
      if (templateEntries?.length && !fallback.templateEntries) fallback.templateEntries = templateEntries;
      fallback.templateTargets = fallback.templateTargets || templateTargets;
      return fallback;
    } catch (e) {
      return { ok: false, error: String(e && (e.message || e)) };
    }
  }

  let lastErr = 'timeout';
  while (Date.now() < deadline) {
    const res = await readOnceAllFrames();
    if (res?.ok) return res;
    lastErr = res?.error || lastErr;
    await new Promise(r => setTimeout(r, Math.max(80, Number(pollMs) || 160)));
  }
  return { ok: false, error: lastErr };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab;
}

async function resolveTabId(preferredId) {
  if (preferredId) return preferredId;
  const tab = await getActiveTab();
  return tab.id;
}

async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: '__PING__' }, { frameId: 0 });
    return false;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js']
    });
    return true;
  }
}

// Rely on default_popup behavior; no custom onClicked handler

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      // Overlay features removed

      if (message?.type === 'GET_ACTIVE_TAB') {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const sanitized = sanitizeTab(tab);
          sendResponse({ ok: true, tabId: sanitized?.id ?? null, tab: sanitized });
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
        return;
      }

      // no INIT_POPUP_CONTEXT in this build

      if (message?.type === 'BEGIN_SELECTION') {
        try {
          const tabId = await resolveTabId(message.tabId);
          await chrome.scripting.executeScript({ target: { tabId }, files: ['shared/i18n-content.js', 'content/select.js'] });
          await chrome.tabs.sendMessage(tabId, { type: 'START_SELECTION' });
          sendResponse({ ok: true, tabId });
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
        return;
      }

      if (message?.type === 'CLEAR_SELECTION') {
        try {
          const tabId = await resolveTabId(message.tabId);
          try {
            await chrome.tabs.sendMessage(tabId, { type: 'CLEAR_SELECTION' });
          } catch {
            await ensureContentScriptInjected(tabId);
            await chrome.tabs.sendMessage(tabId, { type: 'CLEAR_SELECTION' });
          }
          sendResponse({ ok: true, tabId });
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
        return;
      }

      if (message?.type === 'ENSURE_CONTENT_SCRIPT') {
        try {
          const tabId = await resolveTabId(message.tabId);
          const injected = await ensureContentScriptInjected(tabId);
          sendResponse({ ok: true, tabId, injected });
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
        return;
      }

      if (message?.type === 'EXTRACT_FROM_PAGE') {
        try {
          const tabId = await resolveTabId(message.tabId);
          const rawRule = message.rule !== undefined ? message.rule : message.selector;
          const rule = normalizeRuleForExec(rawRule);
          if (!rule) { sendResponse({ ok:false, error:'no_rule' }); return; }
          const res = await extractFromPageBG(tabId, rule, { waitMs: message.waitMs, pollMs: message.pollMs });
          sendResponse(res);
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
        return;
      }

      if (message?.type === 'RESET_DEFAULTS') {
        const keep = !!(message.payload?.keepApiKeys ?? true);
        await resetSettings({ keepApiKeys: keep });
        invalidateLLMProviderCache();
        sendResponse({ ok: true });
        return;
      }

      // No temp hide/show in this build

      if (message?.type === 'GET_SETTINGS') {
        const s = await getSettings();
        sendResponse(s);
        return;
      }

      if (message?.type === 'SAVE_SETTINGS') {
        await saveSettings(message.payload);
        invalidateLLMProviderCache();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === 'CALL_LLM') {
        const payload = message.payload || {};
        requireFields(payload, ['modelId', 'providerId']);
        payload.text = sanitizeText(payload.text || '');

        try { chrome.storage.local.set({ lastSelection: payload.text }); } catch {}

        const cacheKey = buildLLMCacheKey(payload);
        const forceRefresh = !!payload.forceRefresh;
        const cache = await getLLMCache();
        if (cacheKey) {
          if (forceRefresh) {
            if (removeCacheEntry(cache, cacheKey)) await persistLLMCache(cache);
          } else {
            const hit = findCacheEntry(cache, cacheKey);
            if (hit) {
              const cachedResult = { ok: true, text: hit.text || '', ms: hit.ms || 0, cached: true };
              try {
                chrome.storage.local.set({
                  lastResult: {
                    text: cachedResult.text,
                    ms: cachedResult.ms || 0,
                    when: Date.now(),
                    providerId: payload.providerId || null,
                    modelId: payload.modelId || null,
                    cvId: payload.cvId || null,
                    cvTitle: payload.cvTitle || '',
                    cached: true
                  }
                });
              } catch {}
              sendResponse(cachedResult);
              return;
            }
          }
        }

        const result = await guardedCall(() => callLLMRouter(payload));

        try {
          if (result?.ok) {
            chrome.storage.local.set({
              lastResult: {
                text: result.text,
                ms: result.ms || 0,
                when: Date.now(),
                providerId: payload.providerId || null,
                modelId: payload.modelId || null,
                cvId: payload.cvId || null,
                cvTitle: payload.cvTitle || ''
              }
            });
            if (cacheKey) {
              upsertCacheEntry(cache, {
                key: cacheKey,
                text: result.text || '',
                ms: result.ms || 0,
                when: Date.now()
              });
              await persistLLMCache(cache);
            }
          } else if (result?.error) {
            chrome.storage.local.set({ lastError: { error: result.error, when: Date.now() } });
          }
        } catch {}

        sendResponse(result);
        return;
      }

      if (message?.type === 'SAVE_TO_NOTION') {
        try {
          const settings = await getSettings();
          const result = await saveToNotion({ settings, payload: message.payload || {} });
          sendResponse(result);
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
        return;
      }

      if (message?.type === 'START_ANALYZE') {
        const p = message.payload || {};
        if (!p.providerId || !p.modelId || !p.text) {
          sendResponse({ ok: false, error: 'Missing providerId/modelId/text. Use popup to choose a model.' });
          return;
        }
        const result = await callLLMRouter({
          providerId: p.providerId,
          modelId: p.modelId,
          cv: p.cv || '',
          systemTemplate: p.systemTemplate || '',
          outputTemplate: p.outputTemplate || '',
          modelSystemPrompt: p.modelSystemPrompt || '',
          text: p.text
        });
        sendResponse(result);
        return;
      }

      if (message?.type === 'OPEN_POPUP') {
        try {
          const tabId = await resolveTabId(message.tabId);
          await runOverlayAction(tabId, 'open');
          sendResponse({ ok: true });
        } catch (e) {
          try {
            await chrome.tabs.create({ url: chrome.runtime.getURL('ui/popup.html') });
          } catch {}
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
        return;
      }

      if (message?.type === 'OPEN_OPTIONS_PAGE') {
        try {
          await chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
        } catch (err) {
          const url = chrome.runtime.getURL('ui/options.html');
          try { await chrome.tabs.create({ url }); } catch {}
          sendResponse({ ok: false, error: String(err?.message || err) });
        }
        return;
      }

      return;
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => { syncPopupForActiveTab(); });
chrome.runtime.onStartup?.addListener(() => { syncPopupForActiveTab(); });

syncPopupForActiveTab();

function wantsOverlay(url) {
  return /^https?:/i.test(url || '');
}

async function setPopupForTab(tabId, url) {
  if (!tabId) return;
  const popupPath = wantsOverlay(url) ? '' : FALLBACK_POPUP;
  try {
    await chrome.action.setPopup({ tabId, popup: popupPath });
  } catch (err) {
    console.debug('[JDA] setPopupForTab failed', err?.message || err);
  }
}

async function syncPopupForActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    for (const tab of tabs || []) {
      await setPopupForTab(tab.id, tab.url || tab.pendingUrl || '');
    }
  } catch (err) {
    console.debug('[JDA] syncPopupForActiveTab failed', err?.message || err);
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await setPopupForTab(tabId, tab?.url || tab?.pendingUrl || '');
    await updateAutoGrabVisibilityForTab(tab);
    ensureSidePanelEnabled(tab);
  } catch (err) {
    console.debug('[JDA] onActivated popup sync failed', err?.message || err);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo || (!Object.prototype.hasOwnProperty.call(changeInfo, 'url') && !Object.prototype.hasOwnProperty.call(changeInfo, 'status'))) {
    return;
  }
  if (changeInfo.url || changeInfo.status === 'complete') {
    setPopupForTab(tabId, (changeInfo.url ?? tab?.url ?? tab?.pendingUrl) || '').catch(() => {});
    updateAutoGrabVisibilityForTab(tab).catch(() => {});
    ensureSidePanelEnabled(tab);
  }
});

syncPopupForActiveTab();

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab?.id) return;
    const url = tab.url || '';
    if (!wantsOverlay(url)) {
      await chrome.tabs.create({ url: chrome.runtime.getURL(FALLBACK_POPUP) });
      return;
    }
    await runOverlayAction(tab.id, 'toggle');
  } catch (e) {
    console.warn('[JDA] overlay toggle failed:', e);
  }
});

function createContextMenus() {
  if (!chrome?.contextMenus) return;
  try {
    chrome.contextMenus.removeAll(() => {
      try {
        chrome.contextMenus.create({
          id: MENU_SELECT_DESCRIPTION,
          title: 'JDA: Select description',
          contexts: ['page', 'selection']
        });
        chrome.contextMenus.create({
          id: MENU_OPEN_SIDE_PANEL,
          title: 'JDA: Open side panel',
          contexts: ['page', 'selection']
        });
        chrome.contextMenus.create({
          id: MENU_AUTO_GRAB,
          title: 'JDA: Auto-grab',
          contexts: ['page'],
          visible: false
        });
      } catch (err) {
        console.debug('[JDA] context menu create failed:', err?.message || err);
      }
    });
  } catch (err) {
    console.debug('[JDA] context menu setup failed:', err?.message || err);
  }
}

async function updateAutoGrabVisibilityForTab(tab) {
  if (!chrome?.contextMenus?.update) return;
  const url = tab?.url || tab?.pendingUrl || '';
  if (!tab?.id || !url) {
    try { chrome.contextMenus.update(MENU_AUTO_GRAB, { visible: false }); } catch {}
    return;
  }
  try {
    const settings = await getSettings();
    const rules = settings?.sites || [];
    const match = findMatchingRule(rules, url);
    chrome.contextMenus.update(MENU_AUTO_GRAB, { visible: !!match });
  } catch {
    try { chrome.contextMenus.update(MENU_AUTO_GRAB, { visible: false }); } catch {}
  }
}

async function syncContextMenusForActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await updateAutoGrabVisibilityForTab(tab);
  } catch {}
}

async function runContextSelect(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['shared/i18n-content.js', 'content/select.js'] });
  await chrome.tabs.sendMessage(tabId, { type: 'START_SELECTION' });
}

function ensureSidePanelEnabled(tab) {
  if (!chrome?.sidePanel?.setOptions || !tab?.id) return;
  try {
    chrome.sidePanel.setOptions({ tabId: tab.id, path: 'ui/popup.html', enabled: true });
  } catch (err) {
    console.debug('[JDA] side panel setOptions failed:', err?.message || err);
  }
}

function buildCombinedText(resp, rule) {
  const ruleTargets = {
    toJob: !!rule?.templateToJob,
    toResult: !!rule?.templateToResult
  };
  const templateTargets = resp?.templateTargets || ruleTargets;
  const includeTemplateInJob = templateTargets.toJob === true;
  const baseText = String(resp?.text || '').trim();
  const rawTemplateText = String(resp?.templateText || '').trim();
  const rawTemplateEntries = Array.isArray(resp?.templateEntries) ? resp.templateEntries : [];

  let templateJobText = '';
  if (includeTemplateInJob) {
    if (rawTemplateEntries.length) {
      templateJobText = rawTemplateEntries
        .map(({ key, value }) => `${key}: ${value}`)
        .join('\n')
        .trim();
    } else {
      templateJobText = rawTemplateText;
    }
  }
  return [baseText, templateJobText].filter(Boolean).join('\n\n').trim();
}

async function runContextAutoGrab(tab) {
  const tabId = tab?.id;
  const url = tab?.url || tab?.pendingUrl || '';
  if (!tabId || !url) return;

  const settings = await getSettings();
  const rules = settings?.sites || [];
  const match = findMatchingRule(rules, url);
  if (!match) return;

  const rule = normalizeRuleForExec(match);
  if (!rule) return;

  const resp = await extractFromPageBG(tabId, rule, { waitMs: DEFAULT_EXTRACT_WAIT, pollMs: DEFAULT_EXTRACT_POLL });
  if (!resp?.ok) return;

  const combinedText = buildCombinedText(resp, rule);
  if (!combinedText) return;

  try {
    chrome.storage.local.set({ lastSelection: combinedText, lastSelectionWhen: Date.now() });
  } catch {}
  try {
    chrome.runtime.sendMessage({ type: 'SELECTION_RESULT', text: combinedText });
  } catch {}
}

if (chrome?.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const tabId = tab?.id;
    try {
      if (info.menuItemId === MENU_SELECT_DESCRIPTION) {
        if (!tabId) return;
        await runContextSelect(tabId);
      } else if (info.menuItemId === MENU_OPEN_SIDE_PANEL) {
        if (tabId && chrome?.sidePanel?.open) {
          chrome.sidePanel.open({ tabId });
        }
      } else if (info.menuItemId === MENU_AUTO_GRAB) {
        await runContextAutoGrab(tab);
      }
    } catch (err) {
      console.debug('[JDA] context menu action failed:', err?.message || err);
    }
  });
}

createContextMenus();
chrome.runtime.onInstalled.addListener(() => { createContextMenus(); });
chrome.runtime.onStartup?.addListener(() => { createContextMenus(); });
syncContextMenusForActiveTab();
