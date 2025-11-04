import { $id, ensureHostPermission } from './options-util.js';
import { applyTranslations } from './i18n.js';

const SOURCE_OPTIONS = [
  { value: 'analysis', labelKey: 'options.integrations.notion.source.analysis' },
  { value: 'jobDescription', labelKey: 'options.integrations.notion.source.job' },
  { value: 'selectedText', labelKey: 'options.integrations.notion.source.selection' },
  { value: 'pageTitle', labelKey: 'options.integrations.notion.source.title' },
  { value: 'url', labelKey: 'options.integrations.notion.source.url' },
  { value: 'provider', labelKey: 'options.integrations.notion.source.provider' },
  { value: 'model', labelKey: 'options.integrations.notion.source.model' },
  { value: 'timestamp', labelKey: 'options.integrations.notion.source.timestamp' },
  { value: 'cv', labelKey: 'options.integrations.notion.source.cv' },
  { value: 'custom', labelKey: 'options.integrations.notion.source.custom' }
];

const TYPE_OPTIONS = [
  { value: 'title', labelKey: 'options.integrations.notion.type.title' },
  { value: 'rich_text', labelKey: 'options.integrations.notion.type.rich_text' },
  { value: 'url', labelKey: 'options.integrations.notion.type.url' },
  { value: 'number', labelKey: 'options.integrations.notion.type.number' },
  { value: 'checkbox', labelKey: 'options.integrations.notion.type.checkbox' },
  { value: 'date', labelKey: 'options.integrations.notion.type.date' },
  { value: 'multi_select', labelKey: 'options.integrations.notion.type.multi_select' },
  { value: 'status', labelKey: 'options.integrations.notion.type.status' }
];

const NOTION_PERMISSION_URL = 'https://api.notion.com/v1/pages';

let settingsRef = null;

function ensureSettings(settings) {
  if (!settings.integrations) settings.integrations = {};
  if (!settings.integrations.notion) {
    settings.integrations.notion = {
      enabled: false,
      token: '',
      databaseId: '',
      fields: []
    };
  }
  if (!Array.isArray(settings.integrations.notion.fields)) {
    settings.integrations.notion.fields = [];
  }
  return settings.integrations.notion;
}

function translate(key) {
  try {
    return chrome.i18n?.getMessage?.(key) || key;
  } catch {
    return key;
  }
}

function makeField(field) {
  return {
    id: field?.id || `nf_${Math.random().toString(36).slice(2)}`,
    label: field?.label || '',
    propertyName: field?.propertyName || '',
    propertyType: field?.propertyType || 'rich_text',
    source: field?.source || 'analysis',
    staticValue: field?.staticValue || ''
  };
}

function needsValueInput(source) {
  return source === 'analysis' || source === 'custom';
}

function renderField(field) {
  const list = $id('notionFields');
  const f = makeField(field);
  const wrapper = document.createElement('div');
  wrapper.className = 'notion-field';
  wrapper.dataset.id = f.id;

  wrapper.innerHTML = `
    <div class="notion-row notion-row-top">
      <div class="form-row notion-cell notion-cell-flex">
        <label data-i18n="options.integrations.notion.field.property">Notion property</label>
        <input type="text" class="notion-property" placeholder="Property name" value="${f.propertyName.replace(/"/g, '&quot;')}" />
      </div>
      <div class="form-row notion-cell notion-cell-type">
        <label data-i18n="options.integrations.notion.field.type">Property type</label>
        <select class="notion-type"></select>
      </div>
    </div>
    <div class="notion-row">
      <div class="form-row notion-cell notion-cell-flex">
        <label data-i18n="options.integrations.notion.field.source">Source data</label>
        <select class="notion-source"></select>
      </div>
      <div class="form-row notion-cell notion-static-row">
        <label data-i18n="options.integrations.notion.field.static">Source data value</label>
        <input type="text" class="notion-static" value="${f.staticValue.replace(/"/g, '&quot;')}" />
      </div>
    </div>
    <div class="notion-row notion-row-bottom">
      <div class="form-row notion-cell notion-cell-flex">
        <label data-i18n="options.integrations.notion.field.label">Label (optional)</label>
        <input type="text" class="notion-label" value="${f.label.replace(/"/g, '&quot;')}" placeholder="Optional label" />
      </div>
      <div class="form-row notion-cell notion-remove-cell">
        <button type="button"
          class="btn danger icon-only i-trash notion-remove"
          data-i18n-attr-title="options.integrations.notion.field.remove"
          data-i18n-attr-aria-label="options.integrations.notion.field.remove"
          title="Remove"></button>
      </div>
    </div>
  `;

  const typeSel = wrapper.querySelector('.notion-type');
  TYPE_OPTIONS.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = translate(opt.labelKey);
    option.setAttribute('data-i18n', opt.labelKey);
    if (opt.value === f.propertyType) option.selected = true;
    typeSel.appendChild(option);
  });

  const sourceSel = wrapper.querySelector('.notion-source');
  SOURCE_OPTIONS.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = translate(opt.labelKey);
    option.setAttribute('data-i18n', opt.labelKey);
    if (opt.value === f.source) option.selected = true;
    sourceSel.appendChild(option);
  });

  const propertyInput = wrapper.querySelector('.notion-property');
  const staticRow = wrapper.querySelector('.notion-static-row');
  const staticInput = wrapper.querySelector('.notion-static');

  function refreshStaticRow(sourceValue) {
    const needs = needsValueInput(sourceValue);
    staticRow.classList.toggle('hidden', !needs);
    staticInput.disabled = !needs;
    staticInput.required = needs;
    if (needs) {
      const placeholderKey = sourceValue === 'analysis'
        ? 'options.integrations.notion.placeholder.analysis'
        : 'options.integrations.notion.placeholder.custom';
      staticInput.setAttribute('data-i18n-attr-placeholder', placeholderKey);
      staticInput.placeholder = translate(placeholderKey);
    } else {
      staticInput.removeAttribute('data-i18n-attr-placeholder');
      staticInput.placeholder = '';
    }
  }

  refreshStaticRow(f.source);

  propertyInput.addEventListener('input', (e) => {
    updateField(f.id, { propertyName: e.target.value });
  });
  wrapper.querySelector('.notion-label').addEventListener('input', (e) => {
    updateField(f.id, { label: e.target.value });
  });
  wrapper.querySelector('.notion-static').addEventListener('input', (e) => {
    updateField(f.id, { staticValue: e.target.value });
  });
  typeSel.addEventListener('change', (e) => {
    updateField(f.id, { propertyType: e.target.value });
  });
  sourceSel.addEventListener('change', (e) => {
    const value = e.target.value;
    updateField(f.id, { source: value });
    refreshStaticRow(value);
  });
  wrapper.querySelector('.notion-remove').addEventListener('click', () => {
    removeField(f.id);
  });

  list.appendChild(wrapper);
  applyTranslations(wrapper);
  syncField(f);
}

function syncField(field) {
  const notion = settingsRef.integrations.notion;
  const idx = notion.fields.findIndex(f => f.id === field.id);
  if (idx === -1) {
    notion.fields.push(field);
  } else {
    notion.fields[idx] = { ...notion.fields[idx], ...field };
  }
}

function updateField(id, patch) {
  const notion = settingsRef.integrations.notion;
  const idx = notion.fields.findIndex(f => f.id === id);
  if (idx === -1) return;
  notion.fields[idx] = { ...notion.fields[idx], ...patch };
}

function removeField(id) {
  const notion = settingsRef.integrations.notion;
  notion.fields = notion.fields.filter(f => f.id !== id);
  const node = document.querySelector(`.notion-field[data-id="${id}"]`);
  if (node?.parentNode) node.parentNode.removeChild(node);
}

function clearFieldList() {
  const list = $id('notionFields');
  list.innerHTML = '';
}

async function handleToggle(checkbox, { skipPermission = false } = {}) {
  const enabled = checkbox.checked;
  const notion = settingsRef.integrations.notion;
  const box = $id('notionSettings');

  if (enabled && !skipPermission) {
    let granted = false;
    try {
      granted = await ensureHostPermission(NOTION_PERMISSION_URL);
    } catch {
      granted = false;
    }
    if (!granted) {
      checkbox.checked = false;
      notion.enabled = false;
      box.classList.add('hidden');
      alert(translate('options.integrations.notion.permissionError'));
      return;
    }
  }

  notion.enabled = enabled;
  box.classList.toggle('hidden', !enabled);
}

export function renderIntegrations(settings) {
  settingsRef = settings;
  const notion = ensureSettings(settings);
  const enabledCheckbox = $id('notionEnabled');
  enabledCheckbox.checked = !!notion.enabled;
  if (!enabledCheckbox.dataset.wired) {
    enabledCheckbox.addEventListener('change', () => {
      handleToggle(enabledCheckbox);
    });
    enabledCheckbox.dataset.wired = '1';
  }

  const tokenInput = $id('notionToken');
  tokenInput.value = notion.token || '';
  if (!tokenInput.dataset.wired) {
    tokenInput.addEventListener('input', (e) => {
      notion.token = e.target.value;
    });
    tokenInput.dataset.wired = '1';
  }

  const dbInput = $id('notionDatabaseId');
  dbInput.value = notion.databaseId || '';
  if (!dbInput.dataset.wired) {
    dbInput.addEventListener('input', (e) => {
      notion.databaseId = e.target.value;
    });
    dbInput.dataset.wired = '1';
  }

  const addBtn = $id('addNotionFieldBtn');
  if (!addBtn.dataset.wired) {
    addBtn.addEventListener('click', () => {
      const field = makeField({
        propertyType: 'rich_text',
        source: 'analysis'
      });
      renderField(field);
    });
    addBtn.dataset.wired = '1';
  }

  clearFieldList();
  (notion.fields.length ? notion.fields : []).forEach(f => renderField(f));
  handleToggle(enabledCheckbox, { skipPermission: true });
}
