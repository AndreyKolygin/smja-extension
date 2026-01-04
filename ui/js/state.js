// state.js — единое состояние и базовые утилиты
import { t } from "./i18n.js";
import { getActiveCv } from "../../shared/cv.js";
import { buildPrompt } from "../../shared/prompt.js";
export const SETTINGS_KEY = "settings"; // в SW уже унифицировано на local.settings
export const state = {
  selectedText: "",
  lastResponse: "",
  timerId: 0,
  timerStart: 0,
  settings: null,
  chosenModel: null,
  chosenCvId: null,
  activeTab: null,
  templateMetaEntries: [],
  templateMetaEntriesRaw: [],
  forceRefresh: false,
  lastOutputTokens: 0
};


function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
  ));
}

/** очень лёгкий Markdown → HTML (заголовки, списки, **жирный**, *курсив*, код) */
function mdToHtml(md) {
  if (!md) return "";
  // Экранируем HTML
  let s = escapeHtml(md);

  // Блоки кода ``` ```
  s = s.replace(/```([\s\S]*?)```/g, (_, code) =>
    `<pre><code>${code.replace(/\n$/, '')}</code></pre>`
  );

  // Заголовки #, ##, ###, ####
  s = s.replace(/^####\s+(.*)$/gm, '<h4>$1</h4>');
  s = s.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
  s = s.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
  s = s.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

  // Списки (ul): корректно группируем подряд идущие пункты.
  // Поддерживаем маркеры: -, *, •, –, — и опциональную кавычку перед маркером.
  s = s.replace(/(?:^|\n)((?:\s*(?:["“”])?[-*•–—]\s+.*(?:\n|$))+)/g, (m, block) => {
    const lis = block
      .trim()
      .split('\n')
      .map(line => {
        const mm = line.match(/^\s*(["“”]?)[-*•–—]\s+(.*)$/);
        if (!mm) return '';
        const [, quote, text] = mm;
        return `<li>${quote}${text.trim()}</li>`;
      })
      .filter(Boolean)
      .join('');
    return `\n<ul>${lis}</ul>\n`;
  });

  // Нумерованные списки (ol): жадно группируем блоки 1. 2. 3. ...
  s = s.replace(/(?:^|\n)((?:\d+\.\s+.*(?:\n|$))+)/g, (m, block) => {
    const lis = String(block || '')
      .trim()
      .split('\n')
      .map(line => {
        const mm = line.match(/^\s*\d+\.\s+(.*)$/);
        return mm ? `<li>${mm[1].trim()}</li>` : '';
      })
      .filter(Boolean)
      .join('');
    return lis ? `\n<ol>${lis}</ol>\n` : m;
  });

  // Inline стили: **bold**, *italic*, `code`, __underline__
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/__([^_]+?)__/g, '<u>$1</u>');
  s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');

  // Blockquotes: строки начинающиеся с >
  // Группируем последовательные строки, начинающиеся с >
  s = s.replace(/(^|\n)((?:>\s?.*(?:\n|$))+)/g, (m, p1, block) => {
    const lines = block.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return m;
    if (!lines.every(line => /^>\s?/.test(line))) return m;
    const content = lines.map(line => line.replace(/^>\s?/, '')).join('<br>');
    return `\n<blockquote>${content}</blockquote>\n`;
  });

  // Параграфы: пустые строки → <p>
  // Не оборачиваем блоки: h1, h2, h3, h4, ul, ol, blockquote
  const lines = s.split(/\n{2,}/).map(chunk => {
    if (/^\s*<(h1|h2|h3|h4|ul|ol|blockquote)/.test(chunk)) return chunk; // не оборачиваем большие блоки
    return `<p>${chunk.replace(/\n/g, '<br>')}</p>`;
  });
  return lines.join('\n');
}

function estimateTokens(text) {
  if (!text) return 0;
  const chars = String(text).length;
  return Math.max(1, Math.ceil(chars / 4));
}
// утилита для безопасной отрисовки результата в стилизованный блок
export function setResult(text) {
  const el = document.getElementById("resultView");
  if (el) el.innerHTML = mdToHtml(text || "");
  const hasText = !!(text && String(text).trim());
  ["copyBtn", "saveBtn", "notionBtn"].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !hasText;
  });
  renderTemplateMeta();
}

export function setCachedBadge(isCached) {
  const badge = document.getElementById("cachedBadge");
  if (!badge) return;
  const on = !!isCached;
  badge.hidden = !on;
}

export function setTokenEstimate(tokens) {
  const el = document.getElementById("tokenEstimate");
  if (!el) return;
  const safe = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0;
  if (!safe) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const label = t('ui.popup.tokensEstimate', 'Approx. tokens: ~{{tokens}}').replace('{{tokens}}', String(safe));
  el.textContent = label;
}

export function setOutputTokenEstimateFromText(text) {
  state.lastOutputTokens = estimateTokens(text);
  updateTokenEstimate();
}

export function resetOutputTokenEstimate() {
  state.lastOutputTokens = 0;
  updateTokenEstimate();
}

export async function getActiveTab({ refresh = false } = {}) {
  if (!refresh && state.activeTab?.id) return state.activeTab;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB' });
    if (resp?.ok && resp.tab) {
      state.activeTab = resp.tab;
      return resp.tab;
    }
    if (resp?.ok && resp.tabId) {
      state.activeTab = { id: resp.tabId };
      return state.activeTab;
    }
  } catch (e) {
    console.debug('[JDA] GET_ACTIVE_TAB failed:', e);
  }
  if (chrome?.tabs?.query) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        state.activeTab = tab;
        return tab;
      }
    } catch (err) {
      console.debug('[JDA] chrome.tabs.query fallback failed:', err);
    }
  }
  return state.activeTab || null;
}

export function setActiveTab(tab) {
  state.activeTab = tab ? { id: tab.id ?? null, url: tab.url ?? '', title: tab.title ?? '' } : null;
}

export function setLastMeta(whenMs) {
  const el = document.getElementById("lastMeta");
  if (!el) return;
  if (!whenMs) { el.textContent = ""; return; }
  const sec = Math.max(0, (Date.now() - whenMs) / 1000).toFixed(1);
  el.textContent = `Last result • ${sec}s ago`;
}

function renderTemplateMeta() {
  const container = document.getElementById("resultView");
  if (!container) return;
  const existing = container.querySelector('.template-meta-block');
  if (existing) existing.remove();
  const entries = Array.isArray(state.templateMetaEntries) ? state.templateMetaEntries : [];
  if (!entries.length) return;

  const block = document.createElement('div');
  block.className = 'template-meta-block';

  const title = document.createElement('div');
  title.className = 'template-meta-title';
  title.textContent = t('ui.templateMeta.title', 'Page meta data');
  block.appendChild(title);

  const list = document.createElement('div');
  list.className = 'template-meta-list';
  entries.forEach(({ key, value }) => {
    const row = document.createElement('div');
    row.className = 'template-meta-entry';
    row.textContent = `${key}: ${value}`;
    list.appendChild(row);
  });

  block.appendChild(list);
  container.appendChild(block);
}

function sanitizeMetaEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      const key = String(entry?.key || '').trim();
      const value = String(entry?.value || '').trim();
      return key && value ? { key, value } : null;
    })
    .filter(Boolean);
}

export function setTemplateMeta(entries = [], rawEntries = null) {
  state.templateMetaEntries = sanitizeMetaEntries(entries);
  if (rawEntries === null) {
    state.templateMetaEntriesRaw = [...state.templateMetaEntries];
  } else {
    state.templateMetaEntriesRaw = sanitizeMetaEntries(rawEntries);
  }
  renderTemplateMeta();
}

export function setProgress(text, ms = null, extra = null) {
  const el = document.getElementById("progress");
  if (!el) return;
  if (!el.dataset.defaultI18n) {
    const baseKey = el.getAttribute('data-i18n');
    if (baseKey) el.dataset.defaultI18n = baseKey;
  }

  let i18nKey = null;
  const data = extra && typeof extra === 'object' ? { ...extra } : null;
  if (data && Object.prototype.hasOwnProperty.call(data, 'i18nKey')) {
    i18nKey = data.i18nKey;
    delete data.i18nKey;
  }

  if (ms != null) {
    el.dataset.ms = String(ms);
  } else {
    el.dataset.ms = '0';
  }
  delete el.dataset.seconds;
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      if (value == null) delete el.dataset[key];
      else el.dataset[key] = String(value);
    }
  }

  if (i18nKey) {
    el.setAttribute('data-i18n', String(i18nKey));
  } else if (el.dataset.defaultI18n) {
    el.setAttribute('data-i18n', el.dataset.defaultI18n);
  }

  el.textContent = text || "";
}

export function startTimer() {
  state.timerStart = performance.now();
  stopTimer();
  const initial = t('ui.popup.progress', 'Progress: {{ms}} ms').replace('{{ms}}', '0');
  setProgress(initial, 0, { i18nKey: 'ui.popup.progress' });
  state.timerId = setInterval(() => {
    const ms = Math.max(0, performance.now() - state.timerStart);
    const label = t('ui.popup.progress', 'Progress: {{ms}} ms').replace('{{ms}}', ms.toFixed(0));
    setProgress(label, ms, { i18nKey: 'ui.popup.progress' });
  }, 100);
}

export function stopTimer(done = false, ms = 0) {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = 0;
  if (done) {
    const seconds = Math.max(0, ms / 1000).toFixed(2);
    const label = t('ui.popup.progressDone', 'Done: {{seconds}}s').replace('{{seconds}}', seconds);
    setProgress(label, ms, { seconds, i18nKey: 'ui.popup.progressDone' });
  } else {
    setProgress('', null);
  }
}

export async function fetchSettings() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (resp) return resp;
  } catch (err) {
    console.debug('[JDA] GET_SETTINGS via SW failed:', err);
  }
  try {
    const res = await chrome.storage.local.get(['settings']);
    return res?.settings || null;
  } catch (err) {
    console.debug('[JDA] local settings read failed:', err);
    return null;
  }
}

export function setJobInput(text) {
  const el = document.getElementById("jobInput");
  if (el) el.value = text ?? "";
  updateTokenEstimate();
}

export function getSelectedCvInfo() {
  const list = Array.isArray(state.settings?.cvs) ? state.settings.cvs : [];
  const preferredId = state.chosenCvId || state.settings?.activeCvId || null;
  const { active } = getActiveCv(list, preferredId);
  if (!active) {
    return { id: null, title: '', content: '' };
  }
  return { id: active.id, title: active.title || '', content: active.content || '' };
}

export function updateTokenEstimate() {
  const settings = state.settings;
  if (!settings) {
    setTokenEstimate(0);
    return;
  }
  const jobText = document.getElementById("jobInput")?.value?.trim() || "";
  const cvInfo = getSelectedCvInfo();
  const cvText = cvInfo.content || "";
  if (!jobText && !cvText) {
    setTokenEstimate(0);
    return;
  }

  const models = Array.isArray(settings?.models) ? settings.models : [];
  const selectedId = state.chosenModel || document.getElementById("modelSelect")?.value || "";
  const selected = models.find(m => m && m.id === selectedId) || null;
  const modelSystemPrompt = selected?.systemPrompt || "";

  const { sys, user } = buildPrompt({
    cv: cvText,
    systemTemplate: settings.systemTemplate || "",
    outputTemplate: settings.outputTemplate || "",
    modelSystemPrompt,
    text: jobText
  });

  const total = [sys, user].filter(Boolean).join('\n\n');
  const inputTokens = estimateTokens(total);
  const outputTokens = Number.isFinite(state.lastOutputTokens) ? Math.max(0, state.lastOutputTokens) : 0;
  setTokenEstimate(inputTokens + outputTokens);
}
