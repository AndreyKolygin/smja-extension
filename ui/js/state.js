// state.js — единое состояние и базовые утилиты
export const SETTINGS_KEY = "settings"; // в SW уже унифицировано на local.settings
export const state = {
  selectedText: "",
  lastResponse: "",
  timerId: 0,
  timerStart: 0,
  settings: null,
  chosenModel: null
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

  // Списки (простые)
  // Сначала группируем ul-блоки
  s = s.replace(/(^|\n)(?:-\s+.*(?:\n|$))+?/g, (block) => {
    const items = block.trim().split('\n').map(line => line.replace(/^-+\s+/, '').trim());
    const lis = items.map(it => `<li>${it}</li>`).join('');
    return `\n<ul>${lis}</ul>\n`;
  });

  // Нумерованные списки (ol)
  // Группируем ol-блоки
  s = s.replace(/(^|\n)((?:\d+\.\s+.*(?:\n|$))+)/g, (m, p1, block) => {
    const items = block.trim().split('\n').filter(Boolean);
    if (items.length === 0) return m;
    // Проверяем, что каждая строка начинается с "1. "
    if (!items.every(line => /^\d+\.\s+/.test(line))) return m;
    const lis = items.map(line => `<li>${line.replace(/^\d+\.\s+/, '').trim()}</li>`).join('');
    return `\n<ol>${lis}</ol>\n`;
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
// утилита для безопасной отрисовки результата в стилизованный блок
export function setResult(text) {
  const el = document.getElementById("resultView");
  if (el) el.innerHTML = mdToHtml(text || "");
}

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

export function setLastMeta(whenMs) {
  const el = document.getElementById("lastMeta");
  if (!el) return;
  if (!whenMs) { el.textContent = ""; return; }
  const sec = Math.max(0, (Date.now() - whenMs) / 1000).toFixed(1);
  el.textContent = `Last result • ${sec}s ago`;
}

export function setProgress(text) {
  const el = document.getElementById("progress");
  if (el) el.textContent = text || "";
}

export function startTimer(prefix = "Progress") {
  state.timerStart = performance.now();
  stopTimer();
  state.timerId = setInterval(() => {
    const ms = performance.now() - state.timerStart;
    setProgress(`${prefix}: ${ms.toFixed(0)} ms`);
  }, 100);
}

export function stopTimer(done = false, ms = 0) {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = 0;
  if (done) setProgress(`Done: ${(ms / 1000).toFixed(2)}s`);
}

export async function fetchSettings() {
  try { return await chrome.runtime.sendMessage({ type: "GET_SETTINGS" }); }
  catch { return null; }
}

export function setJobInput(text) {
  const el = document.getElementById("jobInput");
  if (el) el.value = text ?? "";
}

