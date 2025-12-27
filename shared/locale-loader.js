// shared/locale-loader.js — helper to load UI locale JSON inside background scripts

const CACHE = new Map();
const UI_LANG_KEY = 'uiLang';
let cachedLang = null;

function normalizeLocale(locale) {
  const fallback = 'en';
  if (!locale || typeof locale !== 'string') return fallback;
  return locale.toLowerCase().split(/[-_]/)[0] || fallback;
}

async function loadLocale(locale) {
  const norm = normalizeLocale(locale);
  if (CACHE.has(norm)) return CACHE.get(norm);
  try {
    const url = chrome.runtime.getURL(`ui/locales/${norm}.json`);
    const res = await fetch(url);
    if (res?.ok) {
      const json = await res.json();
      CACHE.set(norm, json);
      return json;
    }
  } catch {
    // ignore
  }
  if (norm !== 'en') {
    return loadLocale('en');
  }
  CACHE.set(norm, {});
  return {};
}

export async function getLocaleString(locale, key, fallback = '') {
  const norm = normalizeLocale(locale);
  const data = await loadLocale(norm);
  const val = data?.[key];
  if (typeof val === 'string') return val;
  if (norm !== 'en') {
    const backup = await loadLocale('en');
    if (typeof backup?.[key] === 'string') return backup[key];
  }
  return fallback;
}

export async function getPreferredUILang() {
  if (cachedLang) return cachedLang;
  try {
    const res = await new Promise(resolve => {
      if (chrome?.storage?.local?.get) {
        chrome.storage.local.get([UI_LANG_KEY], resolve);
      } else {
        resolve({});
      }
    });
    const lang = normalizeLocale(res?.[UI_LANG_KEY] || 'en');
    cachedLang = lang;
    return lang;
  } catch {
    cachedLang = 'en';
    return 'en';
  }
}

export function resetPreferredUILangCache() {
  cachedLang = null;
}
