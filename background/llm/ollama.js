// background/llm/ollama.js

export async function callOllama({ baseUrl, model, sys, user, timeoutMs = 120_000 }) {
  const root = baseUrl.replace(/\/$/, '');
  const chatUrl = `${root}/api/chat`;
  const genUrl  = `${root}/api/generate`;

  const messages = [];
  if (sys) messages.push({ role: 'system', content: sys });
  messages.push({ role: 'user', content: user });

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), Math.max(10_000, Number(timeoutMs) || 120_000));

  async function doFetch(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
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
          `• OLLAMA_ORIGINS включает chrome-extension://<твой_ID>\n` +
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
    if (msg.includes('AbortError') || msg.includes('aborted')) {
      throw new Error(`Request timed out after ${Math.round((Number(timeoutMs)||120000)/1000)}s. Увеличьте timeoutMs в провайдере Ollama или сократите запрос.`);
    }
    throw e;
  } finally {
    clearTimeout(to);
  }
}
