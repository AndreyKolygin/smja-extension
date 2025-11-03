// ui/js/options-sites.js
import { $id, persistSettings, safeShowModal } from './options-util.js';
import { applyTranslations, t } from './i18n.js';

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
function hasDuplicateRule(settings, currentId, candidate) {
  if (!Array.isArray(settings?.sites)) return false;
  const h = String(candidate.host || '').trim();
  const sig = ruleSignature(candidate);
  return settings.sites.some(r => r && r.id !== currentId && String(r.host || '').trim() === h && ruleSignature(r) === sig);
}

function ruleSignature(rule) {
  const strategy = (rule?.strategy || 'css').toLowerCase();
  if (strategy === 'css') {
    return `css::${String(rule?.selector || '').trim()}`;
  }
  if (strategy === 'chain') {
    const chain = Array.isArray(rule?.chain) ? rule.chain : [];
    const parts = chain.map(step => {
      const sel = String(step?.selector || '').trim();
      if (!sel) return '';
      const nth = Number.isFinite(step?.nth) ? step.nth : null;
      const nthPart = nth == null ? '' : `#${nth}`;
      const text = String(step?.text || '').trim();
      return `${sel}${nthPart}${text ? `|${text}` : ''}`;
    }).filter(Boolean);
    return `chain::${parts.join('>')}`;
  }
  if (strategy === 'script') {
    return `script::${String(rule?.script || '').trim()}`;
  }
  return `${strategy}::${String(rule?.selector || '').trim()}`;
}

function summarizeRule(rule) {
  const strategy = (rule?.strategy || 'css').toLowerCase();
  const label = t(`options.modal.site.strategy.${strategy}`, strategy.toUpperCase());

  if (strategy === 'css') {
    const detail = String(rule?.selector || '').trim();
    return detail ? `${label} • ${detail}` : label;
  }

  if (strategy === 'chain') {
    const chain = Array.isArray(rule?.chain) ? rule.chain : [];
    if (!chain.length) {
      return `${label} • ${t('options.modal.site.chainSummaryEmpty', 'No steps')}`;
    }
    const parts = chain.map((step, idx) => {
      const sel = String(step?.selector || '').trim() || '*';
      const nth = Number.isFinite(step?.nth) ? step.nth : '';
      const text = String(step?.text || '').trim();
      let fragment = `${idx + 1}:${sel}`;
      if (nth !== '') fragment += `[#${nth}]`;
      if (text) fragment += ` {${text}}`;
      return fragment;
    });
    const detail = parts.join(' → ');
    return `${label} • ${detail}`;
  }

  if (strategy === 'script') {
    const firstLine = String(rule?.script || '').trim().split('\n').find(Boolean) || '';
    const detail = firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
    return detail ? `${label} • ${detail}` : label;
  }

  const detail = String(rule?.selector || '').trim();
  return detail ? `${label} • ${detail}` : label;
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
    const summary = summarizeRule(rule);
    tr.innerHTML = `
      <td><input type="checkbox" ${rule.active ? "checked" : ""} data-act="toggle" data-id="${rule.id}" aria-label="Toggle rule"></td>
      <td class="word-break">${rule.host || ""}</td>
      <td class="word-break" title="${escapeHtml(summary)}">${escapeHtml(summary)}</td>
      <td class="word-break">${rule.comment || ""}</td>
      <td class="actions nowrap">
        <button class="btn edit icon-left i-pen" data-act="edit" data-id="${rule.id}" data-i18n="options.btn.edit" title="Edit">Edit</button>
        <button class="btn delete icon-left i-trash" data-act="del" data-id="${rule.id}" data-i18n="options.btn.delete" title="Delete">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  }

  try { applyTranslations(tbody); } catch { /* no i18n yet */ }

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
  const selectorRow = document.getElementById("siteSelectorRow");
  const sel  = document.getElementById("siteSelector");
  const strategySel = document.getElementById("siteStrategy");
  const chainRow = document.getElementById("siteChainRow");
  const chainList = document.getElementById("siteChainSteps");
  const addChainBtn = document.getElementById("addChainStepBtn");
  const scriptRow = document.getElementById("siteScriptRow");
  const scriptInput = document.getElementById("siteScript");
  const com  = document.getElementById("siteComment");
  const act  = document.getElementById("siteActive");
  const save = document.getElementById("saveSiteBtn");
  if (!dlg || !host || !sel || !save) return;

  const keyTargets = [];
  const attachKeyHandler = (el) => {
    if (!el) return;
    el.addEventListener('keydown', onKey);
    keyTargets.push(el);
  };

  const detachKeyHandlers = () => {
    for (const el of keyTargets) {
      el.removeEventListener('keydown', onKey);
    }
    keyTargets.length = 0;
  };

  const cleanup = () => {
    detachKeyHandlers();
    if (addChainBtn) addChainBtn.removeEventListener('click', onAddChainStep);
    if (strategySel) strategySel.removeEventListener('change', onStrategyChange);
    if (chainList) chainList.removeEventListener('keydown', onKey);
  };

  let chainState = Array.isArray(rule?.chain)
    ? rule.chain.map(step => ({
        selector: String(step?.selector || ''),
        nth: (step?.nth === 0 || Number.isFinite(step?.nth)) ? String(step.nth) : '',
        text: String(step?.text || '')
      }))
    : [];

  function renderChain() {
    if (!chainList) return;
    chainList.innerHTML = '';
    if (!chainState.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.dataset.i18n = 'options.modal.site.chainEmpty';
      empty.textContent = 'No chain steps yet.';
      chainList.appendChild(empty);
      try { applyTranslations(chainList); } catch {}
      return;
    }
    chainState.forEach((step, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'chain-step';

      const header = document.createElement('div');
      header.className = 'chain-step-header';
      const title = document.createElement('span');
      title.textContent = `${t('options.modal.site.chainStepLabel', 'Step')} ${idx + 1}`;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn danger icon-left i-trash';
      removeBtn.dataset.idx = String(idx);
      removeBtn.setAttribute('data-i18n', 'options.modal.site.chainStepRemove');
      removeBtn.textContent = t('options.modal.site.chainStepRemove', 'Remove step');
      removeBtn.addEventListener('click', () => {
        chainState.splice(idx, 1);
        renderChain();
      });
      header.append(title, removeBtn);

      const fields = document.createElement('div');
      fields.className = 'chain-step-fields';

      const selectorField = document.createElement('div');
      selectorField.className = 'field';
      const selectorLabel = document.createElement('label');
      selectorLabel.setAttribute('data-i18n', 'options.modal.site.chainStepSelector');
      selectorLabel.textContent = 'Selector';
      const selectorInput = document.createElement('input');
      selectorInput.type = 'text';
      selectorInput.value = step.selector || '';
      selectorInput.className = 'chain-selector';
      selectorInput.addEventListener('input', () => {
        chainState[idx].selector = selectorInput.value;
      });
      selectorField.append(selectorLabel, selectorInput);

      const nthField = document.createElement('div');
      nthField.className = 'field';
      const nthLabel = document.createElement('label');
      nthLabel.setAttribute('data-i18n', 'options.modal.site.chainStepIndex');
      nthLabel.textContent = 'Index (optional)';
      const nthInput = document.createElement('input');
      nthInput.type = 'number';
      nthInput.min = '0';
      nthInput.step = '1';
      nthInput.value = step.nth || '';
      nthInput.className = 'chain-index';
      nthInput.addEventListener('input', () => {
        chainState[idx].nth = nthInput.value;
      });
      nthField.append(nthLabel, nthInput);

      const textField = document.createElement('div');
      textField.className = 'field';
      const textLabel = document.createElement('label');
      textLabel.setAttribute('data-i18n', 'options.modal.site.chainStepText');
      textLabel.textContent = 'Contains text (optional)';
      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.value = step.text || '';
      textInput.className = 'chain-text';
      textInput.addEventListener('input', () => {
        chainState[idx].text = textInput.value;
      });
      textField.append(textLabel, textInput);

      fields.append(selectorField, nthField, textField);
      wrapper.append(header, fields);
      chainList.appendChild(wrapper);
    });
    try { applyTranslations(chainList); } catch {}
  }

  function sanitizeChainState({ requireNonEmpty = false } = {}) {
    const out = [];
    for (const step of chainState) {
      const selector = String(step?.selector || '').trim();
      if (!selector) continue;
      const text = String(step?.text || '').trim();
      const nthRaw = String(step?.nth ?? '').trim();
      let nth = null;
      if (nthRaw) {
        const parsed = Number(nthRaw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return { ok: false, error: t('options.modal.site.chainIndexError', 'Index must be a non-negative number') };
        }
        nth = Math.floor(parsed);
      }
      out.push({ selector, text, nth });
    }
    if (requireNonEmpty && !out.length) {
      return { ok: false, error: t('options.modal.site.chainRequired', 'Add at least one chain step with a selector') };
    }
    return { ok: true, chain: out };
  }

  // Prefill
  if (rule) {
    host.value = rule.host || "";
    sel.value  = rule.selector || "";
    if (strategySel) strategySel.value = rule.strategy || "css";
    if (scriptInput) scriptInput.value = rule.script || "";
    com.value  = rule.comment || "";
    act.checked = !!rule.active;
  } else {
    host.value = "";
    sel.value = "";
    if (strategySel) strategySel.value = "css";
    if (scriptInput) scriptInput.value = "";
    com.value = "";
    act.checked = true;
    chainState = [];
  }

  const onKey = (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { save.click(); }
    if (ev.key === 'Escape') { dlg.close?.(); }
  };

  function onStrategyChange() {
    const val = (strategySel?.value || 'css');
    if (selectorRow) selectorRow.hidden = val !== 'css';
    if (chainRow) chainRow.hidden = val !== 'chain';
    if (scriptRow) scriptRow.hidden = val !== 'script';
    if (sel) sel.required = val === 'css';
  }

  function onAddChainStep() {
    chainState.push({ selector: '', nth: '', text: '' });
    renderChain();
  }

  onStrategyChange();
  renderChain();

  attachKeyHandler(host);
  attachKeyHandler(sel);
  attachKeyHandler(com);
  attachKeyHandler(scriptInput);
  if (chainList) chainList.addEventListener('keydown', onKey);
  if (strategySel) strategySel.addEventListener('change', onStrategyChange);
  if (addChainBtn) addChainBtn.addEventListener('click', onAddChainStep);

  // Helpers: submit on Ctrl+Enter and Escape closes
  safeShowModal(dlg);

  try { applyTranslations(dlg); } catch {}

  const prev = save.onclick;
  save.onclick = () => {
    const strategy = strategySel?.value || 'css';
    const data = {
      id: rule?.id || ("site_" + Math.random().toString(36).slice(2,8)),
      host: normalizeHostPattern(host.value),
      strategy,
      selector: sel.value.trim(),
      comment: com.value.trim(),
      active: !!act.checked,
      chain: [],
      script: scriptInput?.value?.trim() || ''
    };
    if (!data.host) {
      alert(t('options.modal.site.hostRequired', 'Site pattern is required.'));
      return;
    }

    if (strategy === 'css') {
      data.selector = data.selector.trim();
      if (!data.selector) {
        alert(t('options.modal.site.selectorRequired', 'CSS selector is required.'));
        return;
      }
      const chainSanitized = sanitizeChainState();
      if (!chainSanitized.ok) {
        alert(chainSanitized.error);
        return;
      }
      data.chain = chainSanitized.chain;
      data.script = '';
    } else if (strategy === 'chain') {
      const chainSanitized = sanitizeChainState({ requireNonEmpty: true });
      if (!chainSanitized.ok) {
        alert(chainSanitized.error);
        return;
      }
      data.chain = chainSanitized.chain;
      data.selector = '';
      data.script = '';
    } else if (strategy === 'script') {
      data.script = (scriptInput?.value || '').trim();
      if (!data.script) {
        alert(t('options.modal.site.scriptRequired', 'Provide a script body that returns text.'));
        return;
      }
      const chainSanitized = sanitizeChainState();
      if (!chainSanitized.ok) {
        alert(chainSanitized.error);
        return;
      }
      data.chain = chainSanitized.chain;
      data.selector = '';
    }

    if (hasDuplicateRule(settings, rule?.id, data)) {
      alert(t('options.modal.site.duplicate', 'A rule with the same site and strategy already exists.'));
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
    cleanup();
    save.onclick = prev || null;
  };

  const cancel = document.getElementById("cancelSiteBtn");
  if (cancel) {
    const prevC = cancel.onclick;
    cancel.onclick = () => {
      dlg.close?.();
      cancel.onclick = prevC || null;
      save.onclick = prev || null;
      cleanup();
    };
  }

  dlg.addEventListener('close', cleanup, { once: true });
}
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
