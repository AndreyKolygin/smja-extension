// actions.js — Select/Clear/Analyze/Copy/Save
import { state, setJobInput, setProgress, startTimer, stopTimer, setResult, setLastMeta, getActiveTab } from "./state.js";
import { t } from "./i18n.js";

let __anBtnTicker = 0;
let __anBtnStart = 0;

// content-extraction defaults
const DEFAULT_EXTRACT_WAIT = 4000; // ms
const DEFAULT_EXTRACT_POLL = 150;  // ms

function normalizeRuleForExec(ruleOrSelector) {
  if (!ruleOrSelector && ruleOrSelector !== '') return null;
  if (typeof ruleOrSelector === 'string') {
    const selector = ruleOrSelector.trim();
    if (!selector) return null;
    return {
      strategy: 'css',
      selector,
      chain: [],
      script: ''
    };
  }
  const raw = (ruleOrSelector && typeof ruleOrSelector === 'object') ? ruleOrSelector : {};
  const strategy = typeof raw.strategy === 'string' ? raw.strategy.toLowerCase() : 'css';
  const selector = typeof raw.selector === 'string' ? raw.selector.trim() : '';
  const script = typeof raw.script === 'string' ? raw.script.trim() : '';
  const chain = Array.isArray(raw.chain)
    ? raw.chain.map((step) => {
        const sel = typeof step?.selector === 'string' ? step.selector.trim() : '';
        if (!sel) return null;
        const text = typeof step?.text === 'string' ? step.text.trim() : '';
        let nth = null;
        if (Number.isFinite(step?.nth)) {
          nth = Math.max(0, Math.floor(step.nth));
        } else if (typeof step?.nth === 'string' && step.nth.trim()) {
          const parsed = Number(step.nth.trim());
          if (Number.isFinite(parsed) && parsed >= 0) {
            nth = Math.floor(parsed);
          }
        }
        return { selector: sel, text, nth };
      }).filter(Boolean)
    : [];
  return {
    strategy: ['css', 'chain', 'script'].includes(strategy) ? strategy : 'css',
    selector,
    chain,
    script
  };
}

async function evaluateRuleInPage(rule) {
  try {
    const strategy = (rule?.strategy || 'css').toLowerCase();

    function nodesToText(nodes) {
      const unique = [];
      const seen = new Set();
      for (const node of nodes || []) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        const text = (node.innerText ?? node.textContent ?? '').trim();
        if (text) unique.push(text);
      }
      const text = unique.join('\n\n')
        .replace(/\u00A0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return { text, count: unique.length };
    }

    function collectNodes(root, selector) {
      const parts = String(selector || '').split(',').map(s => s.trim()).filter(Boolean);
      const seen = new Set();
      const out = [];

      function pushNode(node) {
        if (node && !seen.has(node)) {
          seen.add(node);
          out.push(node);
        }
      }

      function collect(rootNode, sel) {
        if (!rootNode || !sel) return;
        try {
          if (rootNode instanceof Element && rootNode.matches?.(sel)) {
            pushNode(rootNode);
          }
        } catch {}
        try {
          const list = rootNode.querySelectorAll ? rootNode.querySelectorAll(sel) : [];
          for (const node of list) pushNode(node);
        } catch {}
        const descendants = rootNode.querySelectorAll ? rootNode.querySelectorAll('*') : [];
        for (const el of descendants) {
          if (el.shadowRoot) {
            collect(el.shadowRoot, sel);
          }
        }
      }

      for (const part of parts) {
        collect(root, part);
      }
      return out;
    }

    if (strategy === 'css') {
      const selector = String(rule?.selector || '').trim();
      if (!selector) return { ok: false, error: 'no_selector' };
      const nodes = collectNodes(document, selector);
      const { text, count } = nodesToText(nodes);
      return { ok: !!text, text, count };
    }

    if (strategy === 'chain') {
      const chain = Array.isArray(rule?.chain) ? rule.chain : [];
      if (!chain.length) return { ok: false, error: 'empty_chain' };
      let current = [document];
      for (const step of chain) {
        const sel = String(step?.selector || '').trim();
        if (!sel) continue;
        const next = [];
        const seen = new Set();
        for (const scope of current) {
          const nodes = collectNodes(scope, sel);
          let filtered = nodes;
          const textFilter = String(step?.text || '').trim().toLowerCase();
          if (textFilter) {
            filtered = filtered.filter(node => {
              const raw = (node.innerText ?? node.textContent ?? '').toLowerCase();
              return raw.includes(textFilter);
            });
          }
          const nth = Number.isFinite(step?.nth) ? step.nth : null;
          if (nth != null) {
            filtered = filtered[nth] ? [filtered[nth]] : [];
          }
          for (const node of filtered) {
            if (node && !seen.has(node)) {
              seen.add(node);
              next.push(node);
            }
          }
        }
        current = next;
        if (!current.length) break;
      }
      const { text, count } = nodesToText(current);
      return { ok: !!text, text, count };
    }

    if (strategy === 'script') {
      const body = String(rule?.script || '');
      if (!body.trim()) return { ok: false, error: 'empty_script' };
      try {
        const fn = new Function('document', 'window', 'root', '"use strict";' + body);
        const value = fn(document, window, document);
        const resolved = value && typeof value.then === 'function' ? await value : value;
        const text = typeof resolved === 'string'
          ? resolved
          : (resolved == null ? '' : String(resolved));
        const clean = text
          .replace(/\u00A0/g, ' ')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        return { ok: !!clean, text: clean, count: clean ? 1 : 0 };
      } catch (err) {
        return { ok: false, error: String(err && (err.message || err)) };
      }
    }

    return { ok: false, error: 'unknown_strategy' };
  } catch (err) {
    return { ok: false, error: String(err && (err.message || err)) };
  }
}

function startAnalyzeButtonTimer() {
  const btn = document.getElementById("analyzeBtn");
  if (!btn) return;
  btn.disabled = true;
  __anBtnStart = performance.now();
  if (__anBtnTicker) clearInterval(__anBtnTicker);
  // мгновенный показ
  btn.textContent = `0.0s…`;
  __anBtnTicker = setInterval(() => {
    const s = (performance.now() - __anBtnStart) / 1000;
    btn.textContent = `${s.toFixed(1)}s…`;
  }, 100);
}

function stopAnalyzeButtonTimer(finalMs, isError = false) {
  const btn = document.getElementById("analyzeBtn");
  if (!btn) return;
  if (__anBtnTicker) clearInterval(__anBtnTicker);
  __anBtnTicker = 0;

  const label = isError ? "Error" : `Done: ${(finalMs / 1000).toFixed(2)}s`;
  btn.textContent = label;
  // вернуть в исходное состояние через 5с
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = "Analyze";
  }, 5000);
}

export async function startSelection() {
  const resp = await chrome.runtime.sendMessage({ type: 'BEGIN_SELECTION' });
  if (!resp?.ok) {
    alert('Cannot start selection: ' + (resp?.error || 'unknown error'));
  }
}

export async function clearSelection() {
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_SELECTION' });
  } catch {}
  state.selectedText = "";
  const ji = document.getElementById("jobInput"); if (ji) ji.value = "";
  setResult("");
  setLastMeta(null);
  setProgress("Progress: 0 ms");
  try { chrome.storage.local.remove(["lastResult","lastError","lastSelection"], ()=>{}); } catch {}
  state.lastResponse = "";
}

export function wireCopy() {
  document.getElementById("copyBtn")?.addEventListener("click", async () => {
    const txt = state.lastResponse || "";
    try { await navigator.clipboard.writeText(txt); setProgress("Copied to clipboard"); setTimeout(()=>setProgress(""),1200);} catch {}
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
    return { ok: false, error: "Configure Notion field mapping before saving." };
  }
  const hasTitle = fields.some(f => String(f.propertyType || '').toLowerCase() === 'title');
  if (!hasTitle) {
    return { ok: false, error: "Add a Notion field mapped to a Title property." };
  }
  for (const f of fields) {
    const propName = String(f.propertyName || '').trim();
    if (!propName) {
      return { ok: false, error: "Each Notion field mapping must have a property name." };
    }
    if ((f.source === 'analysis' || f.source === 'custom') && !String(f.staticValue || '').trim()) {
      return { ok: false, error: `Fill Source data value for "${propName}".` };
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
      alert("Save to Notion is disabled in settings.");
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

    const payload = {
      analysis: state.lastResponse || "",
      jobDescription: jobInput?.value || "",
      selectedText: state.selectedText || "",
      modelId: model?.id || state.chosenModel || "",
      providerId: model?.providerId || "",
      modelLabel: model?.displayName || model?.modelId || "",
      providerName: provider?.name || "",
      tabUrl: state.activeTab?.url || "",
      tabTitle: state.activeTab?.title || "",
      timestampIso: new Date().toISOString()
    };

    setProgress("Saving to Notion…");
    btn.disabled = true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: "SAVE_TO_NOTION", payload });
      if (resp?.ok) {
        setProgress("Saved to Notion");
        setTimeout(() => setProgress(""), 2000);
      } else {
        setProgress("");
        alert("Save to Notion failed: " + (resp?.error || "Unknown error"));
      }
    } catch (e) {
      setProgress("");
      alert("Save to Notion failed: " + String(e && (e.message || e)));
    } finally {
      btn.disabled = false;
    }
  });
}

// --- utils: печать в консоль попапа с узнаваемым префиксом
const dbg = (...a) => console.debug("[FastStart]", ...a);

// Универсальный матчинг правил сайта
function wildcardToRegExp(str, { anchor = true } = {}) {
  const esc = String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = esc.replace(/\\\*/g, ".*").replace(/\\\?/g, ".");
  return new RegExp((anchor ? "^" : "") + body + (anchor ? "$" : ""), "i");
}

function siteMatches(url, pattern) {
  try {
    const full = String(url || "");
    const u = new URL(full);
    const host = (u.hostname || "").toLowerCase();
    let p = String(pattern || "").trim();
    if (!p) return false;

    // 0) Регэксп в виде /.../flags — матчим по ПОЛНОМУ URL
    if (p.startsWith("/") && p.lastIndexOf("/") > 0) {
      const last = p.lastIndexOf("/");
      const body = p.slice(1, last);
      const flags = p.slice(last + 1) || "i";
      try { return new RegExp(body, flags).test(full); } catch { return false; }
    }

    // 1) Если шаблон содержит протокол — считаем это маской ПОЛНОГО URL
    if (p.includes("://")) {
      const rx = new RegExp(
        String(p)
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\\\*/g, ".*")
          .replace(/\\\?/g, "."),
        "i"
      );
      return rx.test(full);
    }

    // 2) Разделяем шаблон на hostPart и pathPart
    let hostPart = p;
    let pathPart = "";
    if (p.startsWith("/")) {
      hostPart = "";
      pathPart = p; // уже с ведущим /
    } else if (p.includes("/")) {
      const i = p.indexOf("/");
      hostPart = p.slice(0, i);
      pathPart = p.slice(i);
    }

    hostPart = hostPart.toLowerCase();

    // 3) Матчим hostPart
    if (hostPart) {
      // 3a) Явный шаблон с подстановкой "*."
      if (hostPart.startsWith("*.")) {
        const bare = hostPart.slice(2); // после "*."
        // допускаем bare сам по себе и любые поддомены
        if (!(host === bare || host.endsWith("." + bare))) return false;
      } else {
        // 3b) «Голый» домен матчится и на сам домен, и на ЛЮБЫЕ поддомены
        // (раньше требовалось точное совпадение — из-за этого и было "host mismatch")
        if (!(host === hostPart || host.endsWith("." + hostPart))) return false;
      }
    }

    // 4) Матчим pathPart (если задан) — якорим к началу pathname
    if (pathPart) {
      const rx = new RegExp(
        "^" +
          String(pathPart)
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\\\*/g, ".*")
            .replace(/\\\?/g, "."),
        "i"
      );
      return rx.test(u.pathname || "/");
    }

    // 5) Если pathPart пуст — считаем совпадение по хосту достаточным
    return true;
  } catch {
    return false;
  }
}

export async function ensureContentScript(tabId) {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'ENSURE_CONTENT_SCRIPT', tabId });
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

  const tab = await getActiveTab();
  if (!tab?.url) { btn.hidden = true; return; }

  const rules = (state.settings?.sites || []).filter(r => r && (r.active === undefined || r.active));
  dbg("url=", tab.url, "rules=", rules);

  let match = null;
  for (const r of rules) {
    const pat = r.host || r.pattern || ""; // на всякий — если кто-то называл поле иначе
    const ok = siteMatches(tab.url, pat);
    dbg("test:", pat, "→", ok);
    if (ok) { match = r; break; }
  }

  dbg("matched:", match);
  if (!match) { btn.hidden = true; return; }

  const normalizedRule = normalizeRuleForExec(match);
  if (!normalizedRule) { btn.hidden = true; return; }

  btn.hidden = false;
  btn.classList.remove("hidden");
  btn.__fastRule = normalizedRule;
  btn.onclick = async () => {
    try {
      const ready = await ensureContentScript(tab.id);
      if (!ready) { alert(t('options.faststart.noAccess', "Cannot access page. Content script isn't available.")); return; }

      const selectedRule = btn.__fastRule || normalizeRuleForExec(match);
      if (!selectedRule) { alert(t('options.faststart.invalidRule', "Auto-extraction rule is not configured.")); return; }

      if (selectedRule.strategy === 'css' && !selectedRule.selector) {
        alert(t('options.faststart.missingSelector', "Auto-extraction rule is missing a selector."));
        return;
      }
      if (selectedRule.strategy === 'chain' && (!Array.isArray(selectedRule.chain) || !selectedRule.chain.length)) {
        alert(t('options.faststart.missingChain', "Auto-extraction chain has no steps."));
        return;
      }
      if (selectedRule.strategy === 'script' && !selectedRule.script) {
        alert(t('options.faststart.missingScript', "Auto-extraction script body is empty."));
        return;
      }

      setProgress?.(t('options.faststart.progress', "Grabbing description…"));

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
        } else if (err === 'empty_script') {
          msg = t('options.faststart.missingScript', "Auto-extraction script body is empty.");
        } else if (err === 'unknown_strategy') {
          msg = t('options.faststart.unknownStrategy', "Unknown extraction strategy.");
        } else if (err === 'invalid_rule' || err === 'no_rule') {
          msg = t('options.faststart.invalidRule', "Auto-extraction rule is not configured.");
        } else if (err === 'notfound') {
          msg = t('options.faststart.notFound', "Nothing matched on this page.");
        } else {
          msg = err || t('options.faststart.notFound', "Nothing matched on this page.");
        }
        setProgress?.("");
        alert(t('options.faststart.failedPrefix', "Extraction failed: ") + msg);
        return;
      }

      const text = String(resp.text || "").trim();
      if (!text) {
        setProgress?.("");
        alert(t('options.faststart.notFound', "Nothing matched on this page."));
        return;
      }

      state.selectedText = text;
      setJobInput(text);
      try { chrome.storage.local.set({ lastSelection: text, lastSelectionWhen: Date.now() }); } catch {}
      setProgress?.("Description grabbed ✔");
      setTimeout(() => setProgress?.(""), 1500);
    } catch (e) {
      dbg("fastStart failed:", e);
      alert("Extraction failed. Ensure content script is injected on this page.");
    }
  };
}

export function wireAnalyzeButtons() {
  const analyzeSelectedText = () => {
    const jobVal = document.getElementById("jobInput")?.value?.trim() || "";
    if (jobVal) state.selectedText = jobVal;

    if (!state.selectedText) {
      setResult("Add a job description (select on page or paste above)");
      return;
    }
    const models = (state.settings?.models || []).filter(m => m.active);
    const selected = models.find(m => m.id === (state.chosenModel || document.getElementById("modelSelect")?.value));
    if (!selected) { setResult("No active model is selected."); return; }

    // сохранить текущий ввод для восстановления
    try { chrome.storage.local.set({ lastSelection: state.selectedText }, ()=>{}); } catch {}

    // таймер в строке Progress + таймер на кнопке
    startTimer("Progress");
    startAnalyzeButtonTimer();

    chrome.runtime.sendMessage({
      type: "CALL_LLM",
      payload: {
        modelId: selected.modelId,
        providerId: selected.providerId,
        cv: state.settings.cv || "",
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
        setResult("Error: " + (resp?.error || "Unknown"));
        stopAnalyzeButtonTimer(elapsed || 0, true);
      }
    }).catch(() => {
      const elapsed = Math.max(0, performance.now() - state.timerStart);
      stopTimer(true, elapsed);
      setResult("Error: request failed");
      stopAnalyzeButtonTimer(elapsed || 0, true);
    });
  };

  document.getElementById("refreshBtn")?.addEventListener("click", analyzeSelectedText);
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
      md += `---\n\n## Original job description\n\n${jobDesc}\n`;
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
