// background/llm/ollama.js
import { fetchWithTimeout } from '../utils.js';

const EXTENSION_ORIGIN = (() => {
  try {
    if (typeof chrome !== 'undefined' && chrome?.runtime?.id) {
      return `chrome-extension://${chrome.runtime.id}`;
    }
  } catch {
    // ignore — fall back to placeholder below
  }
  return 'chrome-extension://<твой_ID>';
})();

export async function callOllama({ baseUrl, model, sys, user, timeoutMs = 120_000 }) {
  const root = baseUrl.replace(/\/$/, '');
  const chatUrl = `${root}/api/chat`;
  const genUrl  = `${root}/api/generate`;

  const messages = [];
  if (sys) messages.push({ role: 'system', content: sys });
  messages.push({ role: 'user', content: user });

  const timeout = Math.max(10_000, Number(timeoutMs) || 120_000);

  async function doFetch(url, body) {
    return fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout
    });
  }

  try {
    let res = await doFetch(chatUrl, { model, messages, stream: false });

    if (res.status === 404 || res.status === 405) {
      const prompt = (sys ? sys + '\n\n' : '') + user;
      res = await doFetch(genUrl, { model, prompt, stream: false });
    }

    if (!res.ok) {
      if (res.status === 403) {
        throw new Error(
          `Ollama HTTP 403 (CORS). Проверь:\n` +
          `• OLLAMA_ORIGINS включает ${EXTENSION_ORIGIN}\n` +
          `• что именно этот процесс ollama serve запущен с этими переменными\n` +
          `• baseUrl в настройках: ${root}`
        );
      }
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = await res.json().catch(() => ({}));
    return json?.message?.content ?? json?.response ?? '';
  } catch (e) {
    const msg = String(e && (e.message || e));
    if (/AbortError/i.test(msg) || /timed out/i.test(msg)) {
      throw new Error(`Request timed out after ${Math.round(timeout / 1000)}s. Увеличьте timeoutMs в провайдере Ollama или сократите запрос.`);
    }
    throw e;
  }
}
