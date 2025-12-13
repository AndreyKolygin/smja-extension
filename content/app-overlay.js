// content/app-overlay.js — плавающее окно с основным UI
(() => {
  if (window.__JDA_APP_OVERLAY__) return;

  const OVERLAY_ID = 'jda-app-overlay';
  const STYLE_ID = 'jda-app-overlay-style';
  const CARD_CLASS = 'jda-app-overlay-card';
  const HEADER_HANDLE = '[data-drag-handle]';
  const THEME_KEY = 'popupTheme';
  const THEME_SEQUENCE = ['dark', 'system', 'light'];

  const state = {
    root: null,
    card: null,
    frame: null,
    themePreference: 'system',
    themeEffective: 'light',
    themeMedia: null,
    themeMediaSub: null,
    themeStorageListener: null,
    themeToggle: null,
    themeToggleButtons: [],
    themeLabels: null,
    themeInitPromise: null,
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

  function ensureThemeToggle() {
    if (state.themeToggle && state.root?.contains(state.themeToggle)) {
      return state.themeToggle;
    }
    if (!state.root) return null;
    const toggle = state.root.querySelector('.jda-theme-toggle');
    if (toggle) state.themeToggle = toggle;
    return toggle;
  }

  function refreshThemeToggleLabels() {
    const toggle = ensureThemeToggle();
    if (!toggle) return;
    state.themeLabels = {
      cycle: t('ui.theme.cycle', 'Switch theme'),
      states: {
        dark: t('ui.theme.state.dark', 'Dark theme'),
        system: t('ui.theme.state.system', 'Match system theme'),
        light: t('ui.theme.state.light', 'Light theme')
      }
    };
    if (state.themeLabels.cycle) {
      toggle.setAttribute('aria-label', state.themeLabels.cycle);
    }
    toggle.querySelectorAll('[data-theme-option]').forEach((btn) => {
      const option = btn.dataset.themeOption;
      const label = state.themeLabels.states?.[option];
      if (label) {
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
      }
    });
    updateThemeToggleVisual(state.themePreference);
  }

  function applyOverlayTranslations(root = state.root) {
    if (!root) return;
    applyI18n(root);
    refreshThemeToggleLabels();
  }

  function readStoredThemePreference() {
    return new Promise((resolve) => {
      if (!hasRuntime() || !chrome?.storage?.local) {
        resolve('system');
        return;
      }
      try {
        chrome.storage.local.get({ [THEME_KEY]: 'system' }, (res) => {
          resolve(res?.[THEME_KEY] || 'system');
        });
      } catch {
        resolve('system');
      }
    });
  }

  function computeEffectiveTheme(pref) {
    if (pref === 'system') {
      return state.themeMedia?.matches ? 'dark' : 'light';
    }
    return pref === 'dark' ? 'dark' : 'light';
  }

  function setOverlayThemeClass(effective) {
    if (!state.root) return;
    if (effective === 'dark') {
      state.root.classList.add('jda-theme-dark');
    } else {
      state.root.classList.remove('jda-theme-dark');
    }
    state.root.dataset.theme = effective;
  }

  function notifyPopupTheme(preference, effective) {
    try {
      state.frame?.contentWindow?.postMessage({
        source: 'JDA_OVERLAY',
        type: 'JDA_THEME_SYNC',
        preference,
        theme: effective
      }, '*');
    } catch {}
  }

  function updateThemeToggleVisual(preference) {
    const toggle = ensureThemeToggle();
    if (!toggle) return;
    toggle.querySelectorAll('[data-theme-option]').forEach((btn) => {
      const option = btn.dataset.themeOption;
      const isActive = option === preference;
      btn.dataset.active = isActive ? 'true' : 'false';
      btn.setAttribute('aria-checked', String(isActive));
    });
  }

  function applyThemePreference(preference, { persist = true } = {}) {
    const normalized = THEME_SEQUENCE.includes(preference) ? preference : 'system';
    const effective = computeEffectiveTheme(normalized);
    state.themePreference = normalized;
    state.themeEffective = effective;
    setOverlayThemeClass(effective);
    updateThemeToggleVisual(normalized);
    notifyPopupTheme(normalized, effective);
    if (persist && hasRuntime() && chrome?.storage?.local) {
      try {
        chrome.storage.local.set({ [THEME_KEY]: normalized });
      } catch {}
    }
  }

  async function initThemeControl() {
    if (state.themeInitPromise) return state.themeInitPromise;
    const run = async () => {
      state.themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
      const onMediaChange = () => {
        if (state.themePreference === 'system') {
          applyThemePreference('system', { persist: false });
        }
      };
      state.themeMediaSub = onMediaChange;
      state.themeMedia?.addEventListener?.('change', onMediaChange);
      state.themeMedia?.addListener?.(onMediaChange);

      if (hasRuntime() && chrome?.storage?.onChanged) {
        state.themeStorageListener = (changes, area) => {
          if (area === 'local' && changes[THEME_KEY]) {
            const nextPref = changes[THEME_KEY].newValue || 'system';
            if (nextPref !== state.themePreference) {
              applyThemePreference(nextPref, { persist: false });
            }
          }
        };
        chrome.storage.onChanged.addListener(state.themeStorageListener);
      }

      const stored = await readStoredThemePreference();
      applyThemePreference(stored, { persist: false });
    };
    state.themeInitPromise = run().catch((err) => {
      console.debug('[JDA overlay] theme init failed', err);
    }).finally(() => {
      state.themeInitPromise = null;
    });
    return state.themeInitPromise;
  }

  function cleanupThemeControl() {
    if (state.themeMedia && state.themeMediaSub) {
      state.themeMedia.removeEventListener?.('change', state.themeMediaSub);
      state.themeMedia.removeListener?.(state.themeMediaSub);
    }
    state.themeMedia = null;
    state.themeMediaSub = null;
    if (state.themeStorageListener && hasRuntime() && chrome?.storage?.onChanged) {
      try {
        chrome.storage.onChanged.removeListener(state.themeStorageListener);
      } catch {}
    }
    state.themeStorageListener = null;
    state.themeToggleButtons?.forEach((btn) => {
      btn.removeEventListener('click', onThemeButtonClick, true);
    });
    state.themeToggleButtons = [];
    state.themeToggle = null;
    state.themeLabels = null;
  }

  function onThemeButtonClick(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const option = event?.currentTarget?.dataset?.themeOption;
    if (!option) return;
    applyThemePreference(option, { persist: true });
  }


  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        --jda-surface: #f8f9fbf0;
        --jda-contrast: #ffffff;
        --jda-border: rgb(226 226 226 / 40%);
        --jda-text: #1f2436;
        --jda-muted: #6d738a;
        --jda-button-bg: rgba(255, 255, 255, 0.92);
        --jda-shadow-dark: rgba(146, 154, 175, 0.25);
        --jda-shadow-light: rgba(255, 255, 255, 0.85);
        --jda-accent: #22c4b2;
        --jda-accent-strong: #6d95ff;
        --jda-button-bg: rgba(255, 255, 255, 0.92);
        position: fixed;
        top: 15px;
        right: 15px;
        left: auto;
        transform: none;
        z-index: 2147483645;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        pointer-events: none;
        color: var(--jda-text);
        box-shadow: rgba(0, 0, 0, 0.54) -4px 13px 30px -11px;
        border-radius: 20px;
      }
      #${OVERLAY_ID}.jda-theme-dark {
        --jda-surface: #1b1f23de;
        --jda-contrast: #1b1f23;
        --jda-border: rgba(46, 54, 76, 0.85);
        --jda-text: #e4ecfb;
        --jda-muted: #9aa7c6;
        --jda-button-bg: rgba(30, 38, 58, 0.92);
        --jda-shadow-dark: rgba(6, 8, 15, 0.75);
        --jda-shadow-light: rgba(255, 255, 255, 0.05);
        --jda-accent: #30c0f5;
        --jda-accent-strong: #7ea9ff;
        --jda-button-bg: rgba(33, 42, 64, 0.92);
      }
      #${OVERLAY_ID}.jda-overlay-dragging {
        cursor: grabbing;
      }
      #${OVERLAY_ID}.jda-overlay-dragging .${CARD_CLASS} {
        box-shadow: none;
      }
      #${OVERLAY_ID} .${CARD_CLASS} {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 0;
        width: min(400px, calc(100vw - 24px));
        max-width: min(400px, calc(100vw - 16px));
        height: min(90vh, calc(100vh - 28px));
        max-height: calc(100vh - 20px);
        min-height: 600px;
        background: var(--jda-surface);
        color: inherit;
        border-radius: 20px;
        box-shadow: none;
        border: 1px solid var(--jda-border);
        overflow: hidden;
        pointer-events: auto;
        padding: 2px;
        transition: box-shadow 180ms ease;
      }
      #${OVERLAY_ID} .jda-app-overlay-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 5px 10px;
        margin-bottom: 8px;
        border-radius: 18px;
        background: var(--jda-contrast);
        box-shadow: 3px 3px 6px var(--jda-shadow-dark), -3px -3px 6px var(--jda-shadow-light);
        color: inherit;
        cursor: grab;
        user-select: none;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        /* letter-spacing: 0.03em; */
      }
      #${OVERLAY_ID}.jda-overlay-dragging .jda-app-overlay-header {
        cursor: grabbing;
      }
      #${OVERLAY_ID} .jda-app-overlay-title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: inherit;
      }
      #${OVERLAY_ID} .jda-theme-toggle-wrapper {
        display: flex;
        align-items: center;
      }
      #${OVERLAY_ID} .jda-app-overlay-actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      #${OVERLAY_ID} .jda-theme-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px;
        border-radius: 999px;
        border: 1px solid var(--jda-border);
        background: var(--jda-button-bg);
      }
      #${OVERLAY_ID}:not(.jda-theme-dark) .jda-theme-toggle {
        background: rgb(231 231 231 / 66%);
      }
      #${OVERLAY_ID} .jda-theme-toggle button {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: none;
        background: transparent;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--jda-muted);
        cursor: pointer;
        transition: background 150ms ease, color 150ms ease, box-shadow 150ms ease;
      }
      #${OVERLAY_ID} .jda-theme-toggle button svg {
        width: 16px;
        height: 16px;
        stroke: currentColor;
      }
      #${OVERLAY_ID} .jda-theme-toggle button[data-active="true"] {
        background: linear-gradient(145deg, var(--jda-accent), var(--jda-accent-strong));
        color: #ffffff;
        box-shadow: 2px 2px 4px var(--jda-shadow-dark), -2px -2px 4px var(--jda-shadow-light);
      }
      #${OVERLAY_ID} .jda-theme-toggle button:hover {
        color: var(--jda-accent);
      }
      #${OVERLAY_ID} .jda-theme-toggle button:active {
        box-shadow: inset 2px 2px 4px var(--jda-shadow-dark), inset -2px -2px 4px var(--jda-shadow-light);
      }
      #${OVERLAY_ID} .jda-theme-toggle button:focus-visible {
        outline: 2px solid var(--jda-accent);
        outline-offset: 2px;
      }
      #${OVERLAY_ID} .jda-app-overlay-actions button {
        border: none;
        border-radius: 14px;
        width: 24px;
        height: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--jda-button-bg);
        color: inherit;
        padding: 0;
        cursor: pointer;
        box-shadow: 4px 4px 8px rgba(163, 177, 198, 0.5), -4px -4px 8px rgba(255, 255, 255, 0.7);
        transition: box-shadow 120ms ease;
      }
      #${OVERLAY_ID} .jda-app-overlay-actions button:hover {
        box-shadow: 3px 3px 6px rgba(163, 177, 198, 0.45), -3px -3px 6px rgba(255, 255, 255, 0.75);
      }
      #${OVERLAY_ID} .jda-app-overlay-actions button:active {
        box-shadow: inset 3px 3px 6px rgba(163, 177, 198, 0.6), inset -3px -3px 6px rgba(255, 255, 255, 0.8);
      }
      #${OVERLAY_ID} .jda-app-overlay-actions button:focus-visible {
        outline: 2px solid var(--jda-accent);
        outline-offset: 2px;
      }
      #${OVERLAY_ID} .jda-app-overlay-actions button[data-action="close"] {
        background: linear-gradient(145deg, var(--jda-accent), var(--jda-accent-strong));
        color: #ffffff;
        border: none;
        box-shadow: 1px 3px 4px rgba(79, 124, 255, 0.4), -5px -5px 5px rgba(255, 255, 255, 0.45);
      }
      #${OVERLAY_ID} .jda-app-overlay-actions button[data-action="close"]:active {
        box-shadow: inset 4px 4px 10px rgba(54, 87, 177, 0.6), inset -4px -4px 10px rgba(255, 255, 255, 0.4);
      }
      #${OVERLAY_ID}.jda-theme-dark .jda-app-overlay-actions button {
        box-shadow: 4px 4px 8px rgba(0, 0, 0, 0.7), -4px -4px 8px rgba(255, 255, 255, 0.12);
      }
      #${OVERLAY_ID}.jda-theme-dark .jda-app-overlay-actions button:hover {
        box-shadow: 3px 3px 6px rgba(0, 0, 0, 0.65), -3px -3px 6px rgba(255, 255, 255, 0.18);
      }
      #${OVERLAY_ID}.jda-theme-dark .jda-app-overlay-actions button:active {
        box-shadow: inset 3px 3px 6px rgba(0, 0, 0, 0.7), inset -3px -3px 6px rgba(255, 255, 255, 0.12);
      }
      #${OVERLAY_ID} .jda-app-overlay-body {
        flex: 1;
        border-radius: 16px;
        background: var(--jda-contrast);
        /* border: 1px solid var(--jda-border); */
        /* box-shadow: inset 4px 4px 8px var(--jda-shadow-dark), inset -4px -4px 8px var(--jda-shadow-light); */
        overflow: hidden;
        position: relative;
      }
      #${OVERLAY_ID} .jda-app-overlay-frame {
        width: 100%;
        height: 100%;
        border: none;
        background: var(--jda-surface);
        border-radius: 12px;
        box-shadow: inset 3px 3px 6px var(--jda-shadow-dark), inset -3px -3px 6px var(--jda-shadow-light);
      }
      #${OVERLAY_ID} .jda-app-overlay-resize {
        height: 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: ns-resize;
        background: transparent;
        border: none;
        margin-top: 5px;
      }
      #${OVERLAY_ID} .jda-app-overlay-resize::before {
        content: '';
        width: 50px;
        height: 3px;
        border-radius: 999px;
        background: #6d738a;
        /* border: 1px solid rgba(255, 255, 255, 0.4); */
        /* box-shadow: 3px 3px 6px rgba(163, 177, 198, 0.4), -1px -1px 6px rgba(255, 255, 255, 0.7); */
      }
      #${OVERLAY_ID} .jda-app-overlay-resize:active::before {
        box-shadow: inset 4px 4px 8px rgba(163, 177, 198, 0.6), inset -4px -4px 8px rgba(255, 255, 255, 0.9);
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

  function hasRuntime() {
    try {
      return !!(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function openOptionsPage() {
    const fallback = () => {
      try {
        const base = hasRuntime() ? chrome.runtime.getURL('ui/options.html') : 'ui/options.html';
        window.open(base, '_blank', 'noopener');
      } catch {}
    };
    if (!hasRuntime()) {
      fallback();
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' }, (resp) => {
        if (chrome.runtime.lastError) {
          console.debug('[JDA overlay] OPEN_OPTIONS_PAGE failed:', chrome.runtime.lastError.message);
          fallback();
          return;
        }
        if (!resp || !resp.ok) fallback();
      });
    } catch (err) {
      console.debug('[JDA overlay] openOptionsPage relay failed:', err);
      fallback();
    }
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
    if (!hasRuntime()) {
      console.warn('[JDA overlay] runtime context missing; cannot open popup');
      return;
    }
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
    const menuTitle = t('ui.menu.optionsMenu', 'Settings menu');
    const frameUrl = chrome.runtime.getURL('ui/popup.html');
    const themeToggleTitle = t('ui.theme.cycle', 'Switch theme');
    const themeStateLabels = {
      dark: t('ui.theme.state.dark', 'Dark theme'),
      system: t('ui.theme.state.system', 'Match system theme'),
      light: t('ui.theme.state.light', 'Light theme')
    };
    const metaTitle = t('ui.metaOverlay.buttonTitle', 'Page meta data');

    const container = document.createElement('div');
    container.id = OVERLAY_ID;
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'false');
    container.setAttribute('aria-label', title);
    container.innerHTML = `
      <div class="${CARD_CLASS}">
        <div class="jda-app-overlay-header" data-drag-handle>
          <span class="jda-app-overlay-title" data-i18n-key="ui.app.title">${title}</span>
          <div class="jda-theme-toggle-wrapper">
            <div class="jda-theme-toggle" role="radiogroup" aria-label="${themeToggleTitle}">
              <button type="button" role="radio" data-theme-option="dark" aria-checked="false" data-active="false">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"></path>
                </svg>
              </button>
              <button type="button" role="radio" data-theme-option="system" aria-checked="true" data-active="false">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                  <path d="M8 21h8"></path>
                  <path d="M12 17v4"></path>
                </svg>
              </button>
              <button type="button" role="radio" data-theme-option="light" aria-checked="false" data-active="false">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="5"></circle>
                  <path d="M12 1v2"></path>
                  <path d="M12 21v2"></path>
                  <path d="M4.22 4.22l1.42 1.42"></path>
                  <path d="M18.36 18.36l1.42 1.42"></path>
                  <path d="M1 12h2"></path>
                  <path d="M21 12h2"></path>
                  <path d="M4.22 19.78l1.42-1.42"></path>
                  <path d="M18.36 5.64l1.42-1.42"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="jda-app-overlay-actions">
            <button type="button" id="metaOverlay" class="jda-app-overlay-meta" title="${metaTitle}" aria-label="${metaTitle}" data-i18n-title-key="ui.metaOverlay.buttonTitle" data-i18n-attr-aria-label="ui.metaOverlay.buttonTitle">M</button>
            <button type="button" id="menu" class="jda-app-overlay-menu" title="${menuTitle}" data-i18n-title-key="ui.menu.optionsMenu">☰</button>
            <button type="button" data-action="close" data-i18n-title-key="ui.highlighter.close" title="${closeTitle}">✕</button>
          </div>
        </div>
        <div class="jda-app-overlay-body">
          <iframe class="jda-app-overlay-frame" src="${frameUrl}" allow="clipboard-read; clipboard-write"></iframe>
        </div>
        <div class="jda-app-overlay-resize" data-resize-handle></div>
      </div>
    `;

    container.style.top = '5px';
    container.style.right = '15px';
    container.style.left = 'auto';
    container.style.transform = 'none';

    document.body.appendChild(container);
    state.root = container;
    state.card = container.querySelector(`.${CARD_CLASS}`);
    state.frame = container.querySelector('.jda-app-overlay-frame');
    applyOverlayTranslations(container);

    const menuBtn = container.querySelector('#menu');
    menuBtn?.addEventListener('click', (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      openOptionsPage();
    }, true);

    state.themeToggle = container.querySelector('.jda-theme-toggle');
    state.themeToggleButtons = Array.from(state.themeToggle?.querySelectorAll('[data-theme-option]') || []);
    state.themeToggleButtons.forEach((btn) => {
      btn.addEventListener('click', onThemeButtonClick, true);
    });
    refreshThemeToggleLabels();

    const metaBtn = container.querySelector('#metaOverlay');
    metaBtn?.addEventListener('click', (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const metaOverlay = window.__JDA_META_OVERLAY__;
      if (metaOverlay) metaOverlay.toggle();
      else console.debug('[JDA overlay] Meta overlay helper is missing.');
    }, true);

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
    initThemeControl();
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

    try { window.__JDA_META_OVERLAY__?.close(); } catch {}

    cleanupThemeControl();
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
