try { console.debug("[JDA] content loaded:", location.href); } catch {}

(() => {
  if (window.__JDA_CONTENT_INSTALLED__) return;
  window.__JDA_CONTENT_INSTALLED__ = true;

// Обернём ВСЁ тело контент-скрипта в try/catch: если контекст инвалидирован СИНХРОННО — выходим тихо
  function isCtxInvalidError(err) {
    const msg = String((err && (err.message || err)) || "");
    return msg.includes("Extension context invalidated");
  }
  try {
    // Глобальные ловушки (на случай, если ошибка прилетит позже)
    window.addEventListener("error", (e) => {
      if (isCtxInvalidError(e?.error || e?.message)) {
        e.preventDefault();
        return false;
      }
    });
    window.addEventListener("unhandledrejection", (e) => {
      const r = e && (e.reason || e.detail);
      if (isCtxInvalidError(r)) {
        e.preventDefault();
        return false;
      }
    });

  const BADGE_ID = "__jda_debug_badge";
  function createBadge() {
    const host = document.createElement("div");
    host.id = BADGE_ID;
    host.style.position = "fixed";
    host.style.top = "10px";
    host.style.right = "10px";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";

    // Shadow DOM чтобы не конфликтовать со стилями страницы
    const shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : null;
    const style = document.createElement("style");
    style.textContent = `
      .wrap {
        pointer-events: auto;
        padding: 6px 10px;
        background: #111;
        color: #fff;
        font-size: 12px;
        border-radius: 6px;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, Noto Sans, "Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol";
        box-shadow: 0 6px 20px rgba(0,0,0,.25);
        opacity: .9;
      }
    `;
    const el = document.createElement("div");
    el.className = "wrap";
    el.textContent = "✓ Extension Active";

    if (shadow) {
      shadow.appendChild(style);
      shadow.appendChild(el);
    } else {
      // fallback без Shadow DOM
      host.appendChild(style);
      host.appendChild(el);
    }
    if (document.documentElement) document.documentElement.appendChild(host);
    return host;
  }

  function removeBadge() {
    const n = document.getElementById(BADGE_ID);
    if (n && n.parentNode) n.parentNode.removeChild(n);
  }

  function safeHasChrome() {
    try {
      // Accessing chrome.runtime.id can itself throw when context is gone
      return typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
    } catch {
      return false;
    }
  }

  function initDebugBadge() {
    if (!safeHasChrome() || !chrome.storage?.local?.get) return;
    chrome.storage.local.get({ debugBadge: false }, (res) => {
      if (res?.debugBadge) createBadge();
    });
    if (chrome.storage?.onChanged?.addListener) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !Object.prototype.hasOwnProperty.call(changes, 'debugBadge')) return;
        const next = !!changes.debugBadge.newValue;
        if (next) createBadge();
        else removeBadge();
      });
    }
  }

  if (safeHasChrome()) {
    initDebugBadge();
  }

  window.addEventListener("pagehide", removeBadge);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") removeBadge();
  });

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === "__PING__") { try { sendResponse({ ok: true }); } catch {} }
      // (EXTRACT_SELECTOR уже есть)
    });
  } catch {}
}

  function collectMetaTags() {
    if (!document || !document.querySelectorAll) return [];
    return Array.from(document.querySelectorAll('meta'))
      .map(meta => {
        const name = meta.getAttribute('name');
        const property = meta.getAttribute('property');
        const itemprop = meta.getAttribute('itemprop');
        const content = meta.getAttribute('content') || meta.getAttribute('value') || '';
        return { name, property, itemprop, content };
      })
      .filter(entry => entry.content && (entry.name || entry.property || entry.itemprop));
  }

  function collectSchemaOrgData() {
    if (!document || !document.querySelectorAll) return [];
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const result = [];
    scripts.forEach(script => {
      const raw = script.textContent || script.innerText;
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        if (data) result.push(data);
      } catch {
        // ignore invalid JSON
      }
    });
    return result;
  }

  function getMainImage() {
    const selectors = [
      'meta[property="og:image"]',
      'meta[name="og:image"]',
      'meta[name="twitter:image"]',
      'link[rel="image_src"]',
      'meta[itemprop="image"]'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        const val = el?.getAttribute('content') || el?.getAttribute('href') || '';
        if (val) return val;
      } catch {}
    }
    return '';
  }

  function getFavicon() {
    const rels = ['icon', 'shortcut icon', 'apple-touch-icon'];
    for (const rel of rels) {
      try {
        const el = document.querySelector(`link[rel="${rel}"]`);
        const href = el?.getAttribute('href');
        if (href) return new URL(href, document.baseURI).href;
      } catch {}
    }
    return '';
  }

  function collectSelection() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return { text: '', html: '' };
      const text = sel.toString().trim();
      const range = sel.getRangeAt(0).cloneContents();
      const div = document.createElement('div');
      div.appendChild(range);
      const html = div.innerHTML;
      return { text, html };
    } catch {
      return { text: '', html: '' };
    }
  }

  function collectBaseVariables() {
    const title = document.title || '';
    const url = location.href || '';
    const site = location.hostname || '';
    const description = document.querySelector('meta[name="description"]')?.content || '';
    const author = document.querySelector('meta[name="author"]')?.content || '';
    const published = document.querySelector('meta[property="article:published_time"]')?.content || '';
    const language = document.documentElement?.getAttribute('lang') || '';
    const selection = collectSelection();
    const bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
    const wordCount = bodyText ? bodyText.trim().split(/\s+/).length : 0;
    return {
      title,
      url,
      site,
      domain: site.replace(/^www\./, ''),
      description,
      author,
      published,
      language,
      content: bodyText.trim(),
      contentHtml: document.documentElement?.outerHTML || '',
      selection: selection.text,
      selectionHtml: selection.html,
      date: new Date().toISOString(),
      time: new Date().toISOString(),
      words: wordCount.toString(),
      image: getMainImage(),
      favicon: getFavicon()
    };
  }

  function collectPageVariables() {
    return {
      base: collectBaseVariables(),
      meta: collectMetaTags(),
      schema: collectSchemaOrgData()
    };
  }

// === EXTRACT_SELECTOR (robust async, handles SPA delays) ===
if (safeHasChrome()) {
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === "COLLECT_PAGE_VARIABLES") {
        try {
          const variables = collectPageVariables();
          sendResponse({ ok: true, variables });
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
        return true;
      }
      if (msg?.type !== "EXTRACT_SELECTOR") return;

      try {
        const sel = String(msg.selector || "").trim();
        if (!sel) { sendResponse({ ok:false, error:"No selector" }); return; }

        // Optional tuning from caller: msg.waitMs (default 2000), msg.pollMs (default 150)
        const deadline = Date.now() + (Number(msg.waitMs) || 2000);
        const interval = Math.min(Math.max(Number(msg.pollMs) || 150, 50), 1000);

        const tryExtract = () => {
          try {
            const nodes = Array.from(document.querySelectorAll(sel));
            const text = nodes
              .map(n => (n.innerText || n.textContent || "").trim())
              .filter(Boolean)
              .join("\n\n")
              .trim();

            if (text || Date.now() > deadline) {
              // respond once: ok + text or graceful "Nothing found"
              sendResponse({ ok: !!text, text, error: text ? "" : "Nothing found by selector" });
            } else {
              setTimeout(tryExtract, interval);
            }
          } catch (e) {
            sendResponse({ ok:false, error: String(e?.message || e) });
          }
        };

        tryExtract();
        return true; // keep the port open for async sendResponse
      } catch (e) {
        try { sendResponse({ ok:false, error: String(e?.message || e) }); } catch {}
      }
    });
  } catch (e) {
    if (isCtxInvalidError(e)) { /* swallow */ }
  }
}

  try { console.debug("[JDA] content initialized"); } catch {}
  } catch (e) {
    // Синхронный фэйл всего скрипта (например, при мгновенной инвалидации контекста)
    if (isCtxInvalidError(e)) {
      // тихо выходим — это штатная ситуация при обновлении/перезапуске SW
      return;
    }
    // остальные ошибки всё же логируем для отладки страницы
    try { console.warn("[JDA content] init error:", e); } catch {}
  }
})();
