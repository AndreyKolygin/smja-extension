// background/utils.js — общие вспомогательные функции для service worker

let __busy = false;

export function sanitizeText(t, max = 24000) {
  if (typeof t !== 'string') return '';
  if (t.length <= max) return t;
  return t.slice(0, max) + `\n\n[trimmed to ${max} chars]`;
}

export function requireFields(obj, fields) {
  for (const f of fields) {
    const v = obj?.[f];
    if (typeof v !== 'string' || !v.trim()) {
      throw new Error(`Invalid payload: ${f} is required`);
    }
  }
}

export async function guardedCall(fn) {
  if (__busy) throw new Error('Busy: previous request in progress');
  __busy = true;
  try {
    return await fn();
  } finally {
    __busy = false;
  }
}

export function nowMs() {
  return Date.now();
}
