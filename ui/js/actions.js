// actions.js — Select/Clear/Analyze/Copy/Save
import { state, setJobInput, setProgress, startTimer, stopTimer, setResult, setLastMeta, getActiveTab, getSelectedCvInfo } from "./state.js";
import { t } from "./i18n.js";
import { normalizeRuleForExec, evaluateRuleInPage, siteMatches, findMatchingRule } from "../../shared/rules.js";

let __anBtnTicker = 0;
let __anBtnStart = 0;

// content-extraction defaults
const DEFAULT_EXTRACT_WAIT = 4000; // ms
const DEFAULT_EXTRACT_POLL = 150;  // ms


function startAnalyzeButtonTimer() {
  const btn = document.getElementById("analyzeBtn");
  if (!btn) return;
  btn.disabled = true;
  __anBtnStart = performance.now();
  if (__anBtnTicker) clearInterval(__anBtnTicker);
  // мгновенный показ
  const tickerTemplate = t('ui.popup.analyzeTicker', '{{seconds}}s…');
  btn.textContent = tickerTemplate.replace('{{seconds}}', '0.0');
  __anBtnTicker = setInterval(() => {
    const s = (performance.now() - __anBtnStart) / 1000;
    btn.textContent = tickerTemplate.replace('{{seconds}}', s.toFixed(1));
  }, 100);
}

function stopAnalyzeButtonTimer(finalMs, isError = false) {
  const btn = document.getElementById("analyzeBtn");
  if (!btn) return;
  if (__anBtnTicker) clearInterval(__anBtnTicker);
  __anBtnTicker = 0;

  const seconds = (finalMs / 1000).toFixed(2);
  const label = isError
    ? t('ui.popup.analyzeError', 'Error')
    : t('ui.popup.analyzeDone', 'Done: {{seconds}}s').replace('{{seconds}}', seconds);
  btn.textContent = label;
  // вернуть в исходное состояние через 5с
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = t('ui.popup.analyze', 'Analyze');
  }, 5000);
}

async function sendMessageWithRetry(message, { retries = 1, delayMs = 200 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg.includes('Extension context invalidated') && attempt < retries) {
        attempt += 1;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
}

export async function startSelection() {
  try {
    const resp = await sendMessageWithRetry({ type: 'BEGIN_SELECTION' }, { retries: 2, delayMs: 250 });
    if (!resp?.ok) {
      const msg = resp?.error || 'unknown error';
      alert(t('ui.popup.selectionFailed', 'Cannot start selection: {{error}}').replace('{{error}}', msg));
    }
  } catch (err) {
    console.warn('[JDA] BEGIN_SELECTION failed:', err);
    alert(t('ui.popup.selectionFailed', 'Cannot start selection: {{error}}').replace('{{error}}', t('ui.popup.messageRequestFailed', 'request failed')));
  }
}

export async function clearSelection() {
  try {
    await sendMessageWithRetry({ type: 'CLEAR_SELECTION' }, { retries: 2, delayMs: 250 });
  } catch {}
  state.selectedText = "";
  const ji = document.getElementById("jobInput"); if (ji) ji.value = "";
  setResult("");
  setLastMeta(null);
  setProgress(t('ui.popup.progress', 'Progress: {{ms}} ms').replace('{{ms}}', '0'), 0, { i18nKey: 'ui.popup.progress' });
  try { chrome.storage.local.remove(["lastResult","lastError","lastSelection"], ()=>{}); } catch {}
  state.lastResponse = "";
}

export function wireCopy() {
  document.getElementById("copyBtn")?.addEventListener("click", async () => {
    const txt = state.lastResponse || "";
    try { await navigator.clipboard.writeText(txt); setProgress(t('ui.popup.progressCopied', 'Copied to clipboard'), null, { i18nKey: 'ui.popup.progressCopied' }); setTimeout(()=>setProgress('', null),1200);} catch {}
  });
}

export function updateNotionButtonVisibility() {
  const btn = document.getElementById("notionBtn");
  if (!btn) return;
  const enabled = !!state.settings?.integrations?.notion?.enabled;
  btn.hidden = !enabled;
  btn.classList.toggle("hidden", !enabled);
}

function validateNotionMappingConfig(notion) {
  const fields = Array.isArray(notion?.fields) ? notion.fields.filter(f => f && f.propertyName) : [];
  if (!fields.length) {
    return { ok: false, error: t('ui.popup.notionErrorConfigure', 'Configure Notion field mapping before saving.') };
  }
  const hasTitle = fields.some(f => String(f.propertyType || '').toLowerCase() === 'title');
  if (!hasTitle) {
    return { ok: false, error: t('ui.popup.notionErrorNeedTitle', 'Add a Notion field mapped to a Title property.') };
  }
  for (const f of fields) {
    const propName = String(f.propertyName || '').trim();
    if (!propName) {
      return { ok: false, error: t('ui.popup.notionErrorPropertyName', 'Each Notion field mapping must have a property name.') };
    }
    if ((f.source === 'analysis' || f.source === 'custom') && !String(f.staticValue || '').trim()) {
      return { ok: false, error: t('ui.popup.notionErrorSourceValue', 'Fill Source data value for “{property}”.').replace('{property}', propName) };
    }
  }
  return { ok: true };
}

export function wireSaveToNotion() {
  const btn = document.getElementById("notionBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const notion = state.settings?.integrations?.notion;
    if (!notion?.enabled) {
      alert(t('ui.popup.notionDisabled', 'Save to Notion is disabled in settings.'));
      return;
    }

    const validation = validateNotionMappingConfig(notion);
    if (!validation.ok) {
      alert(validation.error);
      return;
    }

    const jobInput = document.getElementById("jobInput");
    const model = Array.isArray(state.settings?.models)
      ? state.settings.models.find(m => m && m.id === state.chosenModel)
      : null;
    const provider = Array.isArray(state.settings?.providers)
      ? state.settings.providers.find(p => p && p.id === (model?.providerId || notion.providerId))
      : null;

    let activeTab = state.activeTab;
    try {
      const freshTab = await getActiveTab({ refresh: true });
      if (freshTab) activeTab = freshTab;
    } catch {}
    if (activeTab && activeTab !== state.activeTab) {
      state.activeTab = activeTab;
    }

    const payload = {
      analysis: state.lastResponse || "",
      jobDescription: jobInput?.value || "",
      selectedText: state.selectedText || "",
      modelId: model?.id || state.chosenModel || "",
      providerId: model?.providerId || "",
      modelLabel: model?.displayName || model?.modelId || "",
      providerName: provider?.name || "",
      tabUrl: activeTab?.url || "",
      tabTitle: activeTab?.title || "",
      timestampIso: new Date().toISOString()
    };

    const cvInfo = getSelectedCvInfo();
    payload.cvId = cvInfo.id || '';
    payload.cvTitle = cvInfo.title || '';
    payload.cvText = cvInfo.content || '';

    setProgress(t('ui.popup.progressSaving', 'Saving to Notion…'), null, { i18nKey: 'ui.popup.progressSaving' });
    btn.disabled = true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: "SAVE_TO_NOTION", payload });
      if (resp?.ok) {
        setProgress(t('ui.popup.progressSaved', 'Saved to Notion'), null, { i18nKey: 'ui.popup.progressSaved' });
        setTimeout(() => setProgress('', null), 2000);
      } else {
        setProgress('', null);
        const msg = resp?.error || 'Unknown error';
        alert(t('ui.popup.notionFailed', 'Save to Notion failed: {{error}}').replace('{{error}}', msg));
      }
    } catch (e) {
      setProgress('', null);
      const msg = String(e && (e.message || e));
      alert(t('ui.popup.notionFailed', 'Save to Notion failed: {{error}}').replace('{{error}}', msg));
    } finally {
      btn.disabled = false;
    }
  });
}

// --- utils: печать в консоль попапа с узнаваемым префиксом
const dbg = (...a) => console.debug("[FastStart]", ...a);

// Универсальный матчинг правил сайта оставлен в shared/rules.js

export async function ensureContentScript(tabId) {
  try {
    const resp = await sendMessageWithRetry({ type: 'ENSURE_CONTENT_SCRIPT', tabId }, { retries: 2, delayMs: 250 });
    return !!resp?.ok;
  } catch (e) {
    console.warn('[JDA] ensureContentScript failed:', e);
    return false;
  }
}

async function extractFromRule(tabId, ruleInput, { waitMs = DEFAULT_EXTRACT_WAIT, pollMs = DEFAULT_EXTRACT_POLL } = {}) {
  const rule = normalizeRuleForExec(ruleInput);
  if (!rule) return { ok: false, error: 'invalid_rule' };

  if (chrome?.scripting?.executeScript) {
    const deadline = Date.now() + Math.max(800, Number(waitMs) || 3000);
    async function readOnceAllFrames() {
      try {
        const injResults = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'ISOLATED',
          func: evaluateRuleInPage,
          args: [rule]
        });
        const texts = [];
        let last = null;
        for (const inj of injResults || []) {
          const r = inj?.result;
          if (r) last = r;
          if (r?.ok && r.text) texts.push(r.text);
        }
        if (texts.length) {
          return { ok: true, text: texts.join('\n\n') };
        }
        return last || { ok: false, error: 'notfound' };
      } catch (e) {
        return { ok: false, error: String(e && (e.message || e)) };
      }
    }
    let lastErr = 'timeout';
    while (Date.now() < deadline) {
      const res = await readOnceAllFrames();
      if (res?.ok) return res;
      lastErr = res?.error || lastErr;
      await new Promise(r => setTimeout(r, Math.max(80, Number(pollMs) || 160)));
    }
    return { ok: false, error: lastErr };
  }

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'EXTRACT_FROM_PAGE', rule, waitMs, pollMs });
    return resp || { ok: false, error: 'no_response' };
  } catch (e) {
    return { ok: false, error: String(e && (e.message || e)) };
  }
}

// показать/скрыть кнопку Fast start
export async function detectAndToggleFastStart() {
  const btn = document.getElementById("fastStartBtn");
  if (!btn) return;

  const tab = await getActiveTab({ refresh: true });
  if (tab) state.activeTab = tab;
  if (!tab?.url) {
    btn.hidden = true;
    return;
  }

  const rules = state.settings?.sites || [];
  dbg("url=", tab.url, "rules=", rules);

  const match = findMatchingRule(rules, tab.url);

  dbg("matched:", match);
  if (!match) {
    btn.hidden = true;
    return;
  }

  const normalizedRule = normalizeRuleForExec(match);
  if (!normalizedRule) {
    btn.hidden = true;
    return;
  }

  btn.hidden = false;
  btn.classList.remove("hidden");
  btn.__fastRule = normalizedRule;
  btn.onclick = async () => {
    try {
      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        alert(t('options.faststart.noAccess', "Cannot access page. Content script isn't available."));
        return;
      }

      const selectedRule = btn.__fastRule || normalizeRuleForExec(match);
      if (!selectedRule) {
        alert(t('options.faststart.invalidRule', "Auto-extraction rule is not configured."));
        return;
      }

      if (selectedRule.strategy === 'css' && !selectedRule.selector) {
        alert(t('options.faststart.missingSelector', "Auto-extraction rule is missing a selector."));
        return;
      }
      if (selectedRule.strategy === 'chain' && (!Array.isArray(selectedRule.chain) || !selectedRule.chain.length)) {
        alert(t('options.faststart.missingChain', "Auto-extraction chain has no steps."));
        return;
      }
      if (selectedRule.strategy === 'template' && !selectedRule.template) {
        alert(t('options.faststart.missingTemplate', "Auto-extraction template is empty."));
        return;
      }

      setProgress(t('options.faststart.progress', "Grabbing description…"), 0, { i18nKey: 'options.faststart.progress' });

      const resp = await extractFromRule(tab.id, selectedRule, { waitMs: DEFAULT_EXTRACT_WAIT, pollMs: DEFAULT_EXTRACT_POLL });

      if (!resp?.ok) {
        const err = String(resp?.error || '');
        let msg;
        if (/port closed|context invalidated/i.test(err)) {
          msg = t('options.faststart.pageChanged', "Page changed before we could read it. Try again.");
        } else if (err === 'no_selector') {
          msg = t('options.faststart.missingSelector', "Auto-extraction rule is missing a selector.");
        } else if (err === 'empty_chain') {
          msg = t('options.faststart.missingChain', "Auto-extraction chain has no steps.");
        } else if (err === 'empty_template') {
          msg = t('options.faststart.missingTemplate', "Auto-extraction template is empty.");
        } else if (err === 'unknown_strategy') {
          msg = t('options.faststart.unknownStrategy', "Unknown extraction strategy.");
        } else if (err === 'invalid_rule' || err === 'no_rule') {
          msg = t('options.faststart.invalidRule', "Auto-extraction rule is not configured.");
        } else if (err === 'notfound') {
          msg = t('options.faststart.notFound', "Nothing matched on this page.");
        } else {
          msg = err || t('options.faststart.notFound', "Nothing matched on this page.");
        }
        setProgress('', null);
        alert(t('options.faststart.failedPrefix', "Extraction failed: ") + msg);
        return;
      }

      const text = String(resp.text || "").trim();
      if (!text) {
        setProgress('', null);
        alert(t('options.faststart.notFound', "Nothing matched on this page."));
        return;
      }

      state.selectedText = text;
      setJobInput(text);
      try { chrome.storage.local.set({ lastSelection: text, lastSelectionWhen: Date.now() }); } catch {}
      setProgress(t('options.faststart.grabbed', 'Description grabbed ✔'), null, { i18nKey: 'options.faststart.grabbed' });
      setTimeout(() => setProgress('', null), 1500);
    } catch (e) {
      dbg("fastStart failed:", e);
      alert(t('ui.popup.faststartFailed', 'Extraction failed. Ensure content script is injected on this page.'));
    }
  };
}

export function wireAnalyzeButtons() {
  const analyzeSelectedText = () => {
    const jobVal = document.getElementById("jobInput")?.value?.trim() || "";
    if (jobVal) state.selectedText = jobVal;

    if (!state.selectedText) {
      setResult(t('ui.popup.messageAddDescription', 'Add a job description (select on page or paste above)'));
      return;
    }
    const models = (state.settings?.models || []).filter(m => m.active);
    const selected = models.find(m => m.id === (state.chosenModel || document.getElementById("modelSelect")?.value));
    if (!selected) { setResult(t('ui.popup.messageNoModel', 'No active model is selected.')); return; }

    // сохранить текущий ввод для восстановления
    try { chrome.storage.local.set({ lastSelection: state.selectedText }, ()=>{}); } catch {}

    // таймер в строке Progress + таймер на кнопке
    startTimer();
    startAnalyzeButtonTimer();

    const cvInfo = getSelectedCvInfo();

    chrome.runtime.sendMessage({
      type: "CALL_LLM",
      payload: {
        modelId: selected.modelId,
        providerId: selected.providerId,
        cv: cvInfo.content || "",
        cvId: cvInfo.id || "",
        cvTitle: cvInfo.title || "",
        systemTemplate: state.settings.systemTemplate || "",
        outputTemplate: state.settings.outputTemplate || "",
        modelSystemPrompt: selected.systemPrompt || "",
        text: state.selectedText
      }
    }).then((resp) => {
      const elapsed = Math.max(0, performance.now() - state.timerStart);
      const ms = (resp && typeof resp.ms === "number") ? resp.ms : elapsed;
      stopTimer(true, ms);

      if (resp?.ok) {
        state.lastResponse = resp.text || "";
        setResult(state.lastResponse);
        setLastMeta(Date.now());
        try { chrome.storage.local.set({ lastResult: { text: state.lastResponse, when: Date.now(), ms } }, ()=>{}); } catch {}
        stopAnalyzeButtonTimer(ms, false);
      } else {
        const msg = resp?.error || t('ui.popup.messageUnknownError', 'Unknown');
        setResult(t('ui.popup.messageError', 'Error: {{message}}').replace('{{message}}', msg));
        stopAnalyzeButtonTimer(elapsed || 0, true);
      }
    }).catch(() => {
      const elapsed = Math.max(0, performance.now() - state.timerStart);
      stopTimer(true, elapsed);
      setResult(t('ui.popup.messageError', 'Error: {{message}}').replace('{{message}}', t('ui.popup.messageRequestFailed', 'request failed')));
      stopAnalyzeButtonTimer(elapsed || 0, true);
    });
  };

  document.getElementById("analyzeBtn")?.addEventListener("click", analyzeSelectedText);
}

export function wireSave() {
  const btn = document.getElementById("saveBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    // analysis: исходный markdown из состояния (не из HTML)
    const analysisMd = state.lastResponse?.trim() || "";
    // job description: из textarea
    const jobDesc = document.getElementById("jobInput")?.value?.trim() || "";

    // собираем markdown-файл
    let md = `# Position matching result\n\n`;
    md += analysisMd ? analysisMd + "\n\n" : "_(no analysis result)_\n\n";
    if (jobDesc) {
      md += `---\n\n# Original job description\n\n${jobDesc}\n`;
    }

    try {
      // сохраняем также в local кэш (необязательно, но полезно)
      chrome.storage.local.set({ lastExport: { when: Date.now(), size: md.length } }, () => {});
    } catch {}

    const blob = new Blob([md], { type: "text/markdown" });
    const reader = new FileReader();
    reader.onload = async () => {
      const url = reader.result;
      await chrome.downloads.download({
        url,
        filename: `jda_result_${Date.now()}.md`,
        saveAs: true
      });
    };
    reader.readAsDataURL(blob);
  });
}

export function wireJobInputSync() {
  document.getElementById("jobInput")?.addEventListener("input", (e) => {
    state.selectedText = e.target.value;
    try { chrome.storage.local.set({ lastSelection: state.selectedText }, ()=>{}); } catch {}
  });
}
