// ui/js/options-cv.js — CV manager UI
import { persistSettings } from './options-util.js';
import { generateCvId } from '../../shared/cv.js';
import { t } from './i18n.js';

let settingsRef = null;
let currentId = null;
let persistTimer = null;
let eventsBound = false;
let draggingCvId = null;

const els = {
  list: null,
  addBtn: null,
  titleInput: null,
  contentInput: null,
  deleteBtn: null,
  duplicateBtn: null,
  setDefaultBtn: null,
  charCounter: null,
  defaultBadge: null
};

const CHAR_COUNTER_TEMPLATE = 'options.cv.charCounter';

function queryElements() {
  els.list = document.getElementById('cvList');
  els.addBtn = document.getElementById('cvAddBtn');
  els.titleInput = document.getElementById('cvTitleInput');
  els.contentInput = document.getElementById('cvContentInput');
  els.deleteBtn = document.getElementById('cvDeleteBtn');
  els.duplicateBtn = document.getElementById('cvDuplicateBtn');
  els.setDefaultBtn = document.getElementById('cvSetDefaultBtn');
  els.charCounter = document.getElementById('cvCharCounter');
  els.defaultBadge = document.getElementById('cvDefaultBadge');
}

function getList() {
  if (!Array.isArray(settingsRef?.cvs)) settingsRef.cvs = [];
  return settingsRef.cvs;
}

function getCurrentCv() {
  const list = getList();
  return list.find(cv => cv.id === currentId) || list[0] || null;
}

function queuePersist(immediate = false) {
  if (!settingsRef) return;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (immediate) {
    persistSettings(settingsRef);
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistSettings(settingsRef);
  }, 500);
}

function syncUiDefault(cvId) {
  if (!chrome?.storage?.local) return;
  try {
    chrome.storage.local.get(['ui'], (res) => {
      const ui = Object.assign({}, res?.ui || {}, { chosenCvId: cvId || null });
      chrome.storage.local.set({ ui }, () => {});
    });
  } catch {}
}

function formatChars(text) {
  const len = (text || '').length;
  return t(CHAR_COUNTER_TEMPLATE, '{{count}} chars').replace('{{count}}', len.toLocaleString());
}

function updateCharCounter(text) {
  if (els.charCounter) {
    els.charCounter.textContent = formatChars(text);
  }
}

function updateDefaultBadge() {
  if (!els.defaultBadge) return;
  const isDefault = currentId && currentId === settingsRef?.activeCvId;
  els.defaultBadge.hidden = !isDefault;
}

function updateButtonsState() {
  const count = getList().length;
  if (els.deleteBtn) {
    els.deleteBtn.disabled = count <= 1;
  }
  const hasSelection = !!getCurrentCv();
  if (els.duplicateBtn) els.duplicateBtn.disabled = !hasSelection;
  if (els.setDefaultBtn) els.setDefaultBtn.disabled = !hasSelection || currentId === settingsRef?.activeCvId;
}

function renderCvList() {
  if (!els.list) return;
  const list = getList();
  els.list.innerHTML = '';
  list.forEach((cv, idx) => {
    const item = document.createElement('div');
    item.className = 'cv-list-item';
    const isActive = cv.id === currentId;
    if (isActive) item.classList.add('active');
    item.dataset.id = cv.id;
    item.draggable = true;
    item.setAttribute('role', 'option');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-selected', String(isActive));

    const info = document.createElement('div');
    info.className = 'cv-main';

    const name = document.createElement('span');
    name.className = 'cv-name';
    name.textContent = cv.title || t('options.cv.defaultName', 'CV {{index}}').replace('{{index}}', idx + 1);

    const meta = document.createElement('span');
    meta.className = 'cv-meta';
    meta.textContent = formatChars(cv.content);

    info.appendChild(name);
    info.appendChild(meta);

    if (settingsRef?.activeCvId === cv.id) {
      const flag = document.createElement('span');
      flag.className = 'cv-meta default-flag';
      flag.textContent = t('options.cv.defaultTag', 'Default');
      info.appendChild(flag);
    }

    item.appendChild(info);

    item.addEventListener('click', () => selectCv(cv.id));
    item.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        selectCv(cv.id);
      }
    });
    item.addEventListener('dragstart', (ev) => handleDragStart(ev, cv.id, item));
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', (ev) => handleDragOver(ev, cv.id, item));
    item.addEventListener('dragleave', handleDragLeave);
    item.addEventListener('drop', (ev) => handleDrop(ev, cv.id));

    els.list.appendChild(item);
  });
}

function handleDragStart(ev, id, node) {
  draggingCvId = id;
  node.classList.add('dragging');
  try {
    ev.dataTransfer?.setData('text/plain', id);
    ev.dataTransfer.effectAllowed = 'move';
  } catch {}
}

function handleDragOver(ev, targetId, node) {
  ev.preventDefault();
  if (!draggingCvId || draggingCvId === targetId) return;
  const rect = node.getBoundingClientRect();
  const before = (ev.clientY - rect.top) < rect.height / 2;
  node.classList.toggle('drop-before', before);
  node.classList.toggle('drop-after', !before);
}

function handleDragLeave(ev) {
  ev.currentTarget?.classList.remove('drop-before', 'drop-after');
}

function handleDrop(ev, targetId) {
  ev.preventDefault();
  const node = ev.currentTarget;
  node.classList.remove('drop-before', 'drop-after');
  if (!draggingCvId || draggingCvId === targetId) return;
  const rect = node.getBoundingClientRect();
  const before = (ev.clientY - rect.top) < rect.height / 2;
  reorderCvs(draggingCvId, targetId, before);
}

function handleDragEnd(ev) {
  ev.currentTarget?.classList.remove('dragging', 'drop-before', 'drop-after');
  draggingCvId = null;
}

function reorderCvs(sourceId, targetId, placeBefore) {
  const list = getList();
  const fromIdx = list.findIndex(cv => cv.id === sourceId);
  const toIdx = list.findIndex(cv => cv.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [entry] = list.splice(fromIdx, 1);
  let insertIdx = placeBefore ? toIdx : toIdx + 1;
  if (fromIdx < insertIdx) insertIdx -= 1;
  list.splice(insertIdx, 0, entry);
  settingsRef.cvs = list;
  draggingCvId = null;
  queuePersist(true);
  renderCvList();
}

function ensureAtLeastOneCv() {
  const list = getList();
  if (list.length) return;
  const cv = {
    id: generateCvId(),
    title: t('options.cv.defaultName', 'CV {{index}}').replace('{{index}}', 1),
    content: '',
    updatedAt: 0,
    isDefault: true
  };
  list.push(cv);
  currentId = cv.id;
  settingsRef.activeCvId = cv.id;
}

function selectCv(id, { silent = false } = {}) {
  ensureAtLeastOneCv();
  const next = getList().find(cv => cv.id === id) || getList()[0];
  if (!next) return;
  currentId = next.id;
  if (els.titleInput) els.titleInput.value = next.title || '';
  if (els.contentInput) els.contentInput.value = next.content || '';
  updateCharCounter(next.content || '');
  updateDefaultBadge();
  updateButtonsState();
  renderCvList();
  if (!silent) queuePersist();
}

function handleTitleInput() {
  const cv = getCurrentCv();
  if (!cv || !els.titleInput) return;
  cv.title = els.titleInput.value.trim();
  cv.updatedAt = Date.now();
  renderCvList();
  queuePersist();
}

function handleContentInput() {
  const cv = getCurrentCv();
  if (!cv || !els.contentInput) return;
  cv.content = els.contentInput.value;
  cv.updatedAt = Date.now();
  updateCharCounter(cv.content);
  queuePersist();
}

function handleAddCv() {
  const list = getList();
  const title = t('options.cv.defaultName', 'CV {{index}}').replace('{{index}}', list.length + 1);
  const next = {
    id: generateCvId(),
    title,
    content: '',
    updatedAt: Date.now(),
    isDefault: false
  };
  list.push(next);
  selectCv(next.id, { silent: true });
  updateButtonsState();
  renderCvList();
  queuePersist();
}

function handleDuplicateCv() {
  const current = getCurrentCv();
  if (!current) return;
  const title = current.title
    ? `${current.title} ${t('options.cv.copySuffix', '(copy)')}`
    : t('options.cv.defaultName', 'CV {{index}}').replace('{{index}}', getList().length + 1);
  const copy = {
    id: generateCvId(),
    title,
    content: current.content || '',
    updatedAt: Date.now(),
    isDefault: false
  };
  getList().push(copy);
  selectCv(copy.id, { silent: true });
  renderCvList();
  queuePersist();
}

function handleDeleteCv() {
  const list = getList();
  if (list.length <= 1) {
    alert(t('options.cv.cannotDelete', 'Keep at least one resume.'));
    return;
  }
  const current = getCurrentCv();
  if (!current) return;
  const confirmed = window.confirm(
    t('options.cv.deleteConfirm', 'Delete this resume? This action cannot be undone.')
  );
  if (!confirmed) return;
  settingsRef.cvs = list.filter(cv => cv.id !== current.id);
  if (settingsRef.activeCvId === current.id) {
    settingsRef.activeCvId = settingsRef.cvs[0]?.id || null;
    syncUiDefault(settingsRef.activeCvId);
  }
  currentId = settingsRef.cvs[0]?.id || null;
  selectCv(currentId, { silent: true });
  renderCvList();
  updateButtonsState();
  queuePersist();
}

function handleSetDefault() {
  if (!currentId) return;
  settingsRef.activeCvId = currentId;
  updateDefaultBadge();
  updateButtonsState();
  renderCvList();
  syncUiDefault(currentId);
  queuePersist();
}

function bindEvents() {
  if (eventsBound) return;
  els.addBtn?.addEventListener('click', handleAddCv);
  els.titleInput?.addEventListener('input', handleTitleInput);
  els.contentInput?.addEventListener('input', handleContentInput);
  els.duplicateBtn?.addEventListener('click', handleDuplicateCv);
  els.deleteBtn?.addEventListener('click', handleDeleteCv);
  els.setDefaultBtn?.addEventListener('click', handleSetDefault);
  els.list?.addEventListener('dragover', (ev) => { ev.preventDefault(); });
  eventsBound = true;
}

export function initCvManager(settings) {
  settingsRef = settings;
  queryElements();
  ensureAtLeastOneCv();
  bindEvents();
  const initialId =
    (settingsRef.activeCvId && getList().some(cv => cv.id === settingsRef.activeCvId))
      ? settingsRef.activeCvId
      : getList()[0]?.id;
  currentId = initialId || getList()[0]?.id || null;
  selectCv(currentId, { silent: true });
  updateDefaultBadge();
  updateButtonsState();
}

export function getActiveCvForOptions() {
  return getCurrentCv();
}
