// shared/cv.js — helpers for working with stored CV entries

const CV_ID_PREFIX = 'cv_';

function randomId() {
  return `${CV_ID_PREFIX}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}

export function normalizeCvEntry(raw = {}, idx = 0, { fallbackTitlePrefix = 'CV' } = {}) {
  const source = typeof raw === 'object' && raw ? raw : {};
  const titleFromRaw = typeof source.title === 'string' ? source.title.trim() : '';
  const fallbackTitle = `${fallbackTitlePrefix || 'CV'} ${idx + 1}`;
  const content = typeof source.content === 'string' ? source.content : '';
  const updatedAt = Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : (content ? Date.now() : 0);

  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : randomId(),
    title: titleFromRaw || fallbackTitle,
    content,
    updatedAt,
    isDefault: !!source.isDefault
  };
}

export function ensureCvList(rawList, { legacyText = '', fallbackTitlePrefix = 'CV' } = {}) {
  const list = Array.isArray(rawList) ? rawList : [];
  const normalized = [];
  const seen = new Set();

  list.forEach((entry, idx) => {
    const cv = normalizeCvEntry(entry, idx, { fallbackTitlePrefix });
    let id = cv.id;
    while (seen.has(id)) {
      id = randomId();
    }
    cv.id = id;
    seen.add(id);
    normalized.push(cv);
  });

  if (!normalized.length) {
    const seedText = typeof legacyText === 'string' ? legacyText : '';
    const seed = normalizeCvEntry(
      {
        content: seedText,
        title: seedText ? 'Imported CV' : `${fallbackTitlePrefix || 'CV'} 1`,
        isDefault: true,
        updatedAt: seedText ? Date.now() : 0
      },
      0,
      { fallbackTitlePrefix }
    );
    normalized.push(seed);
  }

  return normalized;
}

export function getActiveCv(cvs, activeId) {
  const list = Array.isArray(cvs) ? cvs : [];
  if (!list.length) return { active: null, activeId: null, list };
  const found = list.find(cv => cv && cv.id === activeId) || list[0];
  return { active: found, activeId: found?.id || null, list };
}

export function cloneCv(cv) {
  if (!cv || typeof cv !== 'object') return null;
  return {
    id: cv.id,
    title: cv.title,
    content: cv.content,
    updatedAt: cv.updatedAt,
    isDefault: cv.isDefault
  };
}

export function generateCvId() {
  return randomId();
}
