// background/index.js — точка входа сервис-воркера

import { sanitizeText, requireFields, guardedCall } from './utils.js';
import { getSettings, saveSettings, resetSettings } from './settings.js';
import { callLLMRouter, invalidateLLMProviderCache } from './llm/router.js';
import { saveToNotion } from './integrations/notion.js';
import { normalizeRuleForExec, evaluateRuleInPage } from '../shared/rules.js';

const FALLBACK_POPUP = 'ui/popup.html';

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
    files: ['shared/i18n-content.js', 'content/app-overlay.js']
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
      for (const inj of injResults || []) { const r = inj?.result; if (r) last = r; if (r?.ok && r.text) texts.push(r.text); }
      if (texts.length) return { ok: true, text: texts.join('\n\n') };
      return last || { ok: false, error: 'notfound' };
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
