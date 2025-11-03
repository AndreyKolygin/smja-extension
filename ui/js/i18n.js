// ui/js/i18n.js
const I18N_STORAGE_KEY = 'uiLang';
let __i18nDict = {};
let __i18nLang = 'en';

function urlForLocale(lang) {
  // Файлы локалей ожидаются в ui/locales/<lang>.json
  // Добавляем ts для отключения кэша при повторных переключениях
  const base = chrome.runtime.getURL(`ui/locales/${lang}.json`);
  const ts = Date.now();
  return `${base}?ts=${ts}`;
}

export async function loadLocale(lang) {
  const tryLangs = Array.from(new Set([lang || 'en', 'en']));
  let lastErr = null;

  for (const code of tryLangs) {
    try {
      const url = urlForLocale(code);
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      __i18nDict = json || {};
      __i18nLang = code;
      try { document.documentElement.setAttribute('lang', __i18nLang); } catch {}
      // Чтобы было проще отлаживать:
      console.debug('[i18n] loaded locale', code);
      return;
    } catch (e) {
      lastErr = e;
      console.warn('[i18n] load failed for', code, e);
    }
  }

  // Если вообще ничего не загрузилось — оставляем пустой словарь
  __i18nDict = {};
  __i18nLang = 'en';
  throw lastErr || new Error('Failed to load locales');
}

// Достаёт перевод по ключу. Поддерживает вложенные ключи через точки: a.b.c
export function t(key, fallback = '') {
  if (!key) return fallback || '';
  if (__i18nDict && Object.prototype.hasOwnProperty.call(__i18nDict, key)) {
    const v = __i18nDict[key];
    return (v == null ? '' : String(v));
  }
  if (key.includes('.')) {
    const parts = key.split('.');
    let ref = __i18nDict;
    for (const p of parts) {
      if (ref && typeof ref === 'object' && p in ref) ref = ref[p];
      else { ref = undefined; break; }
    }
    if (typeof ref === 'string') return ref;
  }
  return fallback || key;
}

/**
 * Идемпотентно применяет переводы:
 *  - [data-i18n="key"] → textContent
 *  - [data-i18n-ph="key"] → placeholder для input/textarea
 *  - любые атрибуты вида data-i18n-attr-title, data-i18n-attr-aria-label и т.п.
 * Вызывать можно много раз (после рендеров таблиц/модалок).
 */
export function applyTranslations(root = document) {
  const scope = root instanceof Element ? root : document;

  // Текстовые узлы
  scope.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    let translated = t(key, el.textContent || '');
    const entries = el.dataset ? Object.entries(el.dataset) : [];
    for (const [name, val] of entries) {
      if (val == null) continue;
      if (name === 'defaultI18n') continue;
      translated = translated.replace(new RegExp(`{{${name}}}`, 'g'), String(val));
    }
    el.textContent = translated;
  });

  // Placeholder для input/textarea
  scope.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph');
    if (!key) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.placeholder = t(key, el.placeholder || '');
    }
  });

  // Произвольные атрибуты data-i18n-attr-*
  scope.querySelectorAll('*').forEach(el => {
    for (const attrName of el.getAttributeNames()) {
      if (!attrName.startsWith('data-i18n-attr-')) continue;
      const targetAttr = attrName.replace('data-i18n-attr-', '');
      const key = el.getAttribute(attrName);
      if (!key) continue;
      const val = t(key, el.getAttribute(targetAttr) || '');
      el.setAttribute(targetAttr, val);
    }
  });
}

export async function getSavedLang() {
  try {
    const res = await new Promise(resolve =>
      chrome.storage.local.get([I18N_STORAGE_KEY], resolve)
    );
    return res?.[I18N_STORAGE_KEY] || 'en';
  } catch {
    return 'en';
  }
}

export async function setSavedLang(lang) {
  try {
    await new Promise(resolve =>
      chrome.storage.local.set({ [I18N_STORAGE_KEY]: lang }, resolve)
    );
  } catch {}
}

export function currentLang() {
  return __i18nLang;
}
