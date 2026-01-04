// background/llm/azure.js
import { fetchWithTimeout } from '../utils.js';

export async function callAzureOpenAI({ baseUrl, apiKey, deployment, sys, user, timeoutMs = 120_000, apiVersion, sampling }) {
  const raw = String(baseUrl || '').trim();
  if (!raw) throw new Error('Azure OpenAI baseUrl is required');
  if (!apiKey) throw new Error('Azure OpenAI API key is required');
  if (!deployment) throw new Error('Azure OpenAI deployment name (modelId) is required');
  let root = raw.replace(/\/+$/, '');

  let dep = String(deployment || '').trim();
  const query = new URLSearchParams();
  if (dep.includes('?')) {
    const idx = dep.indexOf('?');
    const tail = dep.slice(idx + 1);
    dep = dep.slice(0, idx);
    if (tail) {
      const params = new URLSearchParams(tail);
      for (const [k, v] of params.entries()) {
        if (k.toLowerCase() === 'api-version' && !apiVersion) {
          apiVersion = v;
        } else {
          query.append(k, v);
        }
      }
    }
  }

  if (!dep) throw new Error('Azure OpenAI deployment name (modelId) is required');

  const version = apiVersion || '2024-02-01';
  query.set('api-version', version);

  if (/\/openai\/deployments(?:\/[^/?]+)?$/i.test(root)) {
    root = root.replace(/\/deployments(?:\/[^/?]+)?$/i, '');
  } else if (!/\/openai$/i.test(root)) {
    root = `${root}/openai`;
  }

  const url = `${root}/deployments/${encodeURIComponent(dep)}/chat/completions?${query.toString()}`;

  const body = { messages: [] };
  if (sys) body.messages.push({ role: 'system', content: sys });
  body.messages.push({ role: 'user', content: user });
  if (sampling && typeof sampling === 'object') {
    const temp = Number(sampling.temperature);
    const topP = Number(sampling.topP);
    const maxTokens = Number(sampling.maxTokens);
    const frequencyPenalty = Number(sampling.frequencyPenalty);
    const presencePenalty = Number(sampling.presencePenalty);
    if (Number.isFinite(temp)) body.temperature = temp;
    if (Number.isFinite(topP)) body.top_p = topP;
    if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = Math.round(maxTokens);
    if (Number.isFinite(frequencyPenalty)) body.frequency_penalty = frequencyPenalty;
    if (Number.isFinite(presencePenalty)) body.presence_penalty = presencePenalty;
  }

  const timeout = Math.max(10_000, Number(timeoutMs) || 120_000);
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(body),
      timeout
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Azure OpenAI HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    const msg = String(e && (e.message || e));
    if (/AbortError/i.test(msg) || /timed out/i.test(msg)) {
      throw new Error(`Azure OpenAI request timed out after ${Math.round(timeout / 1000)}s.`);
    }
    throw e;
  }
}
