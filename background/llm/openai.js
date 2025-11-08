// background/llm/openai.js
import { fetchWithTimeout } from '../utils.js';

export async function callOpenAI({ baseUrl, apiKey, model, sys, user, orgId, projectId, timeoutMs = 120_000 }) {
  const raw = String(baseUrl || '').trim();
  let root = raw.replace(/\/+$/, '');
  const fullEndpointMatch = /\/v1\/(?:chat\/completions|completions)$/i;
  if (fullEndpointMatch.test(root)) {
    root = root.replace(/\/v1\/(?:chat\/completions|completions)$/i, '/v1');
  } else if (/^https:\/\/api\.openai\.com$/i.test(root)) {
    root = root + '/v1';
  }
  const url = `${root}/chat/completions`;

  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
  if (orgId) headers['OpenAI-Organization'] = orgId;
  if (projectId) headers['OpenAI-Project'] = projectId;

  const body = { model, messages: [] };
  if (sys) body.messages.push({ role: 'system', content: sys });
  body.messages.push({ role: 'user', content: user });

  const timeout = Math.max(10_000, Number(timeoutMs) || 120_000);
  try {
    const res = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body), timeout });
    if (!res.ok) {
      const code = res.status;
      let hint = '';
      if (code === 401) {
        hint = " (Unauthorized). Check: API key, baseUrl should be https://api.openai.com/v1, org/project headers, and model access.";
      } else if (code === 404) {
        hint = ' (Not found). Model ID or baseUrl likely incorrect.';
      } else if (code === 429) {
        hint = ' (Rate limit). You may be out of quota.';
      }
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI HTTP ${code}${hint}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    const msg = String(e && (e.message || e));
    if (/AbortError/i.test(msg) || /timed out/i.test(msg)) {
      throw new Error(`OpenAI request timed out after ${Math.round(timeout / 1000)}s.`);
    }
    throw e;
  }
}
