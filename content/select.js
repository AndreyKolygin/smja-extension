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
    highlights: [],
    undoStack: [],
    redoStack: [],
    orderSeq: 0,
    rafScheduled: false,
    style: null,
    lastPointer: { x: 0, y: 0 },
    lastAnalyzedBlockCount: null
  };

  function t(key, fallback = '') {
    try {
      return chrome.i18n?.getMessage?.(key) || fallback || key;
    } catch {
      return fallback || key;
    }
  }

  const SEND_SILENT = true;

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
      html.jda-highlighter-active .jda-highlighter-menu button {
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
      .jda-highlighter-menu {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 12px;
        border-radius: 24px;
        background: #1f2937;
        color: #f8fafc;
        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.25);
        z-index: 2147483646;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        user-select: none;
      }
      .jda-highlighter-menu .button-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .jda-highlighter-menu button {
        border: none;
        border-radius: 20px;
        padding: 6px 12px;
        background: rgba(148, 163, 184, 0.2);
        color: inherit;
        font: inherit;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .jda-highlighter-menu button:disabled {
        opacity: 0.4;
        cursor: default !important;
      }
      .jda-highlighter-menu button.primary {
        background: #0ea5e9;
        color: #0f172a;
      }
      .jda-highlighter-menu button.danger {
        background: rgba(239, 68, 68, 0.18);
        color: #fecaca;
      }
      .jda-highlighter-menu button.neutral {
        background: rgba(148, 163, 184, 0.15);
      }
      .jda-highlighter-menu .counter {
        opacity: 0.7;
      }
      .jda-highlighter-menu .hint {
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

  function createMenu() {
    if (state.menu) return;
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'jda-highlighter-menu';
    menu.innerHTML = `
      <div class="button-row">
        <button type="button" data-action="undo" disabled>Undo</button>
        <button type="button" data-action="redo" disabled>Redo</button>
        <button type="button" data-action="clear" class="danger" disabled>Clear</button>
        <span class="counter">0 blocks</span>
        <button type="button" data-action="analyze" class="primary">Analyze</button>
        <button type="button" data-action="cancel" class="neutral" title="Cancel">✕</button>
      </div>
      <div class="hint" hidden data-i18n="ui.highlighter.hint">Open the extension to read the result</div>
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
          cancelSelection();
          break;
        default:
          break;
      }
    }, true);
    document.body.appendChild(menu);
    state.menu = menu;
    updateMenu();
  }

  function destroyMenu() {
    if (state.menu?.parentNode) state.menu.parentNode.removeChild(state.menu);
    state.menu = null;
  }

  function updateMenu() {
    if (!state.menu) return;
    const count = state.highlights.length;
    const counter = state.menu.querySelector('.counter');
    if (counter) counter.textContent = count === 1 ? '1 block' : `${count} blocks`;
    const undoBtn = state.menu.querySelector('button[data-action="undo"]');
    const redoBtn = state.menu.querySelector('button[data-action="redo"]');
    const clearBtn = state.menu.querySelector('button[data-action="clear"]');
    const analyzeBtn = state.menu.querySelector('button[data-action="analyze"]');
    const hint = state.menu.querySelector('.hint');
    if (undoBtn) undoBtn.disabled = state.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = state.redoStack.length === 0;
    if (clearBtn) clearBtn.disabled = count === 0;
    if (analyzeBtn && !state.analyzing) {
      const mode = analyzeBtn.dataset.mode || '';
      if (mode === 'done') {
        analyzeBtn.disabled = true;
        if (hint) hint.hidden = false;
      } else {
        analyzeBtn.disabled = count === 0;
        if (hint) hint.hidden = true;
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
    analyzeBtn.textContent = 'Analyze';
    analyzeBtn.disabled = count === 0;
    state.lastAnalyzedBlockCount = null;
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
    setHover(target);
  }

  function handleClick(event) {
    if (!state.active) return;
    if (event.target.closest(`#${MENU_ID}`)) return;
    const target = getTargetFromPointer(event);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    toggleHighlight(target);
  }

  function handleKeydown(event) {
    if (!state.active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelSelection();
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
    const { text, blocks } = finishSelection();
    if (!text) {
      alert('Select at least one block before analyzing.');
      return;
    }

    const analyzeBtn = state.menu?.querySelector('button[data-action="analyze"]');
    if (!analyzeBtn) return;

    analyzeBtn.dataset.mode = '';

    const originalLabel = analyzeBtn.textContent;
    analyzeBtn.disabled = true;
    state.analyzing = { start: performance.now(), label: originalLabel };
    let timerId = 0;

    const updateTimer = () => {
      if (!state.analyzing) return;
      const elapsed = (performance.now() - state.analyzing.start) / 1000;
      analyzeBtn.textContent = `${elapsed.toFixed(1)}s…`;
    };
    updateTimer();
    timerId = window.setInterval(updateTimer, 100);

    safeSendMessage({ type: 'SELECTION_ANALYZE', text });

    safeSendMessage({ type: 'GET_SETTINGS' }, (settings) => {
      try {
        const s = settings || {};
        const models = Array.isArray(s.models) ? s.models.filter(m => m && m.active) : [];
        if (!models.length) throw new Error('No active model configured. Open Settings to activate a model.');
        const chosenId = (s.ui && s.ui.chosenModel) || s.chosenModel || models[0].id;
        const modelMeta = models.find(m => m.id === chosenId) || models[0];
        const provider = Array.isArray(s.providers) ? s.providers.find(p => p.id === modelMeta.providerId) : null;
        if (!provider) throw new Error('Provider for the selected model is missing.');

        const callPayload = {
          modelId: modelMeta.modelId,
          providerId: modelMeta.providerId,
          cv: s.cv || '',
          systemTemplate: s.systemTemplate || '',
          outputTemplate: s.outputTemplate || '',
          modelSystemPrompt: modelMeta.systemPrompt || '',
          text
        };

        safeSendMessage({ type: 'CALL_LLM', payload: callPayload }, (resp) => {
          if (timerId) { clearInterval(timerId); timerId = 0; }
          const elapsedMs = performance.now() - state.analyzing.start;
          const label = `Done: ${(elapsedMs / 1000).toFixed(2)}s`;
          analyzeBtn.textContent = label;
          analyzeBtn.disabled = false;
          state.analyzing = null;

          if (resp?.ok) {
            try {
              chrome.storage.local.set({ lastResult: { text: resp.text, when: Date.now(), ms: resp.ms || elapsedMs } }, () => {});
            } catch {}
            safeSendMessage({ type: 'LLM_RESULT', text: resp.text });
            analyzeBtn.textContent = `${label}`;
            analyzeBtn.dataset.mode = 'done';
            analyzeBtn.disabled = true;
            state.lastAnalyzedBlockCount = state.highlights.length;
            updateMenu();
          } else if (resp?.error) {
            alert('LLM error: ' + resp.error);
            analyzeBtn.textContent = 'Analyze';
            analyzeBtn.dataset.mode = '';
            analyzeBtn.disabled = state.highlights.length === 0;
            updateMenu();
          } else {
            analyzeBtn.textContent = 'Analyze';
            analyzeBtn.dataset.mode = '';
            analyzeBtn.disabled = state.highlights.length === 0;
            updateMenu();
          }
        });
      } catch (err) {
        if (timerId) { clearInterval(timerId); timerId = 0; }
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Analyze';
        analyzeBtn.dataset.mode = '';
        state.analyzing = null;
        alert(err?.message || String(err || 'Failed to start analysis.'));
        updateMenu();
      }
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

  function cancelSelection() {
    clearHighlights(false);
    safeSendMessage({ type: 'SELECTION_RESULT', text: '', blocks: [] });
    deactivate();
  }

  function activate() {
    if (state.active) return;
    ensureStyleInjected();
    createMenu();
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
    cancelSelection();
    deactivate();
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
