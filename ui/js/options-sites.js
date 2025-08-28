// ui/js/options-sites.js
import { $id, persistSettings, safeShowModal } from './options-util.js';

export function renderSites(settings){
  const tbody = document.querySelector("#sitesTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  for (const rule of (settings.sites || [])) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" ${rule.active ? "checked" : ""} data-act="toggle" data-id="${rule.id}"></td>
      <td>${rule.host || ""}</td>
      <td class="word-break">${rule.selector || ""}</td>
      <td>${rule.comment || ""}</td>
      <td class="actions">
        <button class="btn outline" data-act="edit" data-id="${rule.id}">Edit</button>
        <button class="btn danger" data-act="del" data-id="${rule.id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  }

  if (!tbody.__wired) {
    tbody.__wired = true;
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
        if (confirm(`Delete rule for “${rule.host}”?`)) {
          settings.sites.splice(idx, 1);
          renderSites(settings);
          persistSettings(settings);
        }
      }
    });

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

  if (rule) {
    host.value = rule.host || "";
    sel.value  = rule.selector || "";
    com.value  = rule.comment || "";
    act.checked = !!rule.active;
  } else {
    host.value = ""; sel.value = ""; com.value = ""; act.checked = true;
  }

  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open","open");
  const prev = save.onclick;
  save.onclick = () => {
    const data = {
      id: rule?.id || ("site_" + Math.random().toString(36).slice(2,8)),
      host: host.value.trim(),
      selector: sel.value.trim(),
      comment: com.value.trim(),
      active: !!act.checked
    };
    if (!data.host || !data.selector) { alert("Site and selector are required."); return; }
    if (rule) Object.assign(rule, data);
    else {
      if (!Array.isArray(settings.sites)) settings.sites = [];
      settings.sites.push(data);
    }
    renderSites(settings);
    persistSettings(settings);
    dlg.close?.();
    save.onclick = prev || null;
  };

  const cancel = document.getElementById("cancelSiteBtn");
  if (cancel) {
    const prevC = cancel.onclick;
    cancel.onclick = () => { dlg.close?.(); cancel.onclick = prevC || null; save.onclick = prev || null; };
  }
}
