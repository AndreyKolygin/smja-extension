// content/app-overlay.js — плавающее окно с основным UI
(() => {
  if (window.__JDA_APP_OVERLAY__) return;

  const OVERLAY_ID = 'jda-app-overlay';
  const STYLE_ID = 'jda-app-overlay-style';
  const CARD_CLASS = 'jda-app-overlay-card';
  const HEADER_HANDLE = '[data-drag-handle]';

  const state = {
    root: null,
    card: null,
    frame: null,
    drag: {
      active: false,
      offsetX: 0,
      offsetY: 0,
      pointerId: null,
      move: null,
      up: null
    },
    resize: {
      active: false,
      startHeight: 0,
      startY: 0,
      pointerId: null,
      move: null,
      up: null,
      handle: null
    },
    keyHandler: null
  };

  const i18n = window.__JDA_I18N__ || {};
  const ensureLocaleLoaded = i18n.ensureLocaleLoaded || ((force, cb) => { if (cb) cb(); return Promise.resolve(); });
  const watchLocaleChanges = i18n.watchLocaleChanges || (() => {});
  const translate = i18n.t || ((key, fallback) => fallback || key);
  const applyI18n = i18n.applyTranslations || (() => {});

  let localeReady = false;
  const applyTranslationsLater = () => applyOverlayTranslations(state.root);
  const markReady = () => {
    localeReady = true;
    applyTranslationsLater();
  };
  ensureLocaleLoaded(false, markReady);
  watchLocaleChanges(() => {
    localeReady = false;
    ensureLocaleLoaded(true, markReady);
  });

  const t = (key, fallback = '') => translate(key, fallback);

  function applyOverlayTranslations(root = state.root) {
    if (!root) return;
    applyI18n(root);
  }


  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        top: 24px;
        right: 24px;
        left: auto;
        transform: none;
        z-index: 2147483645;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        pointer-events: none;
      }
      #${OVERLAY_ID}.jda-overlay-dragging {
        cursor: grabbing;
      }
      #${OVERLAY_ID} .${CARD_CLASS} {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 0;
        width: min(400px, calc(100vw - 32px));
        max-width: min(720px, calc(100vw - 16px));
        height: min(45vh, calc(100vh - 64px));
        max-height: calc(100vh - 32px);
        min-height: 700px;
        background: #0f172a;
        color: #f8fafc;
        border-radius: 24px;
        box-shadow: 0 22px 48px rgba(15, 23, 42, 0.35);
        border: 1px solid rgba(148, 163, 184, 0.18);
        overflow: hidden;
        pointer-events: auto;
      }
      #${OVERLAY_ID} .jda-app-overlay-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        background: #1f2937;
        cursor: grab;
        user-select: none;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      #${OVERLAY_ID}.jda-overlay-dragging .jda-app-overlay-header {
        cursor: grabbing;
      }
      #${OVERLAY_ID} .jda-app-overlay-title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${OVERLAY_ID} .jda-app-overlay-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #${OVERLAY_ID} .jda-app-overlay-actions button {
        border: none;
        border-radius: 999px;
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(148, 163, 184, 0.16);
        color: inherit;
        padding: 0;
        cursor: pointer;
      }
      #${OVERLAY_ID} .jda-app-overlay-actions button:hover {
        background: rgba(148, 163, 184, 0.28);
      }
      #${OVERLAY_ID} .jda-app-overlay-body {
        flex: 1;
        background: #FFFFFF;
        border-top: 1px solid rgba(15, 23, 42, 0.25);
        overflow: hidden;
        position: relative;
      }
      #${OVERLAY_ID} .jda-app-overlay-frame {
        width: 100%;
        height: 100%;
        border: none;
        background: transparent;
      }
      #${OVERLAY_ID} .jda-app-overlay-resize {
        height: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: ns-resize;
        background: rgba(15, 23, 42, 0.12);
        border-top: 1px solid rgba(15, 23, 42, 0.25);
      }
      #${OVERLAY_ID} .jda-app-overlay-resize::before {
        content: '';
        width: 40px;
        height: 4px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.6);
      }
    `;
    document.documentElement.appendChild(style);
  }

  function clampPosition(left, top, width, height) {
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    const clampedLeft = Math.max(8, Math.min(left, maxLeft));
    const clampedTop = Math.max(8, Math.min(top, maxTop));
    return { left: clampedLeft, top: clampedTop };
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      window.__JDA_APP_OVERLAY__?.close();
    }
  }

  function beginDrag(event) {
    if (!state.root || !state.card) return;
    if (event.button !== 0) return;
    if (event.target.closest('button')) return;
    event.preventDefault();

    const rect = state.root.getBoundingClientRect();
    const { left, top } = clampPosition(rect.left, rect.top, rect.width, rect.height);
    state.root.style.left = `${left}px`;
    state.root.style.top = `${top}px`;
    state.root.style.transform = 'none';
    state.root.style.right = 'auto';

    state.drag.active = true;
    state.drag.pointerId = event.pointerId;
    state.drag.offsetX = event.clientX - left;
    state.drag.offsetY = event.clientY - top;
    state.drag.handle = event.currentTarget;

    state.root.classList.add('jda-overlay-dragging');
    state.drag.handle?.setPointerCapture?.(event.pointerId);

    state.drag.move = (moveEvent) => {
      if (!state.drag.active) return;
      moveEvent.preventDefault();
      const cardRect = state.card?.getBoundingClientRect();
      const width = cardRect ? cardRect.width : rect.width;
      const height = cardRect ? cardRect.height : rect.height;

      const nextLeft = moveEvent.clientX - state.drag.offsetX;
      const nextTop = moveEvent.clientY - state.drag.offsetY;
      const { left: clampedLeft, top: clampedTop } = clampPosition(nextLeft, nextTop, width, height);

      state.root.style.left = `${clampedLeft}px`;
      state.root.style.top = `${clampedTop}px`;
      state.root.style.right = 'auto';
    };

    state.drag.up = () => {
      if (!state.drag.active) return;
      state.drag.active = false;
      state.root?.classList.remove('jda-overlay-dragging');
      if (state.drag.pointerId != null && state.drag.handle) {
        state.drag.handle.releasePointerCapture?.(state.drag.pointerId);
      }
      state.drag.pointerId = null;
      window.removeEventListener('pointermove', state.drag.move, true);
      window.removeEventListener('pointerup', state.drag.up, true);
      window.removeEventListener('pointercancel', state.drag.up, true);
      state.drag.move = null;
      state.drag.up = null;
      state.drag.handle = null;
    };

    window.addEventListener('pointermove', state.drag.move, true);
    window.addEventListener('pointerup', state.drag.up, true);
    window.addEventListener('pointercancel', state.drag.up, true);
  }

  function attachDrag(handle) {
    handle.addEventListener('pointerdown', beginDrag, true);
  }

  function detachDrag(handle) {
    handle?.removeEventListener('pointerdown', beginDrag, true);
  }

  function beginResize(event) {
    if (!state.card) return;
    if (event.button !== 0) return;
    event.preventDefault();

    const cardRect = state.card.getBoundingClientRect();
    const computed = window.getComputedStyle(state.card);
    const minHeight = parseFloat(computed.minHeight) || 300;
    const maxHeightLimit = parseFloat(computed.maxHeight);
    const viewportLimit = Math.max(200, window.innerHeight - 32);
    const maxHeight = Math.min(
      isNaN(maxHeightLimit) ? viewportLimit : maxHeightLimit,
      viewportLimit
    );

    state.resize.active = true;
    state.resize.startHeight = cardRect.height;
    state.resize.startY = event.clientY;
    state.resize.pointerId = event.pointerId;

    state.card.style.height = `${cardRect.height}px`;

    state.resize.handle = event.currentTarget;
    state.resize.handle?.setPointerCapture?.(event.pointerId);

    state.resize.move = (moveEvent) => {
      if (!state.resize.active) return;
      moveEvent.preventDefault();
      const delta = moveEvent.clientY - state.resize.startY;
      let next = state.resize.startHeight + delta;
      next = Math.max(minHeight, Math.min(next, maxHeight));
      state.card.style.height = `${next}px`;
    };

    state.resize.up = () => {
      if (!state.resize.active) return;
      state.resize.active = false;
      if (state.resize.pointerId != null && state.resize.handle) {
        state.resize.handle.releasePointerCapture?.(state.resize.pointerId);
      }
      state.resize.pointerId = null;
      window.removeEventListener('pointermove', state.resize.move, true);
      window.removeEventListener('pointerup', state.resize.up, true);
      window.removeEventListener('pointercancel', state.resize.up, true);
      state.resize.move = null;
      state.resize.up = null;
      state.resize.handle = null;

      const cardRectAfter = state.card.getBoundingClientRect();
      const { top, left } = state.root.getBoundingClientRect();
      const { left: clampedLeft, top: clampedTop } = clampPosition(left, top, cardRectAfter.width, cardRectAfter.height);
      state.root.style.left = `${clampedLeft}px`;
      state.root.style.top = `${clampedTop}px`;
      state.root.style.right = 'auto';
    };

    window.addEventListener('pointermove', state.resize.move, true);
    window.addEventListener('pointerup', state.resize.up, true);
    window.addEventListener('pointercancel', state.resize.up, true);
  }

  function attachResize(handle) {
    handle?.addEventListener('pointerdown', beginResize, true);
  }

  function detachResize(handle) {
    handle?.removeEventListener('pointerdown', beginResize, true);
  }

  function focusFrame() {
    if (!state.frame) return;
    try { state.frame.focus({ preventScroll: true }); } catch {}
  }

  function openOverlay() {
    if (state.root) {
      applyOverlayTranslations(state.root);
      focusFrame();
      return;
    }
    if (!localeReady) {
      ensureLocaleLoaded(false, () => {
        localeReady = true;
        openOverlay();
      });
      return;
    }
    ensureStyle();

    const title = t('ui.app.title', 'Job Description Analyzer');
    const closeTitle = t('ui.highlighter.close', 'Close');
    const frameUrl = chrome.runtime.getURL('ui/popup.html');

    const container = document.createElement('div');
    container.id = OVERLAY_ID;
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'false');
    container.setAttribute('aria-label', title);
    container.innerHTML = `
      <div class="${CARD_CLASS}">
        <div class="jda-app-overlay-header" data-drag-handle>
          <span class="jda-app-overlay-title" data-i18n-key="ui.app.title">${title}</span>
          <div class="jda-app-overlay-actions">
            <button type="button" data-action="close" data-i18n-title-key="ui.highlighter.close" title="${closeTitle}">✕</button>
          </div>
        </div>
        <div class="jda-app-overlay-body">
          <iframe class="jda-app-overlay-frame" src="${frameUrl}" allow="clipboard-read; clipboard-write"></iframe>
        </div>
        <div class="jda-app-overlay-resize" data-resize-handle></div>
      </div>
    `;

    container.style.top = '24px';
    container.style.right = '24px';
    container.style.left = 'auto';
    container.style.transform = 'none';

    document.body.appendChild(container);
    state.root = container;
    state.card = container.querySelector(`.${CARD_CLASS}`);
    state.frame = container.querySelector('.jda-app-overlay-frame');
    applyOverlayTranslations(container);

    const handle = container.querySelector(HEADER_HANDLE);
    if (handle) attachDrag(handle);

    const closeBtn = container.querySelector('button[data-action="close"]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => window.__JDA_APP_OVERLAY__?.close());
    }

    const resizeHandle = container.querySelector('[data-resize-handle]');
    if (resizeHandle) attachResize(resizeHandle);

    state.keyHandler = (event) => onKeyDown(event);
    window.addEventListener('keydown', state.keyHandler, true);

    requestAnimationFrame(() => focusFrame());
  }

  function closeOverlay() {
    if (!state.root) return;
    const handle = state.root.querySelector(HEADER_HANDLE);
    if (handle) detachDrag(handle);
    const resizeHandle = state.root.querySelector('[data-resize-handle]');
    if (resizeHandle) detachResize(resizeHandle);

    if (state.drag.move) {
      window.removeEventListener('pointermove', state.drag.move, true);
      window.removeEventListener('pointerup', state.drag.up, true);
      window.removeEventListener('pointercancel', state.drag.up, true);
    }
    state.drag = {
      active: false,
      offsetX: 0,
      offsetY: 0,
      pointerId: null,
      move: null,
      up: null,
      handle: null
    };
    if (state.resize.move) {
      window.removeEventListener('pointermove', state.resize.move, true);
      window.removeEventListener('pointerup', state.resize.up, true);
      window.removeEventListener('pointercancel', state.resize.up, true);
    }
    state.resize = {
      active: false,
      startHeight: 0,
      startY: 0,
      pointerId: null,
      move: null,
      up: null,
      handle: null
    };

    if (state.keyHandler) {
      window.removeEventListener('keydown', state.keyHandler, true);
      state.keyHandler = null;
    }

    try { state.root.remove(); } catch {}
    state.root = null;
    state.card = null;
    state.frame = null;
  }

  function toggleOverlay() {
    if (state.root) {
      closeOverlay();
    } else {
      openOverlay();
    }
  }

  window.__JDA_APP_OVERLAY__ = {
    open: openOverlay,
    close: closeOverlay,
    toggle: toggleOverlay,
    isOpen: () => !!state.root
  };
})();
