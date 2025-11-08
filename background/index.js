// background/index.js — точка входа сервис-воркера

import { sanitizeText, requireFields, guardedCall } from './utils.js';
import { applyUiMode, getSettings, saveSettings, resetSettings } from './settings.js';
import { callLLMRouter } from './llm/router.js';
import { saveToNotion } from './integrations/notion.js';

function sanitizeTab(tab) {
  if (!tab) return null;
  return {
    id: tab.id ?? null,
    url: tab.url ?? tab.pendingUrl ?? '',
    title: tab.title ?? '',
    windowId: tab.windowId ?? null
  };
}

function normalizeRuleForExec(ruleOrSelector) {
  if (!ruleOrSelector && ruleOrSelector !== '') return null;
  if (typeof ruleOrSelector === 'string') {
    const selector = ruleOrSelector.trim();
    if (!selector) return null;
    return {
      strategy: 'css',
      selector,
      chain: [],
      script: ''
    };
  }
  const raw = (ruleOrSelector && typeof ruleOrSelector === 'object') ? ruleOrSelector : {};
  const strategy = typeof raw.strategy === 'string' ? raw.strategy.toLowerCase() : 'css';
  const selector = typeof raw.selector === 'string' ? raw.selector.trim() : '';
  const script = typeof raw.script === 'string' ? raw.script.trim() : '';
  const chain = Array.isArray(raw.chain)
    ? raw.chain.map((step) => {
        const sel = typeof step?.selector === 'string' ? step.selector.trim() : '';
        if (!sel) return null;
        const text = typeof step?.text === 'string' ? step.text.trim() : '';
        let nth = null;
        if (Number.isFinite(step?.nth)) {
          nth = Math.max(0, Math.floor(step.nth));
        } else if (typeof step?.nth === 'string' && step.nth.trim()) {
          const parsed = Number(step.nth.trim());
          if (Number.isFinite(parsed) && parsed >= 0) {
            nth = Math.floor(parsed);
          }
        }
        return { selector: sel, text, nth };
      }).filter(Boolean)
    : [];
  return {
    strategy: ['css', 'chain', 'script'].includes(strategy) ? strategy : 'css',
    selector,
    chain,
    script,
    chainSequential: raw.chainSequential === undefined ? false : !!raw.chainSequential
  };
}

async function evaluateRuleInPage(rule) {
  try {
    const strategy = (rule?.strategy || 'css').toLowerCase();

    function nodesToText(nodes) {
      const unique = [];
      const seen = new Set();
      for (const node of nodes || []) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        const text = (node.innerText ?? node.textContent ?? '').trim();
        if (text) unique.push(text);
      }
      const text = unique.join('\n\n')
        .replace(/\u00A0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return { text, count: unique.length };
    }

    function collectNodes(root, selector) {
      const parts = String(selector || '').split(',').map(s => s.trim()).filter(Boolean);
      const seen = new Set();
      const out = [];

      function pushNode(node) {
        if (node && !seen.has(node)) {
          seen.add(node);
          out.push(node);
        }
      }

      function collect(rootNode, sel) {
        if (!rootNode || !sel) return;
        try {
          if (rootNode instanceof Element && rootNode.matches?.(sel)) {
            pushNode(rootNode);
          }
        } catch {}
        try {
          const list = rootNode.querySelectorAll ? rootNode.querySelectorAll(sel) : [];
          for (const node of list) pushNode(node);
        } catch {}
        const descendants = rootNode.querySelectorAll ? rootNode.querySelectorAll('*') : [];
        for (const el of descendants) {
          if (el.shadowRoot) {
            collect(el.shadowRoot, sel);
          }
        }
      }

      for (const part of parts) {
        collect(root, part);
      }
      return out;
    }

    if (strategy === 'css') {
      const selector = String(rule?.selector || '').trim();
      if (!selector) return { ok: false, error: 'no_selector' };
      const nodes = collectNodes(document, selector);
      const { text, count } = nodesToText(nodes);
      return { ok: !!text, text, count };
    }

    if (strategy === 'chain') {
      const chain = Array.isArray(rule?.chain) ? rule.chain : [];
      if (!chain.length) return { ok: false, error: 'empty_chain' };
      const sequential = rule?.chainSequential ? true : false;
      if (!sequential) {
        let current = [document];
        for (const step of chain) {
          const sel = String(step?.selector || '').trim();
          if (!sel) continue;
          const next = [];
          const seen = new Set();
          for (const scope of current) {
            const nodes = collectNodes(scope, sel);
            let filtered = nodes;
            const textFilter = String(step?.text || '').trim().toLowerCase();
            if (textFilter) {
              filtered = filtered.filter(node => {
                const raw = (node.innerText ?? node.textContent ?? '').toLowerCase();
                return raw.includes(textFilter);
              });
            }
            const nth = Number.isFinite(step?.nth) ? step.nth : null;
            if (nth != null) {
              filtered = filtered[nth] ? [filtered[nth]] : [];
            }
            for (const node of filtered) {
              if (node && !seen.has(node)) {
                seen.add(node);
                next.push(node);
              }
            }
          }
          current = next;
          if (!current.length) break;
        }
        const { text, count } = nodesToText(current);
        return { ok: !!text, text, count };
      }
      const captured = [];
      for (const step of chain) {
        const sel = String(step?.selector || '').trim();
        if (!sel) continue;
        let nodes = collectNodes(document, sel);
        const textFilter = String(step?.text || '').trim().toLowerCase();
        if (textFilter) {
          nodes = nodes.filter(node => {
            const raw = (node.innerText ?? node.textContent ?? '').toLowerCase();
            return raw.includes(textFilter);
          });
        }
        const nth = Number.isFinite(step?.nth) ? step.nth : null;
        if (nth != null) {
          nodes = nodes[nth] ? [nodes[nth]] : [];
        }
        const { text } = nodesToText(nodes);
        if (text) captured.push(text);
      }
      const combined = captured.join('\n\n').trim();
      return { ok: !!combined, text: combined, count: captured.length };
    }

    if (strategy === 'script') {
      const body = String(rule?.script || '');
      if (!body.trim()) return { ok: false, error: 'empty_script' };
      try {
        const fn = new Function('document', 'window', 'root', '"use strict";' + body);
        const value = fn(document, window, document);
        const resolved = value && typeof value.then === 'function' ? await value : value;
        const text = typeof resolved === 'string'
          ? resolved
          : (resolved == null ? '' : String(resolved));
        const clean = text
          .replace(/\u00A0/g, ' ')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        return { ok: !!clean, text: clean, count: clean ? 1 : 0 };
      } catch (err) {
        return { ok: false, error: String(err && (err.message || err)) };
      }
    }

    return { ok: false, error: 'unknown_strategy' };
  } catch (err) {
    return { ok: false, error: String(err && (err.message || err)) };
  }
}

async function ensureOverlayHelpers(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/app-overlay.js']
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

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab?.id) return;
    const url = tab.url || '';
    if (!/^https?:/i.test(url)) {
      await chrome.tabs.create({ url: chrome.runtime.getURL('ui/popup.html') });
      return;
    }
    await runOverlayAction(tab.id, 'toggle');
  } catch (e) {
    console.warn('[JDA] overlay toggle failed:', e);
  }
});
