// content/select.js — блочный хайлайтер для JDA

(() => {
  if (window.__JDA_BLOCK_HIGHLIGHTER__) return;
  window.__JDA_BLOCK_HIGHLIGHTER__ = true;

  const MENU_ID = 'jda-highlighter-menu';
  const HOVER_ID = 'jda-hover-overlay';
  const OVERLAY_CLASS = 'jda-highlight-overlay';
  const STYLE_ID = 'jda-highlighter-style';

  const state = {
    active: false,
    hover: null,
    menu: null,
    menuCard: null,
    highlights: [],
    undoStack: [],
    redoStack: [],
    orderSeq: 0,
    rafScheduled: false,
    style: null,
    lastPointer: { x: 0, y: 0 },
    lastAnalyzedBlockCount: null,
    cvs: [],
    selectedCvId: null,
    drag: {
      active: false,
      offsetX: 0,
      offsetY: 0,
      moveListener: null,
      upListener: null,
      handle: null,
      downListener: null,
      pointerId: null
    },
    localeCode: 'en'
  };

  const SEND_SILENT = true;

  const i18n = window.__JDA_I18N__ || {};
  const ensureLocaleLoaded = i18n.ensureLocaleLoaded || ((force, cb) => { if (cb) cb(); return Promise.resolve(); });
  const watchLocaleChanges = i18n.watchLocaleChanges || (() => {});
  const translate = i18n.t || ((key, fallback) => fallback || key);
  const getCurrentLang = i18n.currentLang || (() => 'en');
  const t = (key, fallback = '') => translate(key, fallback);

  state.localeCode = getCurrentLang();

  const refreshLocale = () => {
    state.localeCode = getCurrentLang();
    if (state.menu) updateMenu();
  };

  ensureLocaleLoaded(false, refreshLocale);
  watchLocaleChanges(() => ensureLocaleLoaded(true, refreshLocale));

  function safeSendMessage(message, cb) {
    try {
      if (!chrome?.runtime?.id) return;
      if (cb) {
        chrome.runtime.sendMessage(message, (...args) => {
          const err = chrome.runtime.lastError;
          if (!SEND_SILENT && err) console.warn('[JDA] sendMessage error:', err);
          if (!err) {
            try { cb(...args); } catch (e) { console.warn('[JDA] callback error:', e); }
          }
        });
      } else {
        chrome.runtime.sendMessage(message, () => {
          const err = chrome.runtime.lastError;
          if (!SEND_SILENT && err) console.warn('[JDA] sendMessage error:', err);
        });
      }
    } catch (e) {
      if (!SEND_SILENT) console.warn('[JDA] sendMessage threw:', e);
    }
  }

  function ensureStyleInjected() {
    if (state.style) return;
    const css = `
      html.jda-highlighter-active, html.jda-highlighter-active body {
        cursor: crosshair !important;
      }
      html.jda-highlighter-active #${MENU_ID} button {
        cursor: pointer !important;
      }
      #${HOVER_ID} {
        position: absolute;
        pointer-events: none;
        border: 2px dashed rgba(16, 185, 129, 0.9);
        border-radius: 6px;
        z-index: 2147483645;
        display: none;
      }
      .${OVERLAY_CLASS} {
        position: absolute;
        background: rgba(16, 185, 129, 0.28);
        border-radius: 6px;
        pointer-events: none;
        z-index: 2147483644;
      }
      #${MENU_ID} {
        --menu-bg: #1f2937;
        --menu-fg: #f8fafc;
        --menu-border: rgba(148, 163, 184, 0.2);
        --menu-shadow: 0 10px 28px rgba(15, 23, 42, 0.32);
        --menu-btn-bg: rgba(148, 163, 184, 0.22);
        --menu-btn-disabled: rgba(148, 163, 184, 0.12);
        --menu-counter-opacity: 0.7;
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        user-select: none;
        color: var(--menu-fg);
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        max-width: min(400px, calc(100vw - 24px));
        pointer-events: auto;
      }
      @media (prefers-color-scheme: light) {
        #${MENU_ID} {
          --menu-bg: #ffffff59;
          --menu-fg: #0f172a;
          --menu-border: rgba(15, 23, 42, 0.12);
          --menu-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
          --menu-btn-bg: rgba(15, 23, 42, 0.08);
          --menu-btn-disabled: rgba(15, 23, 42, 0.04);
          --menu-counter-opacity: 0.5;
        }
      }
      @media (prefers-color-scheme: dark) {
        #${MENU_ID} {
          --menu-bg: #1f2937b8;
          --menu-fg: #f8fafc;
          --menu-border: rgba(148, 163, 184, 0.2);
          --menu-shadow: 0 10px 28px rgba(15, 23, 42, 0.32);
          --menu-btn-bg: rgba(148, 163, 184, 0.22);
          --menu-btn-disabled: rgba(148, 163, 184, 0.12);
          --menu-counter-opacity: 0.75;
        }
      }
      #${MENU_ID}.jda-menu-dragging {
        cursor: grabbing;
      }
      #${MENU_ID} .jda-overlay-card {
        background: var(--menu-bg);
        border-radius: 24px;
        padding: 12px 14px;
        box-shadow: var(--menu-shadow);
        display: flex;
        flex-direction: column;
        gap: 10px;
        border: 1px solid var(--menu-border);
        color: var(--menu-fg);
        backdrop-filter: blur(15px);
      }
      #${MENU_ID} .cv-select-row {
        display: flex;
        flex-direction: row;
        flex-wrap: nowrap;
        align-items: center;
        gap: 8px;
      }
      #${MENU_ID} .cv-select-row label {
        white-space: nowrap;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
      }
      #${MENU_ID} .cv-select-row select {
        width: 100%;
        border-radius: 12px;
        border: 1px solid var(--menu-border);
        padding: 6px 10px;
        background: transparent;
        color: var(--menu-fg);
      }
      #${MENU_ID} .jda-overlay-header {
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: grab;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      #${MENU_ID}.jda-menu-dragging .jda-overlay-header {
        cursor: grabbing;
      }
      #${MENU_ID} .jda-overlay-title {
        flex: 1;
        text-transform: none;
      }
      #${MENU_ID} .button-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-start;
      }
      #${MENU_ID} button {
        border: none;
        border-radius: 20px;
        padding: 6px 12px;
        background: var(--menu-btn-bg);
        color: var(--menu-fg);
        font: inherit;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }
      #${MENU_ID} button:disabled {
        opacity: 0.5;
        background: var(--menu-btn-disabled);
        cursor: default !important;
      }
      #${MENU_ID} button.primary {
        background: #0ea5e9;
        color: #0f172a;
      }
      #${MENU_ID} button.danger {
        background: rgba(239, 68, 68, 0.18);
        color: #e58b8b;
      }
      #${MENU_ID} button.neutral {
        background: rgba(148, 163, 184, 0.15);
      }
      #${MENU_ID} button[data-action="analyze"] {
        flex: 1 1 150px;
        min-width: 190px;
        justify-content: center;
        font-weight: 600;
        gap: 8px;
        background: linear-gradient(135deg, #0f766e, #0ea5e9);
        color: #fff;
      }
      #${MENU_ID} button[data-action="analyze"]:hover {
        background: linear-gradient(135deg, #0c5e59, #0b82b8);
      }
      #${MENU_ID} .analyze-btn .icon {
        width: 16px;
        height: 16px;
        display: inline-block;
        background: currentColor;
        -webkit-mask: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M7.5 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3zm9 8l1.2 3.8L21.5 17l-3.3 1.2L17 22l-1.2-3.8L12.5 17l3.3-1.2L16.5 12zM13 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z' fill='white'/%3E%3C/svg%3E") center / contain no-repeat;
        mask: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M7.5 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3zm9 8l1.2 3.8L21.5 17l-3.3 1.2L17 22l-1.2-3.8L12.5 17l3.3-1.2L16.5 12zM13 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z' fill='white'/%3E%3C/svg%3E") center / contain no-repeat;
      }
      #${MENU_ID} .jda-overlay-header button[data-action="cancel"] {
        border-radius: 999px;
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--menu-btn-bg);
        color: var(--menu-fg);
        padding: 0;
        min-width: 28px;
      }
      #${MENU_ID} .jda-overlay-header button[data-action="cancel"]:hover {
        background: var(--menu-btn-disabled);
      }
      #${MENU_ID} .counter {
        opacity: var(--menu-counter-opacity);
        margin-left: auto;
        min-width: 72px;
        text-align: right;
      }
      #${MENU_ID} .hint {
        font-size: 12px;
        opacity: 0.7;
        text-align: center;
      }
    `;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
   document.documentElement.appendChild(style);
   state.style = style;
 }

  function formatCounter(count) {
    const base = 'ui.highlighter.counter';
    let key = `${base}.many`;
    if (count === 0) key = `${base}.zero`;
    else if ((state.localeCode || 'en').startsWith('ru')) {
      const mod10 = count % 10;
      const mod100 = count % 100;
      if (mod10 === 1 && mod100 !== 11) key = `${base}.one`;
      else if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) key = `${base}.few`;
      else key = `${base}.many`;
    } else if (count === 1) {
      key = `${base}.one`;
    }
    const fallback = count === 1 ? `${count} block` : `${count} blocks`;
    const template = t(key, fallback);
    return template.replace('{{count}}', String(count));
  }

  function setAnalyzeButtonLabel(btn, text) {
    if (!btn) return;
    const labelNode = btn.querySelector('.label');
    if (labelNode) labelNode.textContent = text;
    else btn.textContent = text;
  }

  function setAnalyzeIdle(btn) {
    if (!btn) return;
    delete btn.dataset.doneSeconds;
    const label = t('ui.highlighter.analyze', 'Analyze');
    setAnalyzeButtonLabel(btn, label);
  }

  function setAnalyzeRunning(btn, seconds) {
    if (!btn) return;
    const label = t('ui.highlighter.timer', '{{seconds}}s…');
    setAnalyzeButtonLabel(btn, label.replace('{{seconds}}', seconds.toFixed(1)));
  }

  function setAnalyzeDone(btn, seconds) {
    if (!btn) return;
    const label = t('ui.highlighter.analyzeDone', 'Done: {{seconds}}s');
    btn.dataset.doneSeconds = String(seconds.toFixed(2));
    setAnalyzeButtonLabel(btn, label.replace('{{seconds}}', seconds.toFixed(2)));
  }

  function createMenu() {
    if (state.menu) return;
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = '';
    const titleText = t('ui.highlighter.title', 'Select job description');
    const closeTitle = t('ui.highlighter.close', 'Cancel selection');
    const undoLabel = t('ui.highlighter.undo', 'Undo');
    const redoLabel = t('ui.highlighter.redo', 'Redo');
    const clearLabel = t('ui.highlighter.clear', 'Clear');
    const analyzeLabel = t('ui.highlighter.analyze', 'Analyze');
    const counterLabel = formatCounter(0);
    const hintLabel = t('ui.highlighter.hint', 'Open the extension to read the result');
    const cvLabel = t('ui.highlighter.cvLabel', 'Resume');
    const cvLoading = t('ui.highlighter.cvLoading', 'Loading…');
    menu.innerHTML = `
      <div class="jda-overlay-card">
        <div class="jda-overlay-header" data-drag-handle>
          <span class="jda-overlay-title" data-i18n="ui.highlighter.title">${titleText}</span>
          <button type="button" data-action="cancel" title="${closeTitle}">✕</button>
        </div>
        <div class="cv-select-row">
          <label for="jdaCvSelect" data-i18n="ui.highlighter.cvLabel">${cvLabel}</label>
          <select id="jdaCvSelect">
            <option value="">${cvLoading}</option>
          </select>
        </div>
        <div class="button-row">
          <button type="button" data-action="undo" disabled data-i18n="ui.highlighter.undo">${undoLabel}</button>
          <button type="button" data-action="redo" disabled data-i18n="ui.highlighter.redo">${redoLabel}</button>
          <button type="button" data-action="clear" class="danger" disabled data-i18n="ui.highlighter.clear">${clearLabel}</button>
          <span class="counter" data-count="0">${counterLabel}</span>
          <button type="button" data-action="analyze" class="primary analyze-btn icon-left i-magic" data-i18n="ui.highlighter.analyze">
            <span class="icon"></span>
            <span class="label">${analyzeLabel}</span>
          </button>
        </div>
        <div class="hint" hidden data-i18n="ui.highlighter.hint">${hintLabel}</div>
      </div>
    `;
    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      switch (action) {
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'clear':
          clearHighlights();
          break;
        case 'analyze':
          startAnalyze();
          break;
        case 'cancel':
          cancelSelection(false);
          break;
        default:
          break;
      }
    }, true);
    menu.style.left = '50%';
    menu.style.top = '16px';
    menu.style.transform = 'translateX(-50%)';
    menu.classList.remove('jda-menu-dragging');

    const handle = menu.querySelector('[data-drag-handle]');
    if (handle) {
      const onPointerMove = (event) => {
        if (!state.drag.active) return;
        event.preventDefault();
        const menuRect = state.menuCard?.getBoundingClientRect();
        const width = menuRect ? menuRect.width : state.menu?.offsetWidth || 0;
        const height = menuRect ? menuRect.height : state.menu?.offsetHeight || 0;
        const maxLeft = Math.max(8, window.innerWidth - width - 8);
        const maxTop = Math.max(8, window.innerHeight - height - 8);
        const left = Math.min(maxLeft, Math.max(8, event.clientX - state.drag.offsetX));
        const top = Math.min(maxTop, Math.max(8, event.clientY - state.drag.offsetY));
        state.menu.style.left = `${left}px`;
        state.menu.style.top = `${top}px`;
      };
      const onPointerUp = () => {
        if (!state.drag.active) return;
        state.drag.active = false;
        menu.classList.remove('jda-menu-dragging');
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerUp, true);
        state.drag.moveListener = null;
        state.drag.upListener = null;
        if (state.drag.pointerId != null) {
          handle.releasePointerCapture?.(state.drag.pointerId);
        }
        state.drag.pointerId = null;
      };
      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('button')) return;
        event.preventDefault();
        const rect = menu.getBoundingClientRect();
        state.drag.active = true;
        state.drag.offsetX = event.clientX - rect.left;
        state.drag.offsetY = event.clientY - rect.top;
        state.drag.pointerId = event.pointerId;
        menu.classList.add('jda-menu-dragging');
        const limitedLeft = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));
        const limitedTop = Math.max(8, Math.min(rect.top, window.innerHeight - rect.height - 8));
        state.drag.offsetX = event.clientX - limitedLeft;
        state.drag.offsetY = event.clientY - limitedTop;
        const newLeft = `${limitedLeft}px`;
        const newTop = `${limitedTop}px`;
        menu.style.left = newLeft;
        menu.style.top = newTop;
        menu.style.transform = 'none';
        state.menu.style.left = newLeft;
        state.menu.style.top = newTop;
        handle.setPointerCapture?.(event.pointerId);
        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', onPointerUp, true);
        window.addEventListener('pointercancel', onPointerUp, true);
        state.drag.moveListener = onPointerMove;
        state.drag.upListener = onPointerUp;
      };
      handle.addEventListener('pointerdown', onPointerDown, true);
      state.drag.handle = handle;
      state.drag.downListener = onPointerDown;
    }

    document.body.appendChild(menu);
    state.menu = menu;
    state.menuCard = menu.querySelector('.jda-overlay-card');
    initCvSelector();
    updateMenu();
  }

  function persistCvSelection(id) {
    if (!chrome?.storage?.local) return;
    try {
      chrome.storage.local.get(['ui'], (res) => {
        const ui = Object.assign({}, res?.ui || {}, { chosenCvId: id || null });
        chrome.storage.local.set({ ui }, () => {});
      });
    } catch {}
  }
  let cvStorageWatcherAttached = false;

  function attachCvStorageWatcher() {
    if (cvStorageWatcherAttached || !chrome?.storage?.onChanged) return;
    cvStorageWatcherAttached = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.ui) {
        const newId = changes.ui.newValue?.chosenCvId || null;
        if (newId && newId !== state.selectedCvId) {
          state.selectedCvId = newId;
          renderCvSelectOptions();
        }
      }
      if (changes.settings?.newValue) {
        updateCvState(changes.settings.newValue, state.selectedCvId);
      }
    });
  }

  function updateCvState(settings, storedId = null) {
    const list = Array.isArray(settings?.cvs) ? settings.cvs : [];
    state.cvs = list;
    const candidates = new Set(
      list
        .filter(cv => cv && cv.id)
        .map(cv => cv.id)
    );
    const initial = state.selectedCvId && candidates.has(state.selectedCvId)
      ? state.selectedCvId
      : null;
    let next = initial;
    if (!next && storedId && candidates.has(storedId)) next = storedId;
    if (!next && settings?.activeCvId && candidates.has(settings.activeCvId)) {
      next = settings.activeCvId;
    }
    if (!next && list[0]?.id) next = list[0].id;
    state.selectedCvId = next || null;
    renderCvSelectOptions();
  }

  function renderCvSelectOptions() {
    const select = state.menu?.querySelector('#jdaCvSelect');
    if (!select) return;
    select.innerHTML = '';
    if (!state.cvs.length) {
      const opt = document.createElement('option');
      opt.textContent = t('ui.highlighter.cvMissing', 'Add a resume in Options → CV & Prompts');
      opt.disabled = true;
      opt.selected = true;
      select.appendChild(opt);
      select.disabled = true;
      return;
    }
    state.cvs.forEach((cv, idx) => {
      if (!cv || !cv.id) return;
      const option = document.createElement('option');
      option.value = cv.id;
      option.textContent = cv.title?.trim() || t('ui.highlighter.cvUntitled', 'CV {{index}}').replace('{{index}}', idx + 1);
      select.appendChild(option);
    });
    const targetId = state.selectedCvId && state.cvs.some(cv => cv.id === state.selectedCvId)
      ? state.selectedCvId
      : state.cvs[0]?.id || '';
    state.selectedCvId = targetId || null;
    if (targetId) select.value = targetId;
    select.disabled = false;
  }

  function initCvSelector() {
    const select = state.menu?.querySelector('#jdaCvSelect');
    if (!select) return;
    select.addEventListener('change', () => {
      state.selectedCvId = select.value || null;
      persistCvSelection(state.selectedCvId);
    }, true);

    const applySettings = (settings, storedId) => {
      if (!settings) return;
      updateCvState(settings, storedId);
    };

    try {
      chrome.storage.local.get(['settings', 'ui'], (res) => {
        const storedId = res?.ui?.chosenCvId || null;
        if (res?.settings) applySettings(res.settings, storedId);
        safeSendMessage({ type: 'GET_SETTINGS' }, (settings) => {
          applySettings(settings, storedId);
        });
      });
    } catch {
      safeSendMessage({ type: 'GET_SETTINGS' }, (settings) => applySettings(settings, null));
    }
    attachCvStorageWatcher();
  }

  function resolveCvForAnalyze(settings) {
    const list = Array.isArray(settings?.cvs) ? settings.cvs : [];
    if (!list.length) {
      state.selectedCvId = null;
      return { cvText: '', cvId: '', cvTitle: '' };
    }
    const hasCandidate = (id) => !!id && list.some(cv => cv.id === id);
    let preferred = hasCandidate(state.selectedCvId) ? state.selectedCvId : null;
    if (!preferred && hasCandidate(settings?.activeCvId)) preferred = settings.activeCvId;
    if (!preferred) preferred = list[0].id;
    state.selectedCvId = preferred || null;
    const entry = list.find(cv => cv.id === preferred) || list[0];
    return {
      cvText: entry?.content || '',
      cvId: entry?.id || '',
      cvTitle: entry?.title || ''
    };
  }

  function destroyMenu() {
    if (state.drag.handle && state.drag.downListener) {
      state.drag.handle.removeEventListener('pointerdown', state.drag.downListener, true);
    }
    if (state.drag.moveListener) {
      window.removeEventListener('pointermove', state.drag.moveListener, true);
    }
    if (state.drag.upListener) {
      window.removeEventListener('pointerup', state.drag.upListener, true);
      window.removeEventListener('pointercancel', state.drag.upListener, true);
    }
    state.drag = {
      active: false,
      offsetX: 0,
      offsetY: 0,
      moveListener: null,
      upListener: null,
      handle: null,
      downListener: null,
      pointerId: null
    };
    if (state.menu?.parentNode) state.menu.parentNode.removeChild(state.menu);
    state.menu = null;
    state.menuCard = null;
  }

  function updateMenu() {
    if (!state.menu) return;
    const count = state.highlights.length;
    const counter = state.menu.querySelector('.counter');
    if (counter) {
      counter.dataset.count = String(count);
      counter.textContent = formatCounter(count);
    }
    const undoBtn = state.menu.querySelector('button[data-action="undo"]');
    const redoBtn = state.menu.querySelector('button[data-action="redo"]');
    const clearBtn = state.menu.querySelector('button[data-action="clear"]');
    const analyzeBtn = state.menu.querySelector('button[data-action="analyze"]');
    const hint = state.menu.querySelector('.hint');
    if (undoBtn) {
      undoBtn.disabled = state.undoStack.length === 0;
      undoBtn.textContent = t('ui.highlighter.undo', undoBtn.textContent || 'Undo');
    }
    if (redoBtn) {
      redoBtn.disabled = state.redoStack.length === 0;
      redoBtn.textContent = t('ui.highlighter.redo', redoBtn.textContent || 'Redo');
    }
    if (clearBtn) {
      clearBtn.disabled = count === 0;
      clearBtn.textContent = t('ui.highlighter.clear', clearBtn.textContent || 'Clear');
    }
    if (analyzeBtn) {
      if (state.analyzing) {
        analyzeBtn.disabled = true;
        const elapsed = Math.max(0, (performance.now() - state.analyzing.start) / 1000);
        setAnalyzeRunning(analyzeBtn, elapsed);
        if (hint) hint.hidden = true;
      } else {
        const mode = analyzeBtn.dataset.mode || '';
        if (mode === 'done') {
          analyzeBtn.disabled = true;
          const stored = parseFloat(analyzeBtn.dataset.doneSeconds);
          const seconds = Number.isFinite(stored) ? stored : 0;
          setAnalyzeDone(analyzeBtn, seconds);
          if (hint) hint.hidden = false;
        } else {
          analyzeBtn.disabled = count === 0;
          setAnalyzeIdle(analyzeBtn);
          if (hint) hint.hidden = true;
        }
      }
    } else if (hint) {
      hint.hidden = true;
    }
    const cancelBtn = state.menu.querySelector('button[data-action="cancel"]');
    if (cancelBtn) cancelBtn.disabled = false;

    if (hint) {
      const text = t('ui.highlighter.hint', hint.textContent || '');
      if (text) hint.textContent = text;
    }
    const titleNode = state.menu.querySelector('[data-i18n="ui.highlighter.title"]');
    if (titleNode) {
      const titleText = t('ui.highlighter.title', titleNode.textContent || '');
      if (titleText) titleNode.textContent = titleText;
    }
    const closeBtn = state.menu.querySelector('.jda-overlay-header button[data-action="cancel"]');
    if (closeBtn) {
      const titleAttr = t('ui.highlighter.close', closeBtn.title || '');
      if (titleAttr) closeBtn.title = titleAttr;
    }
  }

  function ensureHoverOverlay() {
    let hover = document.getElementById(HOVER_ID);
    if (!hover) {
      hover = document.createElement('div');
      hover.id = HOVER_ID;
      document.body.appendChild(hover);
    }
    return hover;
  }

  function removeHover() {
    const hover = document.getElementById(HOVER_ID);
    if (hover) hover.style.display = 'none';
    state.hover = null;
  }

  function setHover(element) {
    if (!state.active) return;
    if (!element || !element.getBoundingClientRect) {
      removeHover();
      return;
    }
    if (state.hover === element) {
      updateHoverPosition();
      return;
    }
    state.hover = element;
    updateHoverPosition();
  }

  function updateHoverPosition() {
    if (!state.hover) return;
    const rect = state.hover.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) {
      removeHover();
      return;
    }
    const hover = ensureHoverOverlay();
    hover.style.display = 'block';
    hover.style.left = `${rect.left + window.scrollX}px`;
    hover.style.top = `${rect.top + window.scrollY}px`;
    hover.style.width = `${rect.width}px`;
    hover.style.height = `${rect.height}px`;
  }

  function createOverlay(rect) {
    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.style.left = `${rect.left + window.scrollX}px`;
    overlay.style.top = `${rect.top + window.scrollY}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function extractText(element) {
    if (!element) return '';
    const text = element.innerText || element.textContent || '';
    return text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function getUniqueSelector(element) {
    if (!element || element.nodeType !== 1) return '';
    if (element.id) {
      const idSafe = element.id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      return `#${idSafe}`;
    }
    const parts = [];
    let el = element;
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      let part = el.tagName.toLowerCase();
      const className = (el.className && typeof el.className === 'string')
        ? el.className.trim().split(/\s+/).filter(Boolean)[0]
        : null;
      if (className) part += `.${className.replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`;
      const siblings = Array.from(el.parentElement.children).filter(child => child.tagName === el.tagName);
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(el) + 1})`;
      }
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }

  function collectRects(element) {
    const rects = Array.from(element.getClientRects()).filter(r => r.width && r.height);
    if (rects.length) return rects;
    const rect = element.getBoundingClientRect();
    return rect.width && rect.height ? [rect] : [];
  }

  function refreshHighlightGeometry(highlight) {
    highlight.overlays.forEach(el => el.remove());
    const rects = collectRects(highlight.element);
    highlight.overlays = rects.map(createOverlay);
    highlight.rects = rects.map(r => ({ left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height }));
    highlight.text = extractText(highlight.element);
    highlight.html = highlight.element.innerHTML;
  }

  function createHighlight(element, opts = { record: true, order: null }) {
    if (!element || element.dataset.jdaHighlight === '1') return null;
    const highlight = {
      element,
      overlays: [],
      rects: [],
      text: '',
      html: '',
      selector: getUniqueSelector(element),
      order: typeof opts.order === 'number' ? opts.order : state.orderSeq++
    };
    element.dataset.jdaHighlight = '1';
    refreshHighlightGeometry(highlight);
    state.highlights.push(highlight);
    if (opts.record) {
      state.undoStack.push({ type: 'add', highlight });
      state.redoStack = [];
    }
    updateMenu();
    requestRefresh();
    return highlight;
  }

  function removeHighlight(highlight, record = true) {
    if (!highlight) return;
    highlight.overlays.forEach(el => el.remove());
    highlight.overlays = [];
    if (highlight.element?.dataset) delete highlight.element.dataset.jdaHighlight;
    state.highlights = state.highlights.filter(h => h !== highlight);
    if (record) {
      state.undoStack.push({ type: 'remove', highlight });
      state.redoStack = [];
    }
    updateMenu();
    requestRefresh();
  }

  function findHighlightByElement(element) {
    return state.highlights.find(h => h.element === element);
  }

  function toggleHighlight(element) {
    if (!element) return;
    const existing = findHighlightByElement(element);
    if (existing) {
      removeHighlight(existing, true);
    } else {
      createHighlight(element, { record: true });
    }
  }

  function undo() {
    const action = state.undoStack.pop();
    if (!action) return;
    if (action.type === 'add') {
      removeHighlight(action.highlight, false);
      state.redoStack.push(action);
    } else if (action.type === 'remove') {
      const highlight = action.highlight;
      if (highlight?.element?.isConnected) {
        const recreated = createHighlight(highlight.element, { record: false, order: highlight.order });
        if (recreated) action.highlight = recreated;
      }
      state.redoStack.push(action);
    } else if (action.type === 'clear') {
      handleUndoClear(action);
      state.redoStack.push(action);
    }
    updateMenu();
  }

  function redo() {
    const action = state.redoStack.pop();
    if (!action) return;
    if (action.type === 'add') {
      if (action.highlight?.element?.isConnected) {
        const recreated = createHighlight(action.highlight.element, { record: false, order: action.highlight.order });
        if (recreated) action.highlight = recreated;
        state.undoStack.push(action);
      }
    } else if (action.type === 'remove') {
      removeHighlight(action.highlight, false);
      state.undoStack.push(action);
    } else if (action.type === 'clear') {
      handleRedoClear(action);
      state.undoStack.push(action);
    }
    updateMenu();
  }

  function clearHighlights(record = true) {
    const snapshot = [...state.highlights];
    snapshot.forEach(h => removeHighlight(h, false));
    if (record && snapshot.length) {
      state.undoStack.push({ type: 'clear', highlights: snapshot });
      state.redoStack = [];
    }
    updateMenu();
  }

  function handleUndoClear(action) {
    (action.highlights || []).forEach((h, idx) => {
      if (h.element?.isConnected) {
        const recreated = createHighlight(h.element, { record: false, order: h.order });
        if (recreated) action.highlights[idx] = recreated;
      }
    });
    updateMenu();
  }

  function handleRedoClear(action) {
    (action.highlights || []).forEach(h => {
      if (!h) return;
      if (state.highlights.includes(h)) removeHighlight(h, false);
      else {
        const current = findHighlightByElement(h.element);
        if (current) removeHighlight(current, false);
      }
    });
    updateMenu();
  }

  function requestRefresh() {
    if (state.rafScheduled) return;
    state.rafScheduled = true;
    requestAnimationFrame(() => {
      state.rafScheduled = false;
      state.highlights.forEach(refreshHighlightGeometry);
      updateHoverPosition();
      resetAnalyzeStateIfNeeded();
    });
  }

  function resetAnalyzeStateIfNeeded() {
    const analyzeBtn = state.menu?.querySelector('button[data-action="analyze"]');
    if (!analyzeBtn || analyzeBtn.dataset.mode !== 'done') return;
    const count = state.highlights.length;
    if (count && state.lastAnalyzedBlockCount === count) return;
    analyzeBtn.dataset.mode = '';
    delete analyzeBtn.dataset.doneSeconds;
    setAnalyzeIdle(analyzeBtn);
    analyzeBtn.disabled = count === 0;
    state.lastAnalyzedBlockCount = null;
    updateMenu();
  }

  function getTargetFromPointer(event) {
    const x = event.clientX ?? (event.touches?.[0]?.clientX) ?? state.lastPointer.x;
    const y = event.clientY ?? (event.touches?.[0]?.clientY) ?? state.lastPointer.y;
    state.lastPointer = { x, y };
    let el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.closest(`#${MENU_ID}`)) return null;
    if (el.id === HOVER_ID) return state.hover;
    el = refineTarget(el);
    return el;
  }

  function refineTarget(element) {
    if (!element || element === document.body || element === document.documentElement) return null;
    if (element.closest(`#${MENU_ID}`)) return null;
    if (element.classList?.contains('jda-highlight-overlay')) return null;
    let el = element;
    while (el && el !== document.body && el !== document.documentElement) {
      const tag = el.tagName?.toUpperCase?.();
      if (!tag || ['SCRIPT', 'STYLE', 'HEAD', 'HTML'].includes(tag)) return null;
      if (tag === 'BODY') return null;
      const display = window.getComputedStyle(el).display;
      if (display !== 'inline') return el;
      el = el.parentElement;
    }
    return null;
  }

  function handlePointerMove(event) {
    if (!state.active) return;
    const target = getTargetFromPointer(event);
    if (!target || target.closest('#jda-app-overlay') || target.closest(`#${MENU_ID}`)) {
      setHover(null);
      return;
    }
    setHover(target);
  }

  function handleClick(event) {
    if (!state.active) return;
    if (event.target.closest(`#${MENU_ID}`) || event.target.closest('#jda-app-overlay')) return;
    const target = getTargetFromPointer(event);
    if (!target || target.closest('#jda-app-overlay') || target.closest(`#${MENU_ID}`)) {
      removeHover();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    toggleHighlight(target);
  }

  function handleKeydown(event) {
    if (!state.active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelSelection(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      startAnalyze();
    }
  }

  function startAnalyze() {
    if (state.analyzing) return;
    const { text } = finishSelection();
    if (!text) {
      alert(t('ui.highlighter.alertNoBlocks', 'Select at least one block before analyzing.'));
      return;
    }

    const analyzeBtn = state.menu?.querySelector('button[data-action="analyze"]');
    if (!analyzeBtn) return;

    analyzeBtn.dataset.mode = '';
    delete analyzeBtn.dataset.doneSeconds;
    analyzeBtn.disabled = true;
    state.analyzing = { start: performance.now() };
    let timerId = 0;

    const updateTimer = () => {
      if (!state.analyzing) return;
      const elapsed = Math.max(0, (performance.now() - state.analyzing.start) / 1000);
      setAnalyzeRunning(analyzeBtn, elapsed);
    };
    updateTimer();
    timerId = window.setInterval(updateTimer, 100);

    safeSendMessage({ type: 'SELECTION_ANALYZE', text });

    chrome.storage.local.get(['ui'], (localData) => {
      const localChosen = localData?.ui?.chosenModel || null;
      safeSendMessage({ type: 'GET_SETTINGS' }, (settings) => {
        const clearTimer = () => {
          if (timerId) {
            clearInterval(timerId);
            timerId = 0;
          }
        };
        try {
          const s = settings || {};
          const models = Array.isArray(s.models) ? s.models.filter(m => m && m.active) : [];
          if (!models.length) {
            throw new Error(t('ui.highlighter.errorNoModel', 'No active model configured. Open Settings to activate a model.'));
          }
          state.cvs = Array.isArray(s.cvs) ? s.cvs : [];
          const cvMeta = resolveCvForAnalyze(s);
          renderCvSelectOptions();
          const chosenId = localChosen || s.ui?.chosenModel || s.chosenModel || models[0].id;
          const modelMeta = models.find(m => m.id === chosenId) || models[0];
          const provider = Array.isArray(s.providers) ? s.providers.find(p => p.id === modelMeta.providerId) : null;
          if (!provider) {
            throw new Error(t('ui.highlighter.errorNoProvider', 'Provider for the selected model is missing.'));
          }

          const callPayload = {
            modelId: modelMeta.modelId,
            providerId: modelMeta.providerId,
            cv: cvMeta.cvText || '',
            cvId: cvMeta.cvId || '',
            cvTitle: cvMeta.cvTitle || '',
            systemTemplate: s.systemTemplate || '',
            outputTemplate: s.outputTemplate || '',
            modelSystemPrompt: modelMeta.systemPrompt || '',
            text
          };

          safeSendMessage({ type: 'CALL_LLM', payload: callPayload }, (resp) => {
            clearTimer();
            const startedAt = state.analyzing?.start || performance.now();
            const elapsedMs = Math.max(0, performance.now() - startedAt);
            state.analyzing = null;
            const effectiveMs = Number.isFinite(resp?.ms) ? Math.max(0, resp.ms) : elapsedMs;
            const elapsedSeconds = effectiveMs / 1000;

            if (resp?.ok) {
              try {
                chrome.storage.local.set({ lastResult: { text: resp.text, when: Date.now(), ms: effectiveMs } }, () => {});
              } catch {}
              safeSendMessage({ type: 'LLM_RESULT', text: resp.text });
              setAnalyzeDone(analyzeBtn, elapsedSeconds);
              analyzeBtn.dataset.mode = 'done';
              analyzeBtn.disabled = true;
              state.lastAnalyzedBlockCount = state.highlights.length;
              updateMenu();
            } else {
              const rawError = resp?.error ? String(resp.error) : '';
              const message = rawError
                ? t('ui.highlighter.errorLLM', 'LLM error: {{message}}').replace('{{message}}', rawError)
                : t('ui.highlighter.errorStart', 'Failed to start analysis.');
              alert(message);
              analyzeBtn.dataset.mode = '';
              setAnalyzeIdle(analyzeBtn);
              analyzeBtn.disabled = state.highlights.length === 0;
              updateMenu();
            }
          });
        } catch (err) {
          clearTimer();
          state.analyzing = null;
          analyzeBtn.dataset.mode = '';
          setAnalyzeIdle(analyzeBtn);
          analyzeBtn.disabled = state.highlights.length === 0;
          const fallback = t('ui.highlighter.errorStart', 'Failed to start analysis.');
          const message = err?.message || (err ? String(err) : '') || fallback;
          alert(message || fallback);
          updateMenu();
        }
      });
    });
  }

  function finishSelection() {
    const ordered = [...state.highlights].sort((a, b) => a.order - b.order);
    const text = ordered.map(h => h.text).filter(Boolean).join('\n\n').trim();
    const blocks = ordered.map(h => ({
      text: h.text,
      html: h.html,
      selector: h.selector,
      rects: h.rects,
      order: h.order
    }));
    if (text) {
      try {
        chrome.storage.local.set({
          lastSelection: text,
          lastSelectionBlocks: blocks,
          lastSelectionWhen: Date.now()
        }, () => {});
      } catch {}
    }
    safeSendMessage({ type: 'SELECTION_RESULT', text, blocks });
    return { text, blocks };
  }

  function cancelSelection(clearResult = false) {
    if (!state.active) {
      if (clearResult) {
        safeSendMessage({ type: 'SELECTION_RESULT', text: '', blocks: [] });
      }
      return;
    }
    if (clearResult) {
      safeSendMessage({ type: 'SELECTION_RESULT', text: '', blocks: [] });
    }
    deactivate();
  }

  function activate() {
    if (state.active) return;
    ensureStyleInjected();
    createMenu();
    ensureLocaleLoaded().then(() => {
      if (state.active) updateMenu();
    });
    state.highlights = [];
    state.undoStack = [];
    state.redoStack = [];
    state.orderSeq = 0;
    document.documentElement.classList.add('jda-highlighter-active');
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('mousemove', handlePointerMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('scroll', requestRefresh, true);
    window.addEventListener('resize', requestRefresh, true);
    state.observer = new MutationObserver(() => requestRefresh());
    try { state.observer.observe(document.body, { childList: true, subtree: true, attributes: true }); } catch {}
    state.active = true;
  }

  function deactivate() {
    state.analyzing = null;
    state.active = false;
    document.documentElement.classList.remove('jda-highlighter-active');
    document.removeEventListener('pointermove', handlePointerMove, true);
    document.removeEventListener('mousemove', handlePointerMove, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeydown, true);
    window.removeEventListener('scroll', requestRefresh, true);
    window.removeEventListener('resize', requestRefresh, true);
    if (state.observer) try { state.observer.disconnect(); } catch {}
    state.observer = null;
    removeHover();
    clearHighlights(false);
    state.undoStack = [];
    state.redoStack = [];
    destroyMenu();
  }

  function cancelExternal() {
    cancelSelection(true);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === '__PING__') {
      sendResponse?.({ ok: true });
      return;
    }
    if (message?.type === 'START_SELECTION') {
      activate();
      sendResponse?.({ ok: true });
      return;
    }
    if (message?.type === 'CLEAR_SELECTION') {
      cancelExternal();
      sendResponse?.({ ok: true });
      return;
    }
  });
})();
