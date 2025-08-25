// sw.js — MV3 service worker (no DOM)
const SETTINGS_KEY = "jdaSettings";

function sanitizeText(t, max = 24000) {
  if (typeof t !== "string") return "";
  if (t.length <= max) return t;
  return t.slice(0, max) + `\n\n[trimmed to ${max} chars]`;
}

function requireFields(obj, fields) {
  for (const f of fields) {
    const v = obj?.[f];
    if (typeof v !== "string" || !v.trim()) throw new Error(`Invalid payload: ${f} is required`);
  }
}

let __busy = false;
async function guardedCall(fn) {
  if (__busy) throw new Error("Busy: previous request in progress");
  __busy = true;
  try { return await fn(); } finally { __busy = false; }
}

function nowMs() { return Date.now(); }

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get("settings", (res) => {
      let s = res.settings;
      if (!s) {
        s = {
          version: "0.2.0",
          general: { helpUrl: "https://github.com/AndreyKolygin/smja-extension" },
          providers: [],
          models: [],
          cv: "",
          systemTemplate: "",
          outputTemplate: ""
        };
        chrome.storage.local.set({ settings: s }, () => resolve(s));
      } else {
        resolve(s);
      }
    });
  });
}

async function saveSettings(newSettings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ settings: newSettings }, () => resolve(true));
  });
}

function buildPrompt({ cv, systemTemplate, outputTemplate, modelSystemPrompt, text }) {
  const sys = [systemTemplate || "", modelSystemPrompt || ""].filter(Boolean).join("\n\n").trim();
  const user = [
    cv ? `CV:\n${cv}` : "",
    text ? `JOB DESCRIPTION:\n${text}` : "",
    outputTemplate ? `OUTPUT FORMAT:\n${outputTemplate}` : ""
  ].filter(Boolean).join("\n\n").trim();
  return { sys, user };
}

async function callOpenAI({ baseUrl, apiKey, model, sys, user }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = { model, messages: [] };
  if (sys) body.messages.push({ role: "system", content: sys });
  body.messages.push({ role: "user", content: user });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const json = await res.json();
  const txt = json.choices?.[0]?.message?.content ?? "";
  return txt;
}

async function callOllama({ baseUrl, model, sys, user }) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/generate`;
  const prompt = (sys ? sys + "\n\n" : "") + user;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false })
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const json = await res.json();
  return json.response ?? "";
}

async function callGemini({ baseUrl, apiKey, model, sys, user }) {
  const url = `${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const parts = [];
  if (sys) parts.push({ text: sys + "\n\n" });
  parts.push({ text: user });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] })
  });
  if (!res.ok) {
    const code = res.status;
    let hint = "";
    if (code === 404) {
      hint = " (Check baseUrl is https://generativelanguage.googleapis.com/v1beta and modelId exists)";
    }
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${code}${hint}: ${bodyText.slice(0, 200)}`);
  }
  const json = await res.json();
  const txt = json.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
  return txt;
}

async function callLLMRouter(payload) {
  const settings = await getSettings();
  const provider = settings.providers.find(p => p.id === payload.providerId);
  if (!provider) throw new Error('Provider not found');

  const { sys, user } = buildPrompt(payload);
  const t0 = nowMs();
  let text = "";

  switch (provider.type) {
    case 'openai':
      text = await callOpenAI({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: payload.modelId, sys, user });
      break;
    case 'ollama':
      text = await callOllama({ baseUrl: provider.baseUrl, model: payload.modelId, sys, user });
      break;
    case 'gemini':
      text = await callGemini({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: payload.modelId, sys, user });
      break;
    default:
      text = await callOpenAI({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: payload.modelId, sys, user });
  }

  const ms = nowMs() - t0;
  return { ok: true, text, ms };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "GET_SETTINGS") {
      const s = await getSettings();
      sendResponse(s);
      return;
    }

    if (message.type === "SAVE_SETTINGS") {
      await saveSettings(message.payload);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CALL_LLM") {
      try {
        const payload = message.payload || {};
        requireFields(payload, ["modelId", "providerId"]);
        payload.text = sanitizeText(payload.text || "");
        const result = await guardedCall(() => callLLMRouter(payload));

        // кэширование lastResult / lastError оставляем
        try {
          if (result?.ok) {
            chrome.storage.local.set({
              lastResult: {
                text: result.text, ms: result.ms || 0, when: Date.now(),
                providerId: payload.providerId || null, modelId: payload.modelId || null
              }
            });
          } else if (result?.error) {
            chrome.storage.local.set({ lastError: { error: result.error, when: Date.now() } });
          }
        } catch {}

        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return true;
    }

    if (message.type === "START_ANALYZE") {
      // Optional legacy path: expect providerId/modelId in payload; otherwise reject
      try {
        const p = message.payload || {};
        if (!p.providerId || !p.modelId || !p.text) {
          sendResponse({ ok: false, error: "Missing providerId/modelId/text. Use popup to choose a model." });
          return;
        }
        const result = await callLLMRouter({
          providerId: p.providerId,
          modelId: p.modelId,
          cv: p.cv || "",
          systemTemplate: p.systemTemplate || "",
          outputTemplate: p.outputTemplate || "",
          modelSystemPrompt: p.modelSystemPrompt || "",
          text: p.text
        });
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return;
    }

    if (message.type === "OPEN_POPUP") {
      try {
        chrome.action.openPopup(() => {
          const err = chrome.runtime.lastError;
          sendResponse({
            ok: !err,
            error: err ? String(err.message || err) : undefined
          });
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
      return true; // важно оставить, чтобы канал ответа не закрылся раньше времени
    }
  })();
  return true; // keep port open for async responses
});

chrome.runtime.onInstalled.addListener(() => {});
chrome.runtime.onStartup?.addListener(() => {});