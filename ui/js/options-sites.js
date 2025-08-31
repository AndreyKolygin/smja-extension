// ui/js/options-sites.js
import { $id, persistSettings, safeShowModal } from './options-util.js';

/** Normalize host/pattern input:
 * - trim
 * - if it's a plain hostname or hostname + path, lower-case hostname part
 * - leave explicit regex (/.../flags) and full-URL patterns (http[s]://...) as-is
 */
function normalizeHostPattern(input) {
  let p = String(input || '').trim();
  if (!p) return '';
  // Explicit regex literal or full-URL pattern: keep as-is
  if (p.startsWith('/') && p.lastIndexOf('/') > 0) return p;
  if (p.includes('://')) return p;
  // Otherwise, split host[/path*]
  if (p.startsWith('/')) {
    // path-only rule: keep case (paths are matched case-insensitively later)
    return p;
  }
  const slash = p.indexOf('/');
  if (slash === -1) {
    // host only
    return p.toLowerCase();
  }
  const host = p.slice(0, slash).toLowerCase();
  const path = p.slice(slash);
  return host + path;
}

/** Prevent duplicate host+selector pairs */
function hasDuplicateRule(settings, currentId, host, selector) {
  if (!Array.isArray(settings?.sites)) return false;
  const h = host.trim();
  const s = selector.trim();
  return settings.sites.some(r => r && r.id !== currentId && r.host === h && r.selector === s);
}

export function renderSites(settings){
  const tbody = document.querySelector("#sitesTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  // Render sorted by host, then selector for predictability
  const items = Array.isArray(settings.sites) ? [...settings.sites] : [];
  items.sort((a, b) => {
    const ha = (a?.host || '').toLowerCase();
    const hb = (b?.host || '').toLowerCase();
    if (ha !== hb) return ha < hb ? -1 : 1;
    const sa = a?.selector || '';
    const sb = b?.selector || '';
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

  for (const rule of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" ${rule.active ? "checked" : ""} data-act="toggle" data-id="${rule.id}" aria-label="Toggle rule"></td>
      <td class="word-break">${rule.host || ""}</td>
      <td class="word-break monospace">${rule.selector || ""}</td>
      <td class="word-break">${rule.comment || ""}</td>
      <td class="actions nowrap">
        <button class="btn outline" data-act="edit" data-id="${rule.id}" data-i18n="options.btn.edit" title="Edit">Edit</button>
        <button class="btn danger" data-act="del" data-id="${rule.id}" data-i18n="options.btn.delete" title="Delete">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  }

  if (!tbody.__wired) {
    tbody.__wired = true;

    // Delegated clicks for Edit/Delete
    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const idx = (settings.sites || []).findIndex(x => x && x.id === id);
      if (idx < 0) return;
      const rule = settings.sites[idx];

      if (act === "edit") {
        openSiteModal(settings, rule);
      } else if (act === "del") {
        const label = rule.host || rule.selector || rule.id;
        if (confirm(`Delete rule “${label}”?`)) {
          settings.sites.splice(idx, 1);
          renderSites(settings);
          persistSettings(settings);
        }
      }
    });

    // Toggle active
    tbody.addEventListener("change", (e) => {
      const cb = e.target.closest('input[type="checkbox"][data-act="toggle"]');
      if (!cb) return;
      const id = cb.dataset.id;
      const rule = (settings.sites || []).find(x => x && x.id === id);
      if (!rule) return;
      rule.active = !!cb.checked;
      persistSettings(settings);
    });
  }
}

export function wireSitesModals(settings){
  const addBtn = document.getElementById("addSiteBtn");
  addBtn?.addEventListener("click", () => openSiteModal(settings, null));
}

function openSiteModal(settings, rule){
  const dlg = document.getElementById("siteModal");
  const host = document.getElementById("siteHost");
  const sel  = document.getElementById("siteSelector");
  const com  = document.getElementById("siteComment");
  const act  = document.getElementById("siteActive");
  const save = document.getElementById("saveSiteBtn");
  if (!dlg || !host || !sel || !save) return;

  // Prefill
  if (rule) {
    host.value = rule.host || "";
    sel.value  = rule.selector || "";
    com.value  = rule.comment || "";
    act.checked = !!rule.active;
  } else {
    host.value = ""; sel.value = ""; com.value = ""; act.checked = true;
  }

  // Helpers: submit on Ctrl+Enter and Escape closes
  const onKey = (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { save.click(); }
    if (ev.key === 'Escape') { dlg.close?.(); }
  };
  host.addEventListener('keydown', onKey);
  sel.addEventListener('keydown', onKey);
  com.addEventListener('keydown', onKey);

  safeShowModal(dlg);

  const prev = save.onclick;
  save.onclick = () => {
    const data = {
      id: rule?.id || ("site_" + Math.random().toString(36).slice(2,8)),
      host: normalizeHostPattern(host.value),
      selector: sel.value.trim(),
      comment: com.value.trim(),
      active: !!act.checked
    };
    if (!data.host || !data.selector) { alert("Site and selector are required."); return; }

    if (hasDuplicateRule(settings, rule?.id, data.host, data.selector)) {
      alert("A rule with the same Site and Selector already exists.");
      return;
    }

    if (rule) {
      Object.assign(rule, data);
    } else {
      if (!Array.isArray(settings.sites)) settings.sites = [];
      settings.sites.push(data);
    }
    renderSites(settings);
    persistSettings(settings);
    dlg.close?.();
    save.onclick = prev || null;

    // cleanup listeners
    host.removeEventListener('keydown', onKey);
    sel.removeEventListener('keydown', onKey);
    com.removeEventListener('keydown', onKey);
  };

  const cancel = document.getElementById("cancelSiteBtn");
  if (cancel) {
    const prevC = cancel.onclick;
    cancel.onclick = () => {
      dlg.close?.();
      cancel.onclick = prevC || null;
      save.onclick = prev || null;
      // cleanup listeners
      host.removeEventListener('keydown', onKey);
      sel.removeEventListener('keydown', onKey);
      com.removeEventListener('keydown', onKey);
    };
  }
}
