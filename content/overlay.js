// content/overlay.js — Draggable overlay that renders extension UI directly (no iframe)
(() => {
  if (window.__JDA_OVERLAY_INJECTED__) return;
  window.__JDA_OVERLAY_INJECTED__ = true;

  const TEMPLATE_URL = chrome.runtime.getURL('ui/overlay.html');

  const DEFAULT_WIDTH = 400;
  function defaultHeight() { return Math.round(window.innerHeight * 0.95); }
  const MIN_WIDTH = 420;
  const MAX_WIDTH = 1280;
  const MIN_HEIGHT = 320;
  const MAX_HEIGHT = () => Math.min(window.innerHeight - 80, 1200);

  const Z = 2147483647;
  const MARGIN = 8;

  const K = {
    left: 'jda:overlay:left',
    top: 'jda:overlay:top',
    w: 'jda:overlay:width',
    h: 'jda:overlay:height'
  };

  function ssGet(key, def) {
    try {
      const v = sessionStorage.getItem(key);
      if (v == null) return def;
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    } catch {
      return def;
    }
  }
  function ssSet(key, val) {
    try { sessionStorage.setItem(key, String(val)); } catch {}
  }

  function readSavedRect() {
    const w = ssGet(K.w, DEFAULT_WIDTH);
    const h = ssGet(K.h, defaultHeight());
    const l = ssGet(K.left, Math.max(MARGIN, window.innerWidth - w - MARGIN));
    const t = ssGet(K.top, MARGIN + 8);
    return clampRect(l, t, w, h);
  }

  function clampRect(left, top, width, height) {
    const maxH = MAX_HEIGHT();
    const W = Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - MARGIN * 2)));
    const H = Math.min(Math.max(height, MIN_HEIGHT), Math.max(MIN_HEIGHT, maxH));
    const maxLeft = window.innerWidth - W - MARGIN;
    const maxTop = window.innerHeight - H - MARGIN;
    const L = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, maxLeft));
    const T = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, maxTop));
    return { left: L, top: T, width: W, height: H };
  }

  function applyRect(rect) {
    if (!host) return;
    Object.assign(host.style, {
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px'
    });
    ssSet(K.left, rect.left);
    ssSet(K.top, rect.top);
    ssSet(K.w, rect.width);
    ssSet(K.h, rect.height);
  }

  let host = null;
  let dragBar = null;
  let closeBtn = null;
  let resizer = null;
  let contentSlot = null;

  let dragStartWidth = 0;
  let dragStartHeight = 0;

  let contentLoaded = false;
  let contentPromise = null;

  function ensureStyles(doc) {
    const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;
      const abs = new URL(href, TEMPLATE_URL).toString();
      if (document.head.querySelector(`link[data-jda-overlay-style="${abs}"]`)) continue;
      const el = document.createElement('link');
      el.rel = 'stylesheet';
      el.href = abs;
      el.dataset.jdaOverlayStyle = abs;
      document.head.appendChild(el);
    }
  }

  async function ensureContent() {
    if (contentLoaded || !contentSlot) return contentPromise;
    if (contentPromise) return contentPromise;

    contentPromise = (async () => {
      const resp = await fetch(TEMPLATE_URL);
      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      ensureStyles(doc);

      const body = doc.body;
      if (!body) return;
      body.querySelectorAll('script').forEach((el) => el.remove());

      const wrapper = document.createElement('div');
      wrapper.className = 'jda-overlay-root';
      wrapper.setAttribute('data-view', 'overlay');
      wrapper.innerHTML = body.innerHTML;

      contentSlot.innerHTML = '';
      contentSlot.appendChild(wrapper);

      await import(chrome.runtime.getURL('ui/popup.js'));

      contentLoaded = true;
    })().catch((err) => {
      console.error('[JDA] overlay content load failed:', err);
      contentLoaded = false;
      contentPromise = null;
    });

    return contentPromise;
  }

  function ensureHost() {
    if (host) return host;

    const initialRect = readSavedRect();

    host = document.createElement('div');
    host.id = '__jda_overlay_host';
    Object.assign(host.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '100vw',
      height: '100vh',
      zIndex: String(Z),
      display: 'none',
      boxShadow: 'none',
      border: 'none',
      background: 'transparent',
      borderRadius: '10px',
      overflow: 'hidden',
      contain: 'layout style paint size'
    });

    dragBar = document.createElement('div');
    Object.assign(dragBar.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      right: '0',
      height: '36px',
      background: 'rgba(247,247,247,0.96)',
      borderBottom: '1px solid rgba(0,0,0,0.06)',
      cursor: 'grab',
      WebkitUserSelect: 'none',
      userSelect: 'none',
      zIndex: String(Z + 1)
    });

    const grip = document.createElement('div');
    Object.assign(grip.style, {
      position: 'absolute',
      left: '12px',
      top: '10px',
      width: '64px',
      height: '16px',
      borderRadius: '8px',
      background: 'rgba(0,0,0,0.08)'
    });
    dragBar.appendChild(grip);
    // скрываем внешний бар — управление будет изнутри UI
    dragBar.style.display = 'none';

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close overlay');
    closeBtn.textContent = '×';
    Object.assign(closeBtn.style, {
      position: 'absolute',
      right: '10px',
      top: '4px',
      width: '28px',
      height: '28px',
      lineHeight: '24px',
      fontSize: '22px',
      border: '0',
      borderRadius: '6px',
      background: 'transparent',
      color: '#444',
      cursor: 'pointer'
    });
    closeBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true });
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); hideOverlay(); }, { capture: true });
    dragBar.appendChild(closeBtn);

    // подложка (shield), чтобы не кликалось и не скроллилось под окном
    const shield = document.createElement('div');
    Object.assign(shield.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      background: 'transparent',
      zIndex: '0'
    });
    shield.addEventListener('wheel', (e) => { e.preventDefault(); }, { passive: false });
    shield.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
    host.appendChild(shield);

    host.appendChild(dragBar);

    contentSlot = document.createElement('div');
    contentSlot.id = '__jda_overlay_content';
    Object.assign(contentSlot.style, {
      position: 'absolute',
      top: '36px',
      left: '0',
      width: initialRect.width + 'px',
      height: (initialRect.height - 36) + 'px',
      transform: `translate(${initialRect.left}px, ${initialRect.top}px)`,
      background: 'transparent',
      overflow: 'hidden'
    });
    host.appendChild(contentSlot);

    resizer = document.createElement('div');
    Object.assign(resizer.style, {
      position: 'absolute',
      right: '0',
      bottom: '0',
      width: '16px',
      height: '16px',
      cursor: 'nwse-resize',
      background: 'transparent'
    });
    // перемещаем ресайзер внутрь панели
    contentSlot.appendChild(resizer);

    document.documentElement.appendChild(host);

    setupDragAndResize(grip);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideOverlay();
    }, { capture: true });

    window.addEventListener('resize', () => {
      const r = host.getBoundingClientRect();
      applyRect(clampRect(r.left, r.top, r.width, r.height));
    });

    return host;
  }

  function setupDragAndResize(grip) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onPointerDownDrag = (e) => {
      const h = contentSlot?.querySelector?.('.header');
      if (!h || (e.target !== h && !h.contains(e.target))) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = ssGet(K.left, 0);
      startTop = ssGet(K.top, 0);
      dragStartWidth = ssGet(K.w, DEFAULT_WIDTH);
      dragStartHeight = ssGet(K.h, desiredHeight());
      try { h.setPointerCapture(e.pointerId); } catch {}
      h.style.cursor = 'grabbing';
      if (contentSlot) contentSlot.style.pointerEvents = 'none';
      e.preventDefault();
      e.stopPropagation();
    };

    const onPointerMoveDrag = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const next = clampRect(startLeft + dx, startTop + dy, dragStartWidth, dragStartHeight);
      // перемещаем внутреннюю панель через transform
      contentSlot.style.transform = `translate(${next.left}px, ${next.top}px)`;
      contentSlot.style.width = next.width + 'px';
      contentSlot.style.height = (next.height - 36) + 'px';
      ssSet(K.left, next.left); ssSet(K.top, next.top); ssSet(K.w, next.width); ssSet(K.h, next.height);
    };

    const onPointerUpDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      const h = contentSlot?.querySelector?.('.header');
      try { h && h.releasePointerCapture(e.pointerId); } catch {}
      if (h) h.style.cursor = 'grab';
      if (contentSlot) contentSlot.style.pointerEvents = '';
    };
    // Привязка к внутренней шапке после загрузки UI
    const tryBindHeader = () => {
      const h = contentSlot?.querySelector?.('.header');
      if (!h || h.__jdaDragBound) return;
      h.__jdaDragBound = true;
      h.style.cursor = 'move';
      h.addEventListener('pointerdown', onPointerDownDrag);
      h.addEventListener('pointermove', onPointerMoveDrag);
      h.addEventListener('pointerup', onPointerUpDrag);
      h.addEventListener('pointercancel', onPointerUpDrag);
      h.addEventListener('lostpointercapture', onPointerUpDrag);
    };
    tryBindHeader();
    new MutationObserver(() => tryBindHeader()).observe(contentSlot, { childList: true, subtree: true });

    let resizing = false;
    let rsX = 0;
    let rsY = 0;
    let rsW = 0;
    let rsH = 0;

    const onPointerDownResize = (e) => {
      resizing = true;
      const r = host.getBoundingClientRect();
      rsX = e.clientX;
      rsY = e.clientY;
      rsW = r.width;
      rsH = r.height;
      resizer.setPointerCapture(e.pointerId);
      if (contentSlot) contentSlot.style.pointerEvents = 'none';
      e.preventDefault();
      e.stopPropagation();
    };

    const onPointerMoveResize = (e) => {
      if (!resizing) return;
      const dx = e.clientX - rsX;
      const dy = e.clientY - rsY;
      const r = host.getBoundingClientRect();
      const next = clampRect(startLeft, startTop, rsW + dx, rsH + dy);
      contentSlot.style.width = next.width + 'px';
      contentSlot.style.height = (next.height - 36) + 'px';
      ssSet(K.w, next.width); ssSet(K.h, next.height);
    };

    const onPointerUpResize = (e) => {
      if (!resizing) return;
      resizing = false;
      try { resizer.releasePointerCapture(e.pointerId); } catch {}
      if (contentSlot) contentSlot.style.pointerEvents = '';
    };

    resizer.addEventListener('pointerdown', onPointerDownResize);
    resizer.addEventListener('pointermove', onPointerMoveResize);
    resizer.addEventListener('pointerup', onPointerUpResize);
    resizer.addEventListener('pointercancel', onPointerUpResize);
    resizer.addEventListener('lostpointercapture', onPointerUpResize);
  }

  function showOverlay() {
    // Блочим прокрутку страницы и добавляем «подложку»
    try {
      document.documentElement.classList.add('jda-overlay-open');
    } catch {}
    ensureHost();
    ensureContent().catch((err) => console.debug('[JDA] overlay content load pending:', err));
    applyRect(readSavedRect());
    host.style.display = 'block';
    try { chrome.runtime.sendMessage({ type: 'OVERLAY_SHOWN' }); } catch {}
  }

  function hideOverlay() {
    if (!host) return;
    host.style.display = 'none';
    try {
      document.documentElement.classList.remove('jda-overlay-open');
    } catch {}
    try { chrome.runtime.sendMessage({ type: 'OVERLAY_HIDDEN' }); } catch {}
  }

  function toggleOverlay() {
    ensureHost();
    if (host.style.display === 'block') {
      hideOverlay();
    } else {
      showOverlay();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'JDA_TOGGLE_OVERLAY':
        toggleOverlay();
        break;
      case 'JDA_SHOW_OVERLAY':
        showOverlay();
        break;
      case 'JDA_HIDE_OVERLAY':
        hideOverlay();
        break;
      case 'JDA_OVERLAY_TEMP_HIDE':
        if (host) host.style.display = 'none';
        break;
      case 'JDA_OVERLAY_TEMP_SHOW':
        ensureHost();
        ensureContent().catch((err) => console.debug('[JDA] overlay content load pending:', err));
        applyRect(readSavedRect());
        host.style.display = 'block';
        break;
    }
  });

  ensureHost();
  ensureContent().catch((err) => console.error('[JDA] overlay bootstrap failed:', err));
})();
