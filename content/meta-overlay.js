// content/meta-overlay.js — вспомогательное окно с метаданными страницы
(() => {
  if (window.__JDA_META_OVERLAY__) return;

  const OVERLAY_ID = 'jda-meta-overlay';
  const STYLE_ID = 'jda-meta-overlay-style';
  const DRAG_HANDLE = '.jda-meta-overlay-header';

  const KEY_ATTRS = [
    { attr: 'name', prefix: 'name' },
    { attr: 'property', prefix: 'property' },
    { attr: 'itemprop', prefix: 'itemprop' },
    { attr: 'http-equiv', prefix: 'http-equiv' }
  ];

  const BASE_VARIABLE_KEYS = [
    'author',
    'content',
    'selection',
    'selectionHtml',
    'date',
    'time',
    'description',
    'domain',
    'favicon',
    'highlights',
    'image',
    'noteName',
    'published',
    'site',
    'title',
    'url',
    'words'
  ];

  const i18n = window.__JDA_I18N__ || {};
  const ensureLocaleLoaded = i18n.ensureLocaleLoaded || ((force, cb) => { if (cb) cb(); return Promise.resolve(); });
  const watchLocaleChanges = i18n.watchLocaleChanges || (() => {});
  const translate = i18n.t || ((key, fallback) => fallback || key);
  const applyI18n = i18n.applyTranslations || (() => {});

  const copyTimers = new WeakMap();

  const state = {
    root: null,
    refreshBtn: null,
    refreshHandler: null,
    baseEntries: [],
    metaEntries: [],
    sections: {},
    keyHandler: null,
    searchInput: null,
    searchHandler: null,
    searchTerm: '',
    drag: {
      active: false,
      pointerId: null,
      offsetX: 0,
      offsetY: 0,
      move: null,
      up: null,
      handle: null
    }
  };

  let localeReady = false;
  const applyTranslationsLater = () => {
    if (state.root) applyI18n(state.root);
  };
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

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        top: 10px;
        right: 20px;
        z-index: 2147483646;
        width: min(460px, calc(100vw - 30px));
        max-height: calc(100vh - 120px);
        pointer-events: none;
      }
      #${OVERLAY_ID} .jda-meta-overlay-card {
        background: rgba(15, 23, 42, 0.98);
        color: #f8fafc;
        border-radius: 20px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        box-shadow: 0 20px 48px rgba(15, 23, 42, 0.45);
        display: flex;
        flex-direction: column;
        max-height: 100%;
        pointer-events: auto;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        overflow: hidden;
      }
      #${OVERLAY_ID} .jda-meta-overlay-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 12px 16px 4px;
        gap: 16px;
      }
      #${OVERLAY_ID} .jda-meta-overlay-headings {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      #${OVERLAY_ID} .jda-meta-overlay-title {
        font-size: 15px;
        font-weight: 700;
      }
      #${OVERLAY_ID} .jda-meta-overlay-subtitle {
        font-size: 12px;
        color: rgba(248, 250, 252, 0.7);
      }
      #${OVERLAY_ID} .jda-meta-overlay-actions {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      #${OVERLAY_ID} .jda-meta-overlay-actions button {
        border: none;
        border-radius: 999px;
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(148, 163, 184, 0.16);
        color: inherit;
        cursor: pointer;
        padding: 0;
      }
      #${OVERLAY_ID} .jda-meta-overlay-actions button:hover {
        background: rgba(148, 163, 184, 0.28);
      }
      #${OVERLAY_ID} .jda-meta-overlay-headings {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      #${OVERLAY_ID} .jda-meta-overlay-search {
        width: 90%;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.25);
        background: rgba(15, 23, 42, 0.6);
        color: inherit;
        font-size: 12px;
        padding: 6px 12px;
        outline: none;
      }
      #${OVERLAY_ID} .jda-meta-overlay-search::placeholder {
        color: rgba(248, 250, 252, 0.5);
      }
      #${OVERLAY_ID} .jda-meta-overlay-search:focus {
        border-color: rgba(59, 130, 246, 0.8);
      }
      #${OVERLAY_ID} .jda-meta-overlay-body {
        padding: 6px 16px 16px;
        overflow-y: auto;
        scrollbar-width: thin;
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-height: calc(100vh - 120px);
      }
      #${OVERLAY_ID} .jda-meta-overlay-empty {
        font-size: 13px;
        color: rgba(248, 250, 252, 0.75);
        padding: 20px 0;
      }
      #${OVERLAY_ID} .jda-meta-section {
        border-radius: 16px;
        background: #1e2836;
        border: 1px solid rgba(148, 163, 184, 0.14);
        padding: 12px;
      }
      #${OVERLAY_ID} .jda-meta-section-toggle {
        width: 100%;
        border: none;
        background: transparent;
        color: inherit;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        padding: 0;
      }
      #${OVERLAY_ID} .jda-meta-section-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }
      #${OVERLAY_ID} .jda-meta-section-count {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.2);
        color: rgba(248, 250, 252, 0.9);
        margin-left: 8px;
        flex: 0 0 auto;
      }
      #${OVERLAY_ID} .jda-meta-section-chevron {
        width: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-left: auto;
        background: #252e41;
        padding: 2px 10px;
        border-radius: 999px;
      }
      #${OVERLAY_ID} .jda-meta-section-chevron::before {
        content: 'v';
        font-size: 11px;
        transition: transform 0.2s ease;
      }
      #${OVERLAY_ID} .jda-meta-section.collapsed .jda-meta-section-chevron::before {
        transform: rotate(-90deg);
      }
      #${OVERLAY_ID} .jda-meta-section-body {
        margin-top: 10px;
        border-top: 1px solid rgba(148, 163, 184, 0.18);
        padding-top: 10px;
      }
      #${OVERLAY_ID} .jda-meta-section.collapsed .jda-meta-section-body {
        display: none;
      }
      #${OVERLAY_ID} .jda-meta-entry {
        border: 1px solid rgba(248, 250, 252, 0.08);
        border-radius: 14px;
        padding: 10px 12px;
        margin-bottom: 10px;
        background: rgba(15, 23, 42, 0.7);
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      #${OVERLAY_ID} .jda-meta-entry-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      #${OVERLAY_ID} .jda-meta-entry-key {
        border: none;
        background: rgba(15, 118, 255, 0.12);
        color: #bae6fd;
        font-size: 12px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 999px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: background 0.12s ease;
      }
      #${OVERLAY_ID} .jda-meta-entry-key:hover {
        background: rgba(14, 165, 233, 0.28);
      }
      #${OVERLAY_ID} .jda-meta-entry-key.copied {
        background: rgba(22, 163, 74, 0.3);
        color: #dcfce7;
      }
      #${OVERLAY_ID} .jda-meta-entry-index {
        font-size: 11px;
        color: rgba(248, 250, 252, 0.65);
      }
      #${OVERLAY_ID} .jda-meta-entry-content {
        font-size: 13px;
        line-height: 1.5;
        color: rgba(248, 250, 252, 0.95);
        word-break: break-word;
        white-space: pre-wrap;
      }
      #${OVERLAY_ID} .jda-meta-overlay-body::-webkit-scrollbar {
        width: 6px;
      }
      #${OVERLAY_ID} .jda-meta-overlay-body::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.35);
        border-radius: 999px;
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

  function beginDrag(event) {
    if (!state.root) return;
    if (event.button !== 0) return;
    if (event.target.closest('button') || event.target.closest('input, textarea')) return;
    event.preventDefault();

    const rect = state.root.getBoundingClientRect();
    const { left, top } = clampPosition(rect.left, rect.top, rect.width, rect.height);
    state.root.style.left = `${left}px`;
    state.root.style.top = `${top}px`;
    state.root.style.right = 'auto';

    state.drag.active = true;
    state.drag.pointerId = event.pointerId;
    state.drag.offsetX = event.clientX - left;
    state.drag.offsetY = event.clientY - top;
    state.drag.handle = event.currentTarget;
    state.drag.handle?.setPointerCapture?.(event.pointerId);

    state.drag.move = (moveEvent) => {
      if (!state.drag.active) return;
      moveEvent.preventDefault();
      const nextLeft = moveEvent.clientX - state.drag.offsetX;
      const nextTop = moveEvent.clientY - state.drag.offsetY;
      const { left: clampedLeft, top: clampedTop } = clampPosition(
        nextLeft,
        nextTop,
        rect.width,
        rect.height
      );
      state.root.style.left = `${clampedLeft}px`;
      state.root.style.top = `${clampedTop}px`;
      state.root.style.right = 'auto';
    };

    state.drag.up = () => {
      if (!state.drag.active) return;
      state.drag.active = false;
      if (state.drag.pointerId != null && state.drag.handle) {
        state.drag.handle.releasePointerCapture?.(state.drag.pointerId);
      }
      window.removeEventListener('pointermove', state.drag.move, true);
      window.removeEventListener('pointerup', state.drag.up, true);
      window.removeEventListener('pointercancel', state.drag.up, true);
      state.drag.pointerId = null;
      state.drag.move = null;
      state.drag.up = null;
      state.drag.handle = null;
    };

    window.addEventListener('pointermove', state.drag.move, true);
    window.addEventListener('pointerup', state.drag.up, true);
    window.addEventListener('pointercancel', state.drag.up, true);
  }

  function attachDrag(handle) {
    handle?.addEventListener('pointerdown', beginDrag, true);
  }

  function detachDrag(handle) {
    handle?.removeEventListener('pointerdown', beginDrag, true);
  }

  function safeString(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
      return String(value);
    } catch {
      return '';
    }
  }

  function collectSelection() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return { text: '', html: '' };
      const text = sel.toString().trim();
      const range = sel.getRangeAt(0).cloneContents();
      const div = document.createElement('div');
      div.appendChild(range);
      return { text, html: div.innerHTML };
    } catch {
      return { text: '', html: '' };
    }
  }

  function getMainImage() {
    const selectors = [
      'meta[property="og:image"]',
      'meta[name="og:image"]',
      'meta[name="twitter:image"]',
      'link[rel="image_src"]',
      'meta[itemprop="image"]'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        const val = el?.getAttribute('content') || el?.getAttribute('href') || '';
        if (val) return val;
      } catch {}
    }
    return '';
  }

  function getFavicon() {
    const rels = ['icon', 'shortcut icon', 'apple-touch-icon'];
    for (const rel of rels) {
      try {
        const el = document.querySelector(`link[rel="${rel}"]`);
        const href = el?.getAttribute('href');
        if (href) return new URL(href, document.baseURI).href;
      } catch {}
    }
    return '';
  }

  function getBodyText() {
    if (!document?.body) return '';
    const text = document.body.innerText || document.body.textContent || '';
    return text.trim();
  }

  function collectBaseVariables() {
    const selection = collectSelection();
    const content = getBodyText();
    const wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;
    const nowIso = new Date().toISOString();
    const hostname = location.hostname || '';
    return {
      author: document.querySelector('meta[name="author"]')?.content || '',
      content,
      selection: selection.text || '',
      selectionHtml: selection.html || '',
      date: nowIso,
      time: nowIso,
      description: document.querySelector('meta[name="description"]')?.content || '',
      domain: hostname.replace(/^www\./, ''),
      favicon: getFavicon(),
      highlights: '',
      image: getMainImage(),
      noteName: '',
      published: document.querySelector('meta[property="article:published_time"]')?.content || '',
      site: hostname,
      title: document.title || '',
      url: location.href || '',
      words: wordCount ? String(wordCount) : '0'
    };
  }

  function readBaseEntries() {
    const base = collectBaseVariables();
    return BASE_VARIABLE_KEYS.map((key) => {
      const value = safeString(base[key]);
      return {
        id: `base:${key}`,
        displayKey: key,
        copyValue: `{{${key}}}`,
        templateKey: key,
        content: value
      };
    });
  }

  function readMetaEntries() {
    if (!document || !document.querySelectorAll) return [];
    const nodes = Array.from(document.querySelectorAll('meta'));
    const entries = [];
    nodes.forEach((meta, idx) => {
      let match = null;
      for (const candidate of KEY_ATTRS) {
        const value = meta.getAttribute(candidate.attr);
        if (value) {
          match = { attr: candidate.attr, prefix: candidate.prefix, value: value.trim() };
          break;
        }
      }
      if (!match) return;
      const content = meta.getAttribute('content') || meta.getAttribute('value') || meta.getAttribute('charset') || '';
      entries.push({
        id: `${match.prefix}:${match.value}:${idx}`,
        order: idx,
        prefix: match.prefix,
        attr: match.attr,
        key: match.value,
        templateKey: `meta:${match.prefix}:${match.value}`,
        displayKey: `meta:${match.prefix}:${match.value}`,
        copyValue: `{{meta:${match.prefix}:${match.value}}}`,
        content
      });
    });
    const counts = new Map();
    entries.forEach(entry => {
      const next = (counts.get(entry.templateKey) || 0) + 1;
      counts.set(entry.templateKey, next);
      entry.instance = next;
    });
    return entries;
  }

  function truncateContent(value, limit = 320) {
    if (!value) return '';
    const clean = value.replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;
    return `${clean.slice(0, limit - 1)}…`;
  }

  async function copyToClipboard(text) {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function handleCopy(button, text) {
    if (!button || !text) return;
    const originalLabel = button.dataset.originalLabel || button.textContent || '';
    button.dataset.originalLabel = originalLabel;
    copyToClipboard(text).then((ok) => {
      if (!ok) {
        console.debug('[JDA meta overlay] copy failed');
        return;
      }
      const copiedLabel = t('ui.metaOverlay.copiedLabel', 'Copied');
      button.classList.add('copied');
      if (copiedLabel) button.textContent = copiedLabel;
      if (copyTimers.has(button)) {
        clearTimeout(copyTimers.get(button));
      }
      const timer = setTimeout(() => {
        button.classList.remove('copied');
        button.textContent = button.dataset.originalLabel || originalLabel;
        copyTimers.delete(button);
      }, 3000);
      copyTimers.set(button, timer);
    });
  }

  function buildEntryNode(entry) {
    const item = document.createElement('div');
    item.className = 'jda-meta-entry';

    const head = document.createElement('div');
    head.className = 'jda-meta-entry-head';

    const keyBtn = document.createElement('button');
    keyBtn.type = 'button';
    keyBtn.className = 'jda-meta-entry-key';
    keyBtn.title = t('ui.metaOverlay.copyTitle', 'Copy placeholder');
    keyBtn.textContent = entry.displayKey || entry.templateKey;
    keyBtn.addEventListener('click', () => handleCopy(keyBtn, entry.copyValue || entry.templateKey));
    head.appendChild(keyBtn);

    if (entry.instance > 1) {
      const index = document.createElement('span');
      index.className = 'jda-meta-entry-index';
      index.textContent = `#${entry.instance}`;
      head.appendChild(index);
    }

    item.appendChild(head);

    const content = document.createElement('div');
    content.className = 'jda-meta-entry-content';
    const text = truncateContent(entry.content);
    content.textContent = text || t('ui.metaOverlay.noContent', '(no content)');
    if (entry.content) {
      content.setAttribute('title', entry.content);
    } else {
      content.removeAttribute('title');
    }
    item.appendChild(content);

    return item;
  }

  function filterEntries(entries) {
    const term = state.searchTerm?.trim();
    if (!term) return entries;
    const needle = term.toLowerCase();
    return entries.filter((entry) => {
      const fields = [
        entry.displayKey,
        entry.copyValue,
        entry.templateKey,
        entry.content
      ];
      return fields.some(value => safeString(value).toLowerCase().includes(needle));
    });
  }

  function renderSectionEntries(sectionId, entries) {
    const refs = state.sections?.[sectionId];
    if (!refs) return;
    const filtered = filterEntries(entries);
    const { list, empty, count } = refs;
    if (count) {
      count.textContent = String(filtered.length);
    }
    if (!list || !empty) return;
    list.textContent = '';

    if (!filtered.length) {
      empty.hidden = false;
      list.hidden = true;
      return;
    }
    empty.hidden = true;
    list.hidden = false;

    const frag = document.createDocumentFragment();
    filtered.forEach((entry) => {
      frag.appendChild(buildEntryNode(entry));
    });
    list.appendChild(frag);
  }

  function refreshEntries() {
    state.baseEntries = readBaseEntries();
    state.metaEntries = readMetaEntries();
    renderSectionEntries('base', state.baseEntries);
    renderSectionEntries('meta', state.metaEntries);
  }

  function toggleSection(sectionId, expand) {
    const refs = state.sections?.[sectionId];
    if (!refs?.toggle || !refs?.body || !refs?.section) return;
    const next = expand === undefined ? refs.toggle.getAttribute('aria-expanded') !== 'true' : !!expand;
    refs.toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    refs.body.hidden = !next;
    if (next) refs.section.classList.remove('collapsed');
    else refs.section.classList.add('collapsed');
  }

  function setupSections(container) {
    const ids = ['base', 'meta'];
    state.sections = {};
    ids.forEach((id) => {
      const section = container.querySelector(`[data-section="${id}"]`);
      if (!section) return;
      const refs = {
        section,
        toggle: section.querySelector(`[data-section-toggle="${id}"]`),
        body: section.querySelector(`[data-section-body="${id}"]`),
        list: section.querySelector(`[data-section-list="${id}"]`),
        empty: section.querySelector(`[data-section-empty="${id}"]`),
        count: section.querySelector(`[data-section-count="${id}"]`)
      };
      state.sections[id] = refs;
      if (refs.toggle) {
        refs.toggle.addEventListener('click', () => toggleSection(id));
        refs.toggle.setAttribute('aria-expanded', 'true');
      }
      if (refs.section) {
        refs.section.classList.remove('collapsed');
      }
      if (refs.body) refs.body.hidden = false;
    });

    state.searchInput = container.querySelector('.jda-meta-overlay-search');
    if (state.searchInput) {
      state.searchInput.value = state.searchTerm || '';
      state.searchHandler = (event) => {
        state.searchTerm = String(event?.target?.value || '');
        renderSectionEntries('base', state.baseEntries);
        renderSectionEntries('meta', state.metaEntries);
      };
      state.searchInput.addEventListener('input', state.searchHandler);
    }
  }

  function bindEvents(container) {
    const closeBtn = container.querySelector('button[data-action="close"]');
    closeBtn?.addEventListener('click', () => closeOverlay());

    state.refreshBtn = container.querySelector('[data-action="refresh-meta"]');
    if (state.refreshBtn) {
      state.refreshHandler = () => refreshEntries();
      state.refreshBtn.addEventListener('click', state.refreshHandler);
    }

    state.keyHandler = (event) => {
      if (event.key === 'Escape') {
        closeOverlay();
      }
    };
    window.addEventListener('keydown', state.keyHandler, true);
  }

  function createOverlay() {
    ensureStyle();
    const container = document.createElement('div');
    container.id = OVERLAY_ID;
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-label', t('ui.metaOverlay.title', 'Meta overlay'));
    container.innerHTML = `
      <div class="jda-meta-overlay-card">
        <div class="jda-meta-overlay-header">
          <div class="jda-meta-overlay-headings">
            <div class="jda-meta-overlay-title" data-i18n="ui.metaOverlay.title">${t('ui.metaOverlay.title', 'Meta tags detected on this page')}</div>
            <input type="text" class="jda-meta-overlay-search" data-i18n-ph="ui.metaOverlay.searchPlaceholder" placeholder="${t('ui.metaOverlay.searchPlaceholder', 'Search meta tags')}" value="">
          </div>
          <div class="jda-meta-overlay-actions">
            <button type="button" data-action="refresh-meta" data-i18n-title-key="ui.metaOverlay.refresh" title="${t('ui.metaOverlay.refresh', 'Refresh')}">⟳</button>
            <button type="button" data-action="close" data-i18n-title-key="ui.highlighter.close" title="${t('ui.highlighter.close', 'Close')}">✕</button>
          </div>
        </div>
        <div class="jda-meta-overlay-body">
          <div class="jda-meta-section" data-section="base">
            <button type="button" class="jda-meta-section-toggle" data-section-toggle="base" aria-expanded="true">
              <span class="jda-meta-section-title" data-i18n="ui.metaOverlay.section.base">${t('ui.metaOverlay.section.base', 'Page data')}</span>
              <span class="jda-meta-section-count" data-section-count="base">0</span>
              <span class="jda-meta-section-chevron" aria-hidden="true"></span>
            </button>
            <div class="jda-meta-section-body" data-section-body="base">
              <div class="jda-meta-overlay-empty" data-section-empty="base" data-i18n="ui.metaOverlay.baseEmpty">${t('ui.metaOverlay.baseEmpty', 'No base variables detected.')}</div>
              <div class="jda-meta-overlay-list" data-section-list="base"></div>
            </div>
          </div>
          <div class="jda-meta-section" data-section="meta">
            <button type="button" class="jda-meta-section-toggle" data-section-toggle="meta" aria-expanded="true">
              <span class="jda-meta-section-title" data-i18n="ui.metaOverlay.section.meta">${t('ui.metaOverlay.section.meta', 'Meta tags')}</span>
              <span class="jda-meta-section-count" data-section-count="meta">0</span>
              <span class="jda-meta-section-chevron" aria-hidden="true"></span>
            </button>
            <div class="jda-meta-section-body" data-section-body="meta">
              <div class="jda-meta-overlay-empty" data-section-empty="meta" data-i18n="ui.metaOverlay.empty">${t('ui.metaOverlay.empty', 'No meta tags detected.')}</div>
              <div class="jda-meta-overlay-list" data-section-list="meta"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(container);
    state.root = container;
    setupSections(container);
    bindEvents(container);
    const handle = container.querySelector(DRAG_HANDLE);
    if (handle) attachDrag(handle);
    applyTranslationsLater();
    refreshEntries();
  }

  function openOverlay() {
    if (state.root) {
      refreshEntries();
      state.root.style.display = 'block';
      return;
    }
    if (!localeReady) {
      ensureLocaleLoaded(false, () => {
        localeReady = true;
        openOverlay();
      });
      return;
    }
    createOverlay();
  }

  function closeOverlay() {
    if (!state.root) return;
    if (state.refreshBtn && state.refreshHandler) {
      state.refreshBtn.removeEventListener('click', state.refreshHandler);
    }
    if (state.keyHandler) {
      window.removeEventListener('keydown', state.keyHandler, true);
      state.keyHandler = null;
    }
    const handle = state.root?.querySelector(DRAG_HANDLE);
    state.refreshBtn = null;
    state.refreshHandler = null;
    state.sections = {};
    state.baseEntries = [];
    state.metaEntries = [];
    state.searchTerm = '';
    if (state.searchInput && state.searchHandler) {
      state.searchInput.removeEventListener('input', state.searchHandler);
    }
    state.searchInput = null;
    state.searchHandler = null;
    if (handle) detachDrag(handle);
    try { state.root?.remove(); } catch {}
    state.root = null;
    if (state.drag.move) {
      window.removeEventListener('pointermove', state.drag.move, true);
      window.removeEventListener('pointerup', state.drag.up, true);
      window.removeEventListener('pointercancel', state.drag.up, true);
    }
    state.drag = {
      active: false,
      pointerId: null,
      offsetX: 0,
      offsetY: 0,
      move: null,
      up: null,
      handle: null
    };
  }

  function toggleOverlay() {
    if (state.root) closeOverlay();
    else openOverlay();
  }

  window.__JDA_META_OVERLAY__ = {
    open: openOverlay,
    close: closeOverlay,
    toggle: toggleOverlay,
    refresh: refreshEntries,
    isOpen: () => !!state.root
  };
})();
