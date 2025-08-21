// content/select.js — robust highlighter (overlay-based) for JDA
(() => {
  if (window.__JDA_SELECT_INSTALLED__) return;
  window.__JDA_SELECT_INSTALLED__ = true;

  const STATE = {
    active: false,
    prevCursor: null,
    hoverOverlay: null,
    analyzeBtn: null,
    overlays: [], // HTMLElements
    lastText: "",
    lastRanges: [], // cache { rects: DOMRect[] }
  };

  const OVERLAY_CLASS = "jda-highlight-overlay";
  const HOVER_ID = "jda-highlight-hover-overlay";

  const SEND_SILENT = true;
  let __lastMouseUpTs = 0;
  const MOUSEUP_COOLDOWN_MS = 250;

  function pickActiveModel(settings){
    if (!settings) return null;
    const models = (settings.models || []).filter(m => m && m.active);
    if (!models.length) return null;
    // prefer explicitly chosen model if present in settings
    const chosenId = (settings.ui && settings.ui.chosenModel) || settings.chosenModel;
    const byChosen = chosenId ? models.find(m => m.id === chosenId) : null;
    return byChosen || models[0];
  }

  function safeSendMessage(msg, cb){
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
      if (cb) {
        chrome.runtime.sendMessage(msg, (...args) => {
          const err = chrome.runtime.lastError; if (SEND_SILENT && err) { /* swallow */ } else if (err) { console.warn('[JDA] sendMessage error:', err); }
          try { cb(...args); } catch {}
        });
      } else {
        chrome.runtime.sendMessage(msg, () => {
          const err = chrome.runtime.lastError; if (SEND_SILENT && err) { /* swallow */ } else if (err) { console.warn('[JDA] sendMessage error:', err); }
        });
      }
    } catch (e) {
      if (!SEND_SILENT) console.warn('[JDA] sendMessage threw:', e);
    }
  }

  // ============ utils ============
  function throttle(fn, wait) {
    let t = 0, lastArgs, lastThis;
    return function (...args) {
      lastArgs = args; lastThis = this;
      const now = Date.now();
      if (now - t >= wait) { t = now; fn.apply(lastThis, lastArgs); }
    };
  }
  function px(n) { return `${n}px`; }
  function removeNode(n) { if (n && n.parentNode) n.parentNode.removeChild(n); }
  function createEl(tag, cls) { const el = document.createElement(tag); if (cls) el.className = cls; return el; }
  function clearSelectionRanges(){ try{ const sel = window.getSelection(); sel && sel.removeAllRanges(); }catch{} }

  // ============ hover overlay ============
  function createOrUpdateHoverOverlay(target){
    if (!STATE.active) { removeHoverOverlay(); return; }
    if (!target || !(target instanceof Element)) { removeHoverOverlay(); return; }

    let elForRect = target;
    const tag = target.tagName?.toUpperCase?.() || "";
    if (["TD","TH","TR"].includes(tag)) {
      const t = target.closest('table');
      if (t) elForRect = t;
    }

    const rect = elForRect.getBoundingClientRect();
    if (!STATE.hoverOverlay) {
      const hov = createEl('div');
      hov.id = HOVER_ID;
      hov.style.position = 'absolute';
      hov.style.pointerEvents = 'none';
      hov.style.outline = '2px dashed rgba(16,185,129,.7)';
      hov.style.borderRadius = '4px';
      hov.style.zIndex = '2147483646';
      document.body.appendChild(hov);
      STATE.hoverOverlay = hov;
    }
    const hov = STATE.hoverOverlay;
    hov.style.left = px(rect.left + window.scrollX - 2);
    hov.style.top = px(rect.top + window.scrollY - 2);
    hov.style.width = px(rect.width + 4);
    hov.style.height = px(rect.height + 4);
    hov.style.display = 'block';
  }
  function removeHoverOverlay(){
    if (STATE.hoverOverlay) STATE.hoverOverlay.style.display = 'none';
  }

  // ============ selection overlays ============
  function clearOverlays(){
    for (const el of STATE.overlays) removeNode(el);
    STATE.overlays = [];
    STATE.lastRanges = [];
  }

  function removeOverlay(el){
    const idx = STATE.overlays.indexOf(el);
    if (idx !== -1) STATE.overlays.splice(idx, 1);
    removeNode(el);
    if (STATE.overlays.length === 0){
      removeAnalyzeButton();
      removeClearButton();
      STATE.lastText = '';
    }
  }

  function createOverlay(rect){
    const el = createEl('div', OVERLAY_CLASS);
    el.style.position = 'absolute';
    el.style.left = px(rect.left + window.scrollX - 1);
    el.style.top = px(rect.top + window.scrollY - 1);
    el.style.width = px(rect.width + 2);
    el.style.height = px(rect.height + 2);
    el.style.background = 'rgba(0, 200, 0, 0.18)';
    el.style.borderRadius = '3px';
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    el.style.zIndex = '2147483647';
    document.body.appendChild(el);
    // allow removing a single highlight by clicking it
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      removeOverlay(el);
    }, true);
    return el;
  }
  function mergeSameLineRects(rects){
    if (!rects || !rects.length) return [];
    const merged = [];
    let cur = new DOMRect(rects[0].x, rects[0].y, rects[0].width, rects[0].height);
    for (let i=1;i<rects.length;i++){
      const r = rects[i];
      if (Math.abs(r.y - cur.y) < 1 && Math.abs(r.height - cur.height) < 1){
        cur.width = (r.right - cur.left); // merge horizontally
      } else {
        merged.push(cur);
        cur = new DOMRect(r.x, r.y, r.width, r.height);
      }
    }
    merged.push(cur);
    return merged;
  }
  function buildOverlaysFromSelection(sel){
    clearOverlays();
    const ranges = [];
    for (let i=0;i<sel.rangeCount;i++){
      const r = sel.getRangeAt(i);
      const rects = Array.from(r.getClientRects());
      const merged = mergeSameLineRects(rects);
      for (const m of merged) STATE.overlays.push(createOverlay(m));
      ranges.push({ rects: merged });
    }
    STATE.lastRanges = ranges;
  }

  // Строгий reflow не пересчитывает прямоугольники (это дороже и ненадёжно на динамических страницах),
  // а при сильных мутациях мы просто очищаем подсветку (см. MutationObserver).
  function reflowOverlays(){
    // Ничего не делаем — абсолютные координаты уже рассчитаны с учётом scrollX/scrollY.
    // Если DOM «прыгнул» — сработает MutationObserver и подсветка будет снята.
  }

  // ============ analyze button ============
  function removeActionPanel(){
    const p = document.getElementById('__jda_action_panel');
    if (p && p.parentNode) p.parentNode.removeChild(p);
    STATE.analyzeBtn = null;
  }

  function showActionPanel(x, y){
    removeActionPanel();
    const panel = document.createElement('div');
    panel.id = '__jda_action_panel';
    Object.assign(panel.style, {
      position: 'fixed',
      top: px(Math.max(8, y + 12)),
      left: px(Math.max(8, x + 12)),
      display: 'flex',
      gap: '8px',
      padding: '8px',
      borderRadius: '12px',
      background: 'rgba(15,118,110,.96)',
      boxShadow: '0 8px 24px rgba(0,0,0,.25)',
      zIndex: 2147483647,
      alignItems: 'center'
    });

    const analyze = document.createElement('button');
    analyze.textContent = 'Start analyze';
    Object.assign(analyze.style, {
      border: 'none', borderRadius: '8px', padding: '6px 10px',
      background: '#10b981', color: '#fff', cursor: 'pointer', fontSize: '13px'
    });
    analyze.addEventListener('click', () => {
      const text = (STATE.lastText || '').trim();
      if (!text) return;
      analyze.disabled = true; analyze.textContent = 'Sending…';

      // 1) get settings from background
      safeSendMessage({ type: 'GET_SETTINGS' }, (settings) => {
        try {
          const s = settings || {};
          const model = pickActiveModel(s);
          if (!model) {
            analyze.disabled = false; analyze.textContent = 'Start analyze';
            alert('No active model configured. Please add and activate a model in Settings.');
            return;
          }
          const provider = (s.providers || []).find(p => p.id === model.providerId);
          if (!provider) {
            analyze.disabled = false; analyze.textContent = 'Start analyze';
            alert('Provider for the selected model is missing.');
            return;
          }

          // 2) call LLM via background
          safeSendMessage({
            type: 'CALL_LLM',
            payload: {
              modelId: model.modelId,
              providerId: model.providerId,
              cv: s.cv || '',
              systemTemplate: s.systemTemplate || '',
              outputTemplate: s.outputTemplate || '',
              modelSystemPrompt: model.systemPrompt || '',
              text
            }
          }, (resp) => {
            // 3) notify popup to render (if open), fall back to alert on error
            if (resp && resp.ok) {
              safeSendMessage({ type: 'LLM_RESULT', text: resp.text });
            } else if (resp && resp.error) {
              alert('LLM error: ' + resp.error);
            }
            removeActionPanel();
          });
        } catch (e){
          analyze.disabled = false; analyze.textContent = 'Start analyze';
          alert('Unexpected error: ' + (e && e.message ? e.message : e));
        }
      });
    });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    Object.assign(clearBtn.style, {
      border: 'none', borderRadius: '8px', padding: '6px 10px',
      background: '#334155', color: '#fff', cursor: 'pointer', fontSize: '13px'
    });
    clearBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); clearAll(); });

    panel.appendChild(analyze);
    panel.appendChild(clearBtn);
    document.body.appendChild(panel);

    // keep reference for compatibility with old helpers
    STATE.analyzeBtn = analyze;
  }

  function removeAnalyzeButton(){ removeActionPanel(); }
  function removeClearButton(){ removeActionPanel(); }

  // ============ handlers ============
  function handleMouseMove(e){
    if (!STATE.active) { removeHoverOverlay(); return; }
    const t = (e instanceof MouseEvent)
      ? e.target
      : document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    if (t && t.nodeType === 1) createOrUpdateHoverOverlay(t);
  }
  function handleMouseUp(e){
    if (!STATE.active) return;
    const now = Date.now();
    if (now - __lastMouseUpTs < MOUSEUP_COOLDOWN_MS) return;
    __lastMouseUpTs = now;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      const text = sel.toString();
      STATE.lastText = text;
      buildOverlaysFromSelection(sel);
      clearSelectionRanges();

      // stop selection mode
      STATE.active = false;
      document.body.style.cursor = STATE.prevCursor || '';
      document.removeEventListener('mouseup', handleMouseUp, true);
      document.removeEventListener('mousemove', handleMouseMove, true);

      const x = (e && (e.clientX || e.pageX)) || 20;
      const y = (e && (e.clientY || e.pageY)) || 20;
      showActionPanel(x, y);

      safeSendMessage({ type: 'SELECTION_RESULT', text });
    }
  }

  function enable(){
    if (STATE.active) return;
    STATE.active = true;
    STATE.prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    removeAnalyzeButton();
    removeHoverOverlay();
    clearOverlays();
    removeClearButton();
    __lastMouseUpTs = 0;
    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('mousemove', handleMouseMove, true);
  }
  function disable(){
    STATE.active = false;
    document.body.style.cursor = STATE.prevCursor || '';
    document.removeEventListener('mouseup', handleMouseUp, true);
    document.removeEventListener('mousemove', handleMouseMove, true);
  }
  function clearAll(){
    clearOverlays();
    removeAnalyzeButton();
    removeHoverOverlay();
    removeClearButton();
    STATE.lastText = '';
  }

  // ============ reflow on resize/scroll/mutations ============
  const throttledReflow = throttle(reflowOverlays, 100);
  window.addEventListener('resize', throttledReflow);
  window.addEventListener('scroll', throttledReflow, { passive: true });

  const mo = new MutationObserver(throttle(() => {
    // Не трогаем подсветку и панель действий после завершения выделения,
    // иначе на динамичных SPA панель пропадает мгновенно. При необходимости
    // пользователь может нажать Clear вручную.
    // Когда STATE.active === true (в процессе выделения) — тоже ничего не делаем.
  }, 250));
  try {
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: false });
  } catch {}

  // ============ bus ============
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'START_SELECTION') { enable(); sendResponse?.({ ok: true }); }
    else if (msg?.type === 'CLEAR_SELECTION') { clearAll(); sendResponse?.({ ok: true }); }
  });
})();