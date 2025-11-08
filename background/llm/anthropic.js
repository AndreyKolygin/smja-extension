// background/llm/anthropic.js
import { fetchWithTimeout } from '../utils.js';

export async function callAnthropic({ baseUrl, apiKey, model, sys, user, timeoutMs = 120_000, version, maxTokens }) {
  const raw = String(baseUrl || 'https://api.anthropic.com/v1').trim();
  if (!apiKey) throw new Error('Anthropic API key is required');
  if (!model) throw new Error('Anthropic modelId is required');
  let root = raw.replace(/\/+$/, '');
  if (!root) root = 'https://api.anthropic.com/v1';
  const url = `${root}/messages`;

  const body = {
    model,
    messages: [{ role: 'user', content: user }],
    max_tokens: Math.max(1, Number(maxTokens) || 1024)
  };
  if (sys) body.system = sys;

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': version || '2023-06-01'
  };

  const timeout = Math.max(10_000, Number(timeoutMs) || 120_000);
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      timeout
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    const json = await res.json();
    if (Array.isArray(json?.content)) {
      const joined = json.content.map(part => part?.text || '').filter(Boolean).join('\n').trim();
      if (joined) return joined;
    }
    return json?.completion ?? '';
  } catch (e) {
    const msg = String(e && (e.message || e));
    if (/AbortError/i.test(msg) || /timed out/i.test(msg)) {
      throw new Error(`Anthropic request timed out after ${Math.round(timeout / 1000)}s.`);
    }
    throw e;
  }
}
