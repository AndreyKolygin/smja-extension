// ui/js/options-sites.js
import { $id, persistSettings, safeShowModal } from './options-util.js';
import { applyTranslations, t } from './i18n.js';

const modalElementCache = new Map();
function getModalEl(id) {
  if (!modalElementCache.has(id)) {
    modalElementCache.set(id, document.getElementById(id));
  }
  return modalElementCache.get(id);
}

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
    const groups = Array.isArray(rule?.chainGroups) && rule.chainGroups.length
      ? rule.chainGroups
      : [{ steps: Array.isArray(rule?.chain) ? rule.chain : [] }];
    const parts = [];
    groups.forEach((group, gIdx) => {
      const steps = Array.isArray(group?.steps) ? group.steps : [];
      steps.forEach((step, sIdx) => {
        const sel = String(step?.selector || '').trim();
        if (!sel) return;
        const nth = Number.isFinite(step?.nth) ? step.nth : null;
        const nthPart = nth == null ? '' : `#${nth}`;
        const text = String(step?.text || '').trim();
        parts.push(`G${gIdx + 1}.${sIdx + 1}:${sel}${nthPart}${text ? `|${text}` : ''}`);
      });
    });
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
    const groups = Array.isArray(rule?.chainGroups) && rule.chainGroups.length
      ? rule.chainGroups
      : [{ steps: Array.isArray(rule?.chain) ? rule.chain : [] }];
    const stepsTotal = groups.reduce((sum, group) => sum + ((group?.steps || []).length), 0);
    if (!stepsTotal) {
      return `${label} • ${t('options.modal.site.chainSummaryEmpty', 'No steps')}`;
    }
    const parts = [];
    groups.forEach((group, gIdx) => {
      const steps = Array.isArray(group?.steps) ? group.steps : [];
      steps.forEach((step, sIdx) => {
        const sel = String(step?.selector || '').trim() || '*';
        const nth = Number.isFinite(step?.nth) ? step.nth : '';
        const text = String(step?.text || '').trim();
        let fragment = `G${gIdx + 1}.${sIdx + 1}:${sel}`;
        if (nth !== '') fragment += `[#${nth}]`;
        if (text) fragment += ` {${text}}`;
        parts.push(fragment);
      });
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
  const table = document.getElementById("sitesTable");
  if (table) table.__ctx = { settings };

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
    const activeLabel = t('options.tbl.active', 'Active');
    tr.innerHTML = `
      <td class="table-toggle">
        <label class="toggle toggle--compact toggle--icon-only">
          <span class="sr-only" data-i18n="options.tbl.active">${activeLabel}</span>
          <span class="toggle__control">
            <input type="checkbox"
                   class="toggle__input"
                   ${rule.active ? "checked" : ""}
                   data-act="toggle"
                   data-id="${rule.id}"
                   data-i18n-attr-aria-label="options.tbl.active"
                   aria-label="${activeLabel}">
            <span class="toggle__track" aria-hidden="true">
              <span class="toggle__thumb"></span>
            </span>
          </span>
        </label>
      </td>
      <td class="word-break">${rule.host || ""}</td>
      <td class="word-break" title="${escapeHtml(summary)}">${escapeHtml(summary)}</td>
      <td class="word-break">${rule.comment || ""}</td>
      <td class="nowrap">
        <button class="btn edit icon-left i-pen" data-act="edit" data-id="${rule.id}" data-i18n="options.btn.edit" data-i18n-attr-title="options.btn.editTitle" title="Edit">Edit</button>
        <button class="btn delete icon-left i-trash" data-act="del" data-id="${rule.id}" data-i18n="options.btn.delete" data-i18n-attr-title="options.btn.deleteTitle" title="Delete">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  }

  try { applyTranslations(tbody); } catch { /* no i18n yet */ }

  if (tbody && !tbody.__wired) {
    tbody.__wired = true;

    // Delegated clicks for Edit/Delete
    tbody.addEventListener("click", (e) => {
      const currentSettings = table?.__ctx?.settings || settings;
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const idx = (currentSettings.sites || []).findIndex(x => x && x.id === id);
      if (idx < 0) return;
      const rule = currentSettings.sites[idx];

      if (act === "edit") {
        openSiteModal(currentSettings, rule);
      } else if (act === "del") {
        const label = rule.host || rule.selector || rule.id;
        if (confirm(`Delete rule “${label}”?`)) {
          currentSettings.sites.splice(idx, 1);
          renderSites(currentSettings);
          persistSettings(settings);
        }
      }
    });

    // Toggle active
    tbody.addEventListener("change", (e) => {
      const currentSettings = table?.__ctx?.settings || settings;
      const cb = e.target.closest('input[type="checkbox"][data-act="toggle"]');
      if (!cb) return;
      const id = cb.dataset.id;
      const rule = (currentSettings.sites || []).find(x => x && x.id === id);
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
  const dlg = getModalEl("siteModal");
  const host = getModalEl("siteHost");
  const selectorRow = getModalEl("siteSelectorRow");
  const sel  = getModalEl("siteSelector");
  const strategySel = getModalEl("siteStrategy");
  const strategyTabs = Array.from(dlg.querySelectorAll('.site-tab'));
  const strategyPanels = Array.from(dlg.querySelectorAll('.site-strategy-panel'));
  const chainRow = getModalEl("siteChainRow");
  const chainGroupsContainer = getModalEl("siteChainGroups");
  const addChainGroupBtn = getModalEl("addChainGroupBtn");
  const scriptRow = getModalEl("siteScriptRow");
  const scriptInput = getModalEl("siteScript");
  const com  = getModalEl("siteComment");
  const act  = getModalEl("siteActive");
  const save = getModalEl("saveSiteBtn");
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
    if (strategySel) strategySel.removeEventListener('change', onStrategyChange);
    strategyTabs.forEach(btn => btn.removeEventListener('click', onStrategyTabClick));
    if (chainGroupsContainer) chainGroupsContainer.removeEventListener('keydown', onKey);
  };

  const createChainStep = (step = {}) => ({
    selector: typeof step?.selector === 'string' ? step.selector : '',
    nth: step?.nth === 0 || step?.nth ? String(step.nth) : (typeof step?.nth === 'string' ? step.nth : ''),
    text: typeof step?.text === 'string' ? step.text : ''
  });

  const createChainGroup = (group = {}, idx = 0) => {
    const steps = Array.isArray(group?.steps) && group.steps.length
      ? group.steps.map(createChainStep)
      : [createChainStep()];
    return {
      id: group?.id || `cg_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      label: typeof group?.label === 'string' ? group.label : '',
      active: group?.active === undefined ? true : !!group.active,
      steps
    };
  };

  let chainGroupsState = [];
  if (Array.isArray(rule?.chainGroups) && rule.chainGroups.length) {
    chainGroupsState = rule.chainGroups.map((group, idx) => createChainGroup(group, idx));
  } else if (Array.isArray(rule?.chain) && rule.chain.length) {
    chainGroupsState = [createChainGroup({ steps: rule.chain })];
  } else {
    chainGroupsState = [createChainGroup()];
  }

  function renderChainGroups() {
    if (!chainGroupsContainer) return;
    if (!chainGroupsState.length) chainGroupsState.push(createChainGroup());
    chainGroupsContainer.innerHTML = '';
    chainGroupsState.forEach((group, groupIdx) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'chain-group';
      groupEl.dataset.groupIndex = String(groupIdx);

      const header = document.createElement('div');
      header.className = 'chain-group-header';

      const left = document.createElement('div');
      left.className = 'left';

      const groupTitle = document.createElement('span');
      groupTitle.setAttribute('data-i18n', 'options.modal.site.chainGroupLabel');
      groupTitle.textContent = `${t('options.modal.site.chainGroupLabel', 'Group')} ${groupIdx + 1}`;

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = t('options.modal.site.chainGroupNamePh', 'Group name (optional)');
      nameInput.value = group.label || '';
      nameInput.addEventListener('input', (e) => {
        chainGroupsState[groupIdx].label = e.target.value;
      });

      const activeLabel = document.createElement('label');
      activeLabel.className = 'toggle toggle--compact chain-group-toggle';
      const activeText = document.createElement('span');
      activeText.className = 'toggle__text';
      activeText.setAttribute('data-i18n', 'options.modal.site.chainGroupActive');
      const activeLabelText = t('options.modal.site.chainGroupActive', 'Active');
      activeText.textContent = activeLabelText;
      const activeControl = document.createElement('span');
      activeControl.className = 'toggle__control';
      const activeInput = document.createElement('input');
      activeInput.type = 'checkbox';
      activeInput.className = 'toggle__input';
      activeInput.checked = group.active !== false;
      activeInput.setAttribute('data-i18n-attr-aria-label', 'options.modal.site.chainGroupActive');
      activeInput.setAttribute('aria-label', activeLabelText);
      activeInput.addEventListener('change', (e) => {
        chainGroupsState[groupIdx].active = !!e.target.checked;
      });
      const activeTrack = document.createElement('span');
      activeTrack.className = 'toggle__track';
      activeTrack.setAttribute('aria-hidden', 'true');
      const activeThumb = document.createElement('span');
      activeThumb.className = 'toggle__thumb';
      activeTrack.appendChild(activeThumb);
      activeControl.append(activeInput, activeTrack);
      activeLabel.append(activeText, activeControl);

      left.append(groupTitle, nameInput, activeLabel);

      const removeGroupBtn = document.createElement('button');
      removeGroupBtn.type = 'button';
      removeGroupBtn.className = 'btn delete icon-left i-trash';
      removeGroupBtn.setAttribute('data-i18n', 'options.modal.site.chainGroupRemove');
      removeGroupBtn.textContent = t('options.modal.site.chainGroupRemove', 'Remove group');
      removeGroupBtn.addEventListener('click', () => {
        const defaultName = `${t('options.modal.site.chainGroupLabel', 'Group')} ${groupIdx + 1}`;
        const label = (chainGroupsState[groupIdx].label || '').trim() || defaultName;
        const confirmMsg = t('options.modal.site.chainGroupDeleteConfirm', 'Remove this group and all its steps?').replace('{group}', label);
        if (!confirm(confirmMsg)) {
          return;
        }
        if (chainGroupsState.length <= 1) {
          chainGroupsState = [createChainGroup()];
        } else {
          chainGroupsState.splice(groupIdx, 1);
        }
        renderChainGroups();
      });

      header.append(left, removeGroupBtn);
      groupEl.appendChild(header);

      const stepsList = document.createElement('div');
      stepsList.className = 'chain-step-list';
      if (!group.steps.length) group.steps.push(createChainStep());
      group.steps.forEach((step, stepIdx) => {
        const stepWrapper = document.createElement('div');
        stepWrapper.className = 'chain-step';

        const stepHeader = document.createElement('div');
        stepHeader.className = 'chain-step-header';
        const stepTitle = document.createElement('span');
        stepTitle.textContent = `${t('options.modal.site.chainStepLabel', 'Step')} ${stepIdx + 1}`;
        const removeStepBtn = document.createElement('button');
        removeStepBtn.type = 'button';
        removeStepBtn.className = 'btn danger icon-left i-trash';
        removeStepBtn.setAttribute('data-i18n', 'options.modal.site.chainStepRemove');
        removeStepBtn.textContent = t('options.modal.site.chainStepRemove', 'Remove step');
        removeStepBtn.addEventListener('click', () => {
          const defaultName = `${t('options.modal.site.chainGroupLabel', 'Group')} ${groupIdx + 1}`;
          const groupLabel = (chainGroupsState[groupIdx].label || '').trim() || defaultName;
          const stepLabel = `${t('options.modal.site.chainStepLabel', 'Step')} ${stepIdx + 1}`;
          const confirmMsg = t('options.modal.site.chainStepDeleteConfirm', 'Remove this step from {group}?').replace('{group}', groupLabel).replace('{step}', stepLabel);
          if (!confirm(confirmMsg)) {
            return;
          }
          chainGroupsState[groupIdx].steps.splice(stepIdx, 1);
          if (!chainGroupsState[groupIdx].steps.length) {
            chainGroupsState[groupIdx].steps.push(createChainStep());
          }
          renderChainGroups();
        });
        stepHeader.append(stepTitle, removeStepBtn);

        const fields = document.createElement('div');
        fields.className = 'chain-step-fields';

        const selectorField = document.createElement('div');
        selectorField.className = 'field selector-field';
        const selectorLabel = document.createElement('label');
        selectorLabel.setAttribute('data-i18n', 'options.modal.site.chainStepSelector');
        selectorLabel.textContent = 'Selector';
        const selectorInput = document.createElement('input');
        selectorInput.type = 'text';
        selectorInput.value = step.selector || '';
        selectorInput.className = 'chain-selector';
        selectorInput.addEventListener('input', (e) => {
          chainGroupsState[groupIdx].steps[stepIdx].selector = e.target.value;
        });
        selectorField.append(selectorLabel, selectorInput);

        const nthField = document.createElement('div');
        nthField.className = 'field index-field';
        const nthLabel = document.createElement('label');
        nthLabel.setAttribute('data-i18n', 'options.modal.site.chainStepIndex');
        nthLabel.textContent = 'Index (optional)';
        const nthInput = document.createElement('input');
        nthInput.type = 'number';
        nthInput.min = '0';
        nthInput.step = '1';
        nthInput.value = step.nth || '';
        nthInput.className = 'chain-index';
        nthInput.addEventListener('input', (e) => {
          chainGroupsState[groupIdx].steps[stepIdx].nth = e.target.value;
        });
        nthField.append(nthLabel, nthInput);

        const textField = document.createElement('div');
        textField.className = 'field text-field';
        const textLabel = document.createElement('label');
        textLabel.setAttribute('data-i18n', 'options.modal.site.chainStepText');
        textLabel.textContent = 'Contains text (optional)';
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = step.text || '';
        textInput.className = 'chain-text';
        textInput.addEventListener('input', (e) => {
          chainGroupsState[groupIdx].steps[stepIdx].text = e.target.value;
        });
        textField.append(textLabel, textInput);

        fields.append(selectorField, nthField, textField);
        stepWrapper.append(stepHeader, fields);
        stepsList.appendChild(stepWrapper);
      });

      const addStepRow = document.createElement('div');
      addStepRow.className = 'add-step-row';
      const addStepBtn = document.createElement('button');
      addStepBtn.type = 'button';
      addStepBtn.className = 'btn add-model icon-left i-add';
      addStepBtn.setAttribute('data-i18n', 'options.modal.site.chainAdd');
      addStepBtn.textContent = t('options.modal.site.chainAdd', 'Add step');
      addStepBtn.addEventListener('click', () => {
        chainGroupsState[groupIdx].steps.push(createChainStep());
        renderChainGroups();
      });
      addStepRow.appendChild(addStepBtn);

      groupEl.append(stepsList, addStepRow);
      chainGroupsContainer.appendChild(groupEl);
    });
    try { applyTranslations(chainGroupsContainer); } catch {}
  }

  function sanitizeChainGroups() {
    const groups = [];
    let activeSteps = 0;
    for (const group of chainGroupsState) {
      const steps = [];
      for (const step of group.steps) {
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
        steps.push({ selector, text, nth });
      }
      if (!steps.length) continue;
      const isActive = group?.active !== false;
      if (isActive) {
        activeSteps += steps.length;
      }
      groups.push({
        id: group.id || `cg_${Math.random().toString(36).slice(2, 8)}`,
        label: String(group.label || '').trim(),
        active: isActive,
        steps
      });
    }
    if (!groups.length || activeSteps === 0) {
      return { ok: false, error: t('options.modal.site.chainGroupRequired', 'Add at least one active chain group with a selector.') };
    }
    const flattened = groups.reduce((acc, group) => {
      if (!group.active) return acc;
      return acc.concat(group.steps);
    }, []);
    return { ok: true, groups, chain: flattened };
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
  }

  const onKey = (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { save.click(); }
    if (ev.key === 'Escape') { dlg.close?.(); }
  };

  function onStrategyChange() {
    activateStrategy(strategySel?.value || 'css');
  }

  function activateStrategy(value) {
    const val = ['css', 'chain', 'script'].includes(value) ? value : 'css';
    if (strategySel) strategySel.value = val;
    strategyTabs.forEach(btn => {
      const isActive = btn.dataset.tab === val;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    strategyPanels.forEach(panel => {
      const match = panel.dataset.panel === val;
      panel.hidden = !match;
    });
    if (sel) sel.required = val === 'css';
  }

  function onStrategyTabClick(e) {
    e?.preventDefault?.();
    const tab = e.currentTarget?.dataset.tab;
    if (tab) activateStrategy(tab);
  }

  function onAddChainGroup(e) {
    e?.preventDefault?.();
    chainGroupsState.push(createChainGroup());
    renderChainGroups();
  }

  activateStrategy(strategySel?.value || 'css');
  renderChainGroups();

  attachKeyHandler(host);
  attachKeyHandler(sel);
  attachKeyHandler(com);
  attachKeyHandler(scriptInput);
  if (chainGroupsContainer) chainGroupsContainer.addEventListener('keydown', onKey);
  if (strategySel) strategySel.addEventListener('change', onStrategyChange);
  strategyTabs.forEach(btn => btn.addEventListener('click', onStrategyTabClick));
  addChainGroupBtn?.addEventListener('click', onAddChainGroup);

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
      chainGroups: [],
      script: scriptInput?.value?.trim() || '',
      chainSequential: strategy === 'chain'
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
      data.chain = [];
      data.chainGroups = [];
      data.script = '';
    } else if (strategy === 'chain') {
      const chainSanitized = sanitizeChainGroups();
      if (!chainSanitized.ok) {
        alert(chainSanitized.error);
        return;
      }
      data.chain = chainSanitized.chain;
      data.chainGroups = chainSanitized.groups;
      data.selector = '';
      data.script = '';
    } else if (strategy === 'script') {
      data.script = (scriptInput?.value || '').trim();
      if (!data.script) {
        alert(t('options.modal.site.scriptRequired', 'Provide a script body that returns text.'));
        return;
      }
      data.chain = [];
      data.chainGroups = [];
      data.selector = '';
      const previousScript = String(rule?.script || '').trim();
      const scriptChanged = !rule || rule.strategy !== 'script' || previousScript !== data.script;
      if (scriptChanged) {
        const confirmed = confirm(t('options.modal.site.scriptConfirm', 'Custom scripts run inside the visited page and can access its data. Save this script?'));
        if (!confirmed) {
          return;
        }
      }
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
