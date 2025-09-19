// background/index.js — точка входа сервис-воркера

import { sanitizeText, requireFields, guardedCall } from './utils.js';
import { applyUiMode, getSettings, saveSettings, resetSettings } from './settings.js';
import { callLLMRouter } from './llm/router.js';

function sanitizeTab(tab) {
  if (!tab) return null;
  return {
    id: tab.id ?? null,
    url: tab.url ?? tab.pendingUrl ?? '',
    title: tab.title ?? '',
    windowId: tab.windowId ?? null
  };
}

async function extractFromPageBG(tabId, selector, { waitMs = 4000, pollMs = 150 } = {}) {
  const deadline = Date.now() + Math.max(800, Number(waitMs) || 3000);

  async function readOnceAllFrames() {
    try {
      const injResults = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'ISOLATED',
        func: (sel) => {
          function deepQuerySelector(sel) {
            let el = document.querySelector(sel);
            if (el) return el;
            const q = [];
            const seed = document.querySelectorAll('*');
            for (const n of seed) { if (n.shadowRoot) q.push(n.shadowRoot); }
            for (let i = 0; i < q.length; i++) {
              const root = q[i];
              try {
                el = root.querySelector(sel);
                if (el) return el;
              } catch {}
              const all = root.querySelectorAll('*');
              for (const n of all) { if (n.shadowRoot) q.push(n.shadowRoot); }
            }
            return null;
          }
          try {
            const node = deepQuerySelector(sel);
            if (!node) return { ok: false, error: 'notfound' };
            let text = (node.innerText ?? node.textContent ?? '').trim();
            if (!text) return { ok: false, error: 'empty' };
            text = text.replace(/\u00A0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
            return { ok: true, text };
          } catch (e) {
            return { ok: false, error: String(e && (e.message || e)) };
          }
        },
        args: [selector]
      });

      for (const inj of injResults || []) {
        const r = inj?.result;
        if (r?.ok) return r;
      }
      const last = injResults?.[injResults.length - 1]?.result;
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
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content/select.js'] });
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
          const selector = String(message.selector || '').trim();
          if (!selector) { sendResponse({ ok:false, error:'No selector' }); return; }
          const res = await extractFromPageBG(tabId, selector, { waitMs: message.waitMs, pollMs: message.pollMs });
          sendResponse(res);
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
        return;
      }

      if (message?.type === 'RESET_DEFAULTS') {
        const keep = !!(message.payload?.keepApiKeys ?? true);
        await resetSettings({ keepApiKeys: keep });
        try { await applyUiMode(); } catch {}
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
        try { await applyUiMode(); } catch {}
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
                modelId: payload.modelId || null
              }
            });
          } else if (result?.error) {
            chrome.storage.local.set({ lastError: { error: result.error, when: Date.now() } });
          }
        } catch {}

        sendResponse(result);
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
          chrome.action.openPopup(() => {
            const err = chrome.runtime.lastError;
            sendResponse({ ok: !err, error: err ? String(err.message || err) : undefined });
          });
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e) });
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

chrome.runtime.onInstalled.addListener(() => { applyUiMode(); });
chrome.runtime.onStartup?.addListener(() => { applyUiMode(); });

applyUiMode();
