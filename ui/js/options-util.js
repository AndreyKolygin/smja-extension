// ui/js/options-util.js
import { getDefaultSettings } from '../../shared/defaults.js';
import { ensureCvList, getActiveCv } from '../../shared/cv.js';

export const SETTINGS_KEY = "jdaSettings";

export function $id(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing DOM node: #${id}`);
  return el;
}
let modalScrollLocks = 0;
let scrollLockSnapshot = null;
function lockBodyScroll() {
  modalScrollLocks += 1;
  if (!document?.body) return;
  if (modalScrollLocks === 1) {
    const scrollY = window.scrollY ?? document.documentElement?.scrollTop ?? 0;
    const scrollX = window.scrollX ?? document.documentElement?.scrollLeft ?? 0;
    scrollLockSnapshot = { x: scrollX, y: scrollY };
    document.body.classList.add('jda-modal-scroll-lock');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = `-${scrollX}px`;
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }
}
function unlockBodyScroll() {
  modalScrollLocks = Math.max(0, modalScrollLocks - 1);
  if (modalScrollLocks === 0 && document?.body) {
    document.body.classList.remove('jda-modal-scroll-lock');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    if (scrollLockSnapshot) {
      window.scrollTo(scrollLockSnapshot.x ?? 0, scrollLockSnapshot.y ?? 0);
    }
    scrollLockSnapshot = null;
  }
}
export function safeShowModal(dlg) {
  if (!dlg) return;
  const attachCloseHandler = () => {
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      unlockBodyScroll();
    };
    dlg.addEventListener('close', onClose, { once: true });
  };
  lockBodyScroll();
  attachCloseHandler();
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open","open");
}
export function maskKey(k){ if(!k) return ""; const last = String(k).slice(-6); return `...${last}`; }

export async function ensureHostPermission(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const pattern = `${u.protocol}//${u.host}/*`;
    return await chrome.permissions.request({ origins: [pattern] });
  } catch { return false; }
}

let persistTimer = null;
let pendingPayload = null;

async function flushPersist() {
  if (!pendingPayload) return;
  const payload = pendingPayload;
  pendingPayload = null;
  try {
    await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload });
  } catch(e){
    console.warn('[JDA] persist failed', e);
  }
}

export async function persistSettings(settings, { immediate = false } = {}){
  const clone = { ...settings };
  delete clone.version;
  pendingPayload = clone;
  if (immediate) {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    await flushPersist();
    return;
  }
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushPersist();
  }, 400);
}

function normalizeNotionField(field, idx = 0) {
  const base = {
    id: `nf_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`,
    label: '',
    propertyName: '',
    propertyType: 'rich_text',
    source: 'analysis',
    staticValue: ''
  };
  const raw = field && typeof field === 'object' ? field : {};
  const id = String(raw.id || '') || `${base.id}_${idx}`;
  const propertyType = typeof raw.propertyType === 'string' ? raw.propertyType : 'rich_text';
  const source = typeof raw.source === 'string' ? raw.source : 'analysis';
  return {
    id,
    label: typeof raw.label === 'string' ? raw.label : '',
    propertyName: typeof raw.propertyName === 'string' ? raw.propertyName : '',
    propertyType,
    source,
    staticValue: typeof raw.staticValue === 'string' ? raw.staticValue : ''
  };
}

function normalizeChainStep(step, idx = 0) {
  const raw = step && typeof step === 'object' ? step : {};
  const selector = typeof raw.selector === 'string' ? raw.selector.trim() : '';
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  let nth = null;
  if (Number.isFinite(raw.nth)) {
    nth = Math.max(0, Math.floor(raw.nth));
  } else if (typeof raw.nth === 'string' && raw.nth.trim()) {
    const parsed = Number(raw.nth.trim());
    if (Number.isFinite(parsed)) nth = Math.max(0, Math.floor(parsed));
  }
  return selector ? { selector, text, nth } : { selector: '', text: '', nth: null };
}

function normalizeChainGroup(group, idx = 0, fallbackId = '') {
  const raw = group && typeof group === 'object' ? group : {};
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((step, i) => normalizeChainStep(step, i)).filter(st => st.selector)
    : [];
  if (!steps.length) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `${fallbackId || 'cg'}_${idx}`,
    label: typeof raw.label === 'string' ? raw.label : '',
    active: raw.active === undefined ? true : !!raw.active,
    steps
  };
}

function normalizeSiteRule(rule, idx = 0) {
  const baseId = `site_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
  const raw = rule && typeof rule === 'object' ? rule : {};
  const host = typeof raw.host === 'string' ? raw.host.trim() : '';
  const selector = typeof raw.selector === 'string' ? raw.selector.trim() : '';
  const comment = typeof raw.comment === 'string' ? raw.comment.trim() : '';
  const template = typeof raw.template === 'string' ? raw.template.trim() : '';
  const templateToJob = raw.templateToJob === true;
  const templateToResult = raw.templateToResult === true;
  const active = raw.active === undefined ? true : !!raw.active;
  const strategy = ['css', 'chain', 'template'].includes((raw.strategy || '').toLowerCase())
    ? raw.strategy.toLowerCase()
    : 'css';
  const chain = Array.isArray(raw.chain)
    ? raw.chain.map((step, i) => normalizeChainStep(step, i)).filter(st => st.selector)
    : [];

  const hasChainFlag = Object.prototype.hasOwnProperty.call(raw, 'chainSequential');
  const chainSequential = hasChainFlag ? !!raw.chainSequential : false;
  let chainGroups = [];
  if (Array.isArray(raw.chainGroups) && raw.chainGroups.length) {
    chainGroups = raw.chainGroups
      .map((group, groupIdx) => normalizeChainGroup(group, groupIdx, baseId))
      .filter(Boolean);
  } else if (chain.length) {
    chainGroups = [normalizeChainGroup({ id: `${baseId}_cg0`, steps: chain }, 0, baseId)].filter(Boolean);
  }
  const activeGroups = chainGroups.filter(group => group.active !== false);
  const flattenedChain = activeGroups.length
    ? activeGroups.reduce((acc, group) => acc.concat(group.steps), [])
    : (chainGroups.length ? [] : chain);

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : baseId,
    host,
    strategy,
    selector: strategy === 'css' ? selector : selector || '',
    comment,
    active,
    chain: flattenedChain,
    chainGroups,
    template,
    templateToJob,
    templateToResult,
    chainSequential
  };
}

function normalizeNotionSettings(notion) {
  const base = getDefaultSettings().integrations.notion;
  const raw = notion && typeof notion === 'object' ? notion : {};
  const fieldsSource = Array.isArray(raw.fields) ? raw.fields : base.fields;
  return {
    enabled: !!raw.enabled,
    token: typeof raw.token === 'string' ? raw.token : '',
    databaseId: typeof raw.databaseId === 'string' ? raw.databaseId : '',
    fields: fieldsSource.map((f, idx) => normalizeNotionField(f, idx))
  };
}

export function normalizeSettings(obj){
  const base = getDefaultSettings();
  const s = Object.assign({}, base, obj || {});
  if (!Array.isArray(s.providers)) s.providers = [];
  if (!Array.isArray(s.models)) s.models = [];
  if (!Array.isArray(s.sites)) s.sites = [];
  s.sites = s.sites.map((rule, idx) => normalizeSiteRule(rule, idx));

  if (!s.integrations || typeof s.integrations !== 'object') s.integrations = { notion: normalizeNotionSettings(base.integrations.notion) };
  s.integrations.notion = normalizeNotionSettings(s.integrations.notion);

  const legacyCv = typeof s.cv === 'string' ? s.cv : '';
  const cvs = ensureCvList(s.cvs, { legacyText: legacyCv });
  const { active, activeId } = getActiveCv(cvs, s.activeCvId);
  s.cvs = cvs;
  s.activeCvId = activeId;
  s.cv = active?.content || '';

  return s;
}

export function getNormalizedSettings(raw) {
  return normalizeSettings(raw);
}
