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
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content/app-overlay.css');
    (document.head || document.documentElement).appendChild(link);
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
    const frameUrl = chrome.runtime.getURL('ui/popup.html?context=overlay');
    const themeToggleTitle = t('ui.theme.cycle', 'Switch theme');
    const themeStateLabels = {
      dark: t('ui.theme.state.dark', 'Dark theme'),
      system: t('ui.theme.state.system', 'Match system theme'),
      light: t('ui.theme.state.light', 'Light theme')
    };
    const metaTitle = t('ui.metaOverlay.buttonTitle', 'Page meta data');
    const refreshTitle = t('ui.popup.refresh', 'Refresh');

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
            <button type="button" id="refreshView" class="jda-app-overlay-refresh icon-only i-refresh" title="${refreshTitle}" aria-label="${refreshTitle}"></button>
            <button type="button" id="metaOverlay" class="jda-app-overlay-meta icon-only i-meta" title="${metaTitle}" aria-label="${metaTitle}" data-i18n-title-key="ui.metaOverlay.buttonTitle" data-i18n-attr-aria-label="ui.metaOverlay.buttonTitle"></button>
            <button type="button" id="menu" class="jda-app-overlay-menu icon-only i-settings" title="${menuTitle}" data-i18n-title-key="ui.menu.optionsMenu" aria-label="${menuTitle}"></button>
            <button type="button" data-action="close" class="icon-only i-close" data-i18n-title-key="ui.highlighter.close" title="${closeTitle}" aria-label="${closeTitle}"></button>
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

    const refreshBtn = container.querySelector('#refreshView');
    refreshBtn?.addEventListener('click', (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      try {
        state.frame?.contentWindow?.location?.reload?.();
      } catch {}
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
