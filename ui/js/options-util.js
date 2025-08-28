// ui/js/options-util.js
export const SETTINGS_KEY = "jdaSettings";

export function $id(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing DOM node: #${id}`);
  return el;
}
export function safeShowModal(dlg) {
  if (dlg && typeof dlg.showModal === "function") dlg.showModal(); else dlg?.setAttribute("open","open");
}
export function maskKey(k){ if(!k) return ""; const last = String(k).slice(-6); return `...${last}`; }

export async function ensureHostPermission(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const pattern = `${u.protocol}//${u.host}/*`;
    return await chrome.permissions.request({ origins: [pattern] });
  } catch { return false; }
}

export async function persistSettings(settings){
  try {
    const clone = { ...settings };
    delete clone.version;
    await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload: clone });
  } catch(e){ console.warn('[JDA] persist failed', e); }
}

export function normalizeSettings(obj){
  const base = {
    general: { helpUrl: "https://github.com/AndreyKolygin/smja-extension" },
    providers: [],
    models: [],
    sites: [],
    cv: "",
    systemTemplate: "",
    outputTemplate: ""
  };
  const s = Object.assign({}, base, obj || {});
  if (!Array.isArray(s.providers)) s.providers = [];
  if (!Array.isArray(s.models)) s.models = [];
  if (!Array.isArray(s.sites)) s.sites = [];
  return s;
}
