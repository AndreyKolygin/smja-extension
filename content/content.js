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
  let pollTid = 0;

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

  // Безопасно читаем storage.local, останавливаемся при инвалидировании контекста
  async function safeReadDebugFlag() {
    if (!safeHasChrome() || !chrome.storage || !chrome.storage.local || !chrome.storage.local.get) return false;
    try {
      const res = await new Promise((resolve, reject) => {
        try {
          chrome.storage.local.get(["debugBadge"], (r) => {
            const err = chrome.runtime?.lastError;
            if (err) reject(err);
            else resolve(r || {});
          });
        } catch (e) {
          reject(e);
        }
      });
      return res && res.debugBadge === true;
    } catch (e) {
      // If the extension context is invalid, stop polling permanently in this page
      if (isCtxInvalidError(e)) stopPolling();
      return false;
    }
  }

  function stopPolling() {
    if (pollTid) {
      clearInterval(pollTid);
      pollTid = 0;
    }
  }

  async function initialBadgeCheck() {
    const on = await safeReadDebugFlag();
    const exists = !!document.getElementById(BADGE_ID);
    if (on && !exists) createBadge();
    if (!on && exists) removeBadge();
  }

  // ✅ Стартуем только если расширение доступно
  if (safeHasChrome()) {
    (async () => {
      try { await initialBadgeCheck(); } catch (e) { if (isCtxInvalidError(e)) stopPolling(); }
      try {
        pollTid = setInterval(async () => {
          if (!safeHasChrome()) { // контекст расширения исчез
            stopPolling();
            return;
          }
          try { await initialBadgeCheck(); } catch (e) { if (isCtxInvalidError(e)) { stopPolling(); } }
        }, 5000);
      } catch (e) {
        if (isCtxInvalidError(e)) stopPolling();
      }
    })();
  }

  // Чистим при навигации/скрытии вкладки (SPA)
  function teardown() { stopPolling(); removeBadge(); }
  window.addEventListener("pagehide", teardown);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") teardown();
  });

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === "__PING__") { try { sendResponse({ ok: true }); } catch {} }
      // (EXTRACT_SELECTOR уже есть)
    });
  } catch {}
}

// === EXTRACT_SELECTOR (robust async, handles SPA delays) ===
if (safeHasChrome()) {
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
