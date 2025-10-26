const NOTION_API_URL = 'https://api.notion.com/v1/pages';
const NOTION_VERSION = '2025-09-03';
const TEXT_CHUNK = 1800;

const ALLOWED_TYPES = new Set(['title', 'rich_text', 'url', 'number', 'checkbox', 'date', 'multi_select', 'status']);

function chunkText(value) {
  const text = String(value ?? '');
  if (!text) return [];
  const parts = [];
  for (let i = 0; i < text.length; i += TEXT_CHUNK) {
    parts.push(text.slice(i, i + TEXT_CHUNK));
  }
  return parts;
}

function toRichText(value) {
  const text = String(value ?? '');
  if (!text) {
    return [{
      type: 'text',
      text: { content: '' }
    }];
  }
  return chunkText(text).map(part => ({
    type: 'text',
    text: { content: part }
  }));
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return ['true', 'yes', '1', 'ok', 'y', 'on'].includes(normalized);
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asDateISO(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const str = String(value).trim();
  if (!str) return null;
  const date = new Date(str);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return null;
}

function asMultiSelect(value) {
  if (Array.isArray(value)) {
    return value
      .map(v => String(v || '').trim())
      .filter(Boolean)
      .map(name => ({ name }));
  }
  const text = String(value || '').trim();
  if (!text) return [];
  return text.split(',').map(part => part.trim()).filter(Boolean).map(name => ({ name }));
}

function resolveSourceValue(field, context) {
  switch (field.source) {
    case 'analysis':
      return extractFromAnalysis(field.staticValue, context.analysis || '');
    case 'jobDescription':
      return context.jobDescription || '';
    case 'selectedText':
      return context.selectedText || '';
    case 'url':
      return context.url || '';
    case 'provider':
      return context.providerName || '';
    case 'model':
      return context.modelName || '';
    case 'timestamp':
      return context.timestampIso || '';
    case 'cv':
      return context.cv || '';
    case 'pageTitle':
      return context.pageTitle || '';
    case 'custom':
      return field.staticValue || '';
    default:
      return '';
  }
}

function extractFromAnalysis(pattern, analysisText) {
  const prefix = String(pattern || '').trim();
  if (!analysisText) return '';
  if (!prefix) return analysisText;
  const lines = String(analysisText).split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(prefix)) {
      let value = line.slice(prefix.length).trim();
      value = value.replace(/^[\-–—•*]\s*/, '');
      return value;
    }
  }
  return '';
}

function buildProperty(field, value) {
  const type = ALLOWED_TYPES.has(field.propertyType) ? field.propertyType : 'rich_text';
  switch (type) {
    case 'title': {
      const text = value ? String(value) : '';
      const fallback = text.trim() ? text : 'Untitled';
      return { title: toRichText(fallback) };
    }
    case 'rich_text':
      return { rich_text: toRichText(value) };
    case 'url': {
      const url = String(value || '').trim();
      return url ? { url } : null;
    }
    case 'number': {
      const num = asNumber(value);
      return num === null ? null : { number: num };
    }
    case 'checkbox':
      return { checkbox: asBoolean(value) };
    case 'date': {
      const iso = asDateISO(value);
      return iso ? { date: { start: iso } } : null;
    }
    case 'multi_select': {
      const arr = asMultiSelect(value);
      return arr.length ? { multi_select: arr } : null;
    }
    case 'status': {
      const name = String(value || '').trim();
      return name ? { status: { name } } : null;
    }
    default:
      return { rich_text: toRichText(value) };
  }
}

export async function saveToNotion({ settings, payload }) {
  const notion = settings?.integrations?.notion;
  if (!notion?.enabled) return { ok: false, error: 'Notion integration disabled' };

  const token = String(notion.token || '').trim();
  const databaseId = String(notion.databaseId || '').trim();
  if (!token) return { ok: false, error: 'Notion token is not configured' };
  if (!databaseId) return { ok: false, error: 'Notion database ID is not configured' };

  const fields = Array.isArray(notion.fields) ? notion.fields.filter(f => f && f.propertyName) : [];
  if (!fields.length) return { ok: false, error: 'Configure at least one Notion field mapping' };

  for (const field of fields) {
    if ((field.source === 'analysis' || field.source === 'custom') && !String(field.staticValue || '').trim()) {
      return { ok: false, error: `Field "${field.propertyName}" requires Source data value.` };
    }
  }

  const timestampIso = payload?.timestampIso || new Date().toISOString();
  const stateModel = settings?.models?.find(m => m?.id === payload?.modelId) || null;
  const providerId = payload?.providerId || stateModel?.providerId;
  const provider = settings?.providers?.find(p => p?.id === providerId) || null;

  const ctx = {
    analysis: payload?.analysis || '',
    jobDescription: payload?.jobDescription || '',
    selectedText: payload?.selectedText || '',
    url: payload?.tabUrl || '',
    pageTitle: payload?.tabTitle || '',
    providerName: payload?.providerName || payload?.providerLabel || provider?.name || '',
    modelName: payload?.modelLabel || stateModel?.displayName || stateModel?.modelId || payload?.modelId || '',
    timestampIso,
    cv: settings?.cv || ''
  };

  const properties = {};
  let hasTitle = false;

  for (const field of fields) {
    const propertyName = String(field.propertyName || '').trim();
    if (!propertyName) continue;
    const value = resolveSourceValue(field, ctx);
    const property = buildProperty(field, value);
    if (!property) continue;
    if (field.propertyType === 'title') hasTitle = true;
    properties[propertyName] = property;
  }

  if (!Object.keys(properties).length) {
    return { ok: false, error: 'Nothing to send to Notion (all fields empty)' };
  }
  if (!hasTitle) {
    return { ok: false, error: 'At least one field must be mapped to a Notion title property' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION
  };
  const body = {
    parent: { database_id: databaseId },
    properties
  };

  let res;
  try {
    res = await fetch(NOTION_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  } catch (e) {
    const msg = String(e && (e.message || e));
    if (/Failed to fetch/i.test(msg)) {
      return {
        ok: false,
        error: 'Failed to reach Notion API. Allow the extension to access api.notion.com and check your connection.'
      };
    }
    return { ok: false, error: `Notion request failed: ${msg}` };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const hint = res.status === 401 ? ' (check integration token)' :
      (res.status === 404 ? ' (check database ID)' : '');
    return {
      ok: false,
      error: `Notion error ${res.status}${hint}: ${text.slice(0, 400)}`
    };
  }

  let pageId = '';
  try {
    const json = await res.json();
    pageId = json?.id || '';
  } catch {}

  try {
    chrome.storage?.local?.set?.({
      lastNotionSave: {
        when: Date.now(),
        databaseId,
        pageId
      }
    }, () => {});
  } catch {}

  return { ok: true, pageId };
}
