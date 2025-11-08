// shared/i18n-content.js — лёгкий i18n для контент-скриптов
(function attachI18nHelpers(globalScope) {
  if (globalScope.__JDA_I18N__) return;

  let currentLang = 'en';
  let localeDict = null;
  let localeLoading = null;

  function lookupLocale(key) {
    if (!localeDict || !key) return undefined;
    if (Object.prototype.hasOwnProperty.call(localeDict, key)) {
      const value = localeDict[key];
      return typeof value === 'string' ? value : undefined;
    }
    if (key.includes('.')) {
      const parts = key.split('.');
      let ref = localeDict;
      for (const part of parts) {
        if (ref && typeof ref === 'object' && Object.prototype.hasOwnProperty.call(ref, part)) {
          ref = ref[part];
        } else {
          ref = undefined;
          break;
        }
      }
      if (typeof ref === 'string') return ref;
    }
    return undefined;
  }

  function urlForLocale(lang) {
    const base = chrome.runtime?.getURL?.(`ui/locales/${lang}.json`) || `ui/locales/${lang}.json`;
    return `${base}?ts=${Date.now()}`;
  }

  async function fetchLocale(lang) {
    const resp = await fetch(urlForLocale(lang), { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  async function readStoredLang() {
    try {
      return await new Promise(resolve => {
        chrome.storage.local.get({ uiLang: 'en' }, (value) => resolve((value && value.uiLang) || 'en'));
      });
    } catch {
      return 'en';
    }
  }

  async function determineLocale() {
    const storedLang = await readStoredLang();
    const candidates = Array.from(new Set([storedLang || 'en', 'en']));
    let lastErr = null;
    for (const candidate of candidates) {
      try {
        const json = await fetchLocale(candidate);
        if (json && typeof json === 'object') {
          localeDict = json;
          currentLang = candidate.toLowerCase();
          return;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    localeDict = {};
    currentLang = 'en';
    if (lastErr) throw lastErr;
  }

  function ensureLocaleLoaded(force = false, onApplied) {
    if (!force && localeDict) {
      if (onApplied) onApplied();
      return Promise.resolve();
    }
    if (localeLoading) {
      return localeLoading.then(() => { if (onApplied) onApplied(); });
    }
    localeLoading = determineLocale()
      .catch(() => {})
      .finally(() => {
        localeLoading = null;
        if (onApplied) onApplied();
      });
    return localeLoading;
  }

  function translate(key, fallback = '') {
    const localized = lookupLocale(key);
    if (typeof localized === 'string' && localized.length) return localized;
    try {
      const runtimeVal = chrome.i18n?.getMessage?.(key);
      if (runtimeVal) return runtimeVal;
    } catch {
      // ignore
    }
    return fallback || key;
  }

  function applyTranslations(root = document) {
    const scope = root instanceof Element ? root : document;

    scope.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      let translated = translate(key, el.textContent || '');
      if (el.dataset) {
        for (const [name, value] of Object.entries(el.dataset)) {
          if (value == null || name === 'i18n' || name === 'defaultI18n') continue;
          translated = translated.replace(new RegExp(`{{${name}}}`, 'g'), String(value));
        }
      }
      el.textContent = translated;
    });

    scope.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const key = el.getAttribute('data-i18n-ph');
      if (!key) return;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.placeholder = translate(key, el.placeholder || '');
      }
    });

    scope.querySelectorAll('*').forEach(el => {
      for (const attrName of el.getAttributeNames()) {
        if (!attrName.startsWith('data-i18n-attr-')) continue;
        const targetAttr = attrName.replace('data-i18n-attr-', '');
        const key = el.getAttribute(attrName);
        if (!key) continue;
        const val = translate(key, el.getAttribute(targetAttr) || '');
        el.setAttribute(targetAttr, val);
      }
    });
  }

  function watchLocaleChanges(callback) {
    if (!chrome?.storage?.onChanged?.addListener) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.uiLang) return;
      localeDict = null;
      ensureLocaleLoaded(true, callback);
    });
  }

  globalScope.__JDA_I18N__ = {
    ensureLocaleLoaded,
    t: translate,
    watchLocaleChanges,
    applyTranslations,
    currentLang: () => currentLang
  };
})(typeof window !== 'undefined' ? window : globalThis);
