// sw.js — MV3 service worker (no DOM)
const SETTINGS_KEY = "jdaSettings";

async function nowMs() { return Date.now(); }

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get("settings", (res) => {
      let s = res.settings;
      if (!s) {
        s = {
          version: "0.0.2",
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
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
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
        const result = await callLLMRouter(payload);
        // внутри CALL_LLM перед sendResponse(result)
          if (result && result.ok) {
            chrome.storage.local.set({ lastResult: {
              text: result.text, ms: result.ms || 0, when: Date.now(),
              providerId: payload.providerId || null, modelId: payload.modelId || null
            }});
          } else if (result && result.error) {
            chrome.storage.local.set({ lastError: { error: result.error, when: Date.now() }});
          }
        sendResponse(result); // {ok, text, ms}
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return;
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
  })();
  return true; // keep port open for async responses
});

chrome.runtime.onInstalled.addListener(() => {});
chrome.runtime.onStartup?.addListener(() => {});