// actions.js — Select/Clear/Analyze/Copy/Save
import { state, setJobInput, setProgress, startTimer, stopTimer, setResult, setLastMeta, getActiveTab } from "./state.js";

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

async function extractFromPage(tabId, selector, { waitMs = DEFAULT_EXTRACT_WAIT, pollMs = DEFAULT_EXTRACT_POLL } = {}) {
  // Если мы внутри popup (chrome.scripting доступен), можно читать напрямую.
  if (chrome?.scripting?.executeScript) {
    const deadline = Date.now() + Math.max(800, Number(waitMs) || 3000);
    async function readOnceAllFrames() {
      try {
        const injResults = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'ISOLATED',
          func: (sel) => {
            function collectTextBySelector(selector) {
              const parts = String(selector || '').split(',').map(s => s.trim()).filter(Boolean);
              const seen = new Set();
              const out = [];
              function collectInRoot(root, sel) {
                try {
                  const nodes = root.querySelectorAll(sel);
                  for (const n of nodes) {
                    if (!seen.has(n)) { seen.add(n); out.push(n); }
                  }
                } catch {}
                const all = root.querySelectorAll('*');
                for (const el of all) {
                  if (el.shadowRoot) collectInRoot(el.shadowRoot, sel);
                }
              }
              for (const p of parts) collectInRoot(document, p);
              const texts = out.map(n => (n.innerText ?? n.textContent ?? '').trim()).filter(Boolean);
              const text = texts.join('\n\n').replace(/\u00A0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
              return { ok: !!text, text, count: texts.length };
            }
            try { return collectTextBySelector(sel); }
            catch (e) { return { ok: false, error: String(e && (e.message || e)) }; }
          },
          args: [selector]
        });
        const texts = [];
        let last = null;
        for (const inj of injResults || []) {
          const r = inj?.result; if (r) last = r;
          if (r?.ok && r.text) texts.push(r.text);
        }
        if (texts.length) return { ok: true, text: texts.join('\n\n') };
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
  // В overlay (контент-скрипт) chrome.scripting недоступен — делаем через SW
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'EXTRACT_FROM_PAGE', selector, waitMs, pollMs });
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

  btn.hidden = false;
  btn.classList.remove("hidden");
  btn.dataset.selector = match.selector || "";
  btn.onclick = async () => {
    try {
      const ready = await ensureContentScript(tab.id);
      if (!ready) { alert("Cannot access page. Content script isn't available."); return; }

      const selector = btn.dataset.selector || match.selector || "";
      if (!selector) { alert("Selector is empty for this site rule."); return; }

      setProgress?.("Grabbing description…");

      const resp = await extractFromPage(tab.id, selector, { waitMs: DEFAULT_EXTRACT_WAIT, pollMs: DEFAULT_EXTRACT_POLL });

      if (!resp?.ok) {
        const msg = /port closed|context invalidated/i.test(resp?.error || "")
          ? "Page changed before we could read it. Try again."
          : (resp?.error || "Nothing found by selector on this page.");
        setProgress?.("");
        alert("Extraction failed: " + msg);
        return;
      }

      const text = String(resp.text || "").trim();
      if (!text) {
        setProgress?.("");
        alert("Nothing found by selector on this page.");
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
