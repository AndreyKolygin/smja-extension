// background/llm/openai.js
import { fetchWithTimeout } from '../utils.js';

export async function callOpenAI({ baseUrl, apiKey, model, sys, user, orgId, projectId, timeoutMs = 120_000, sampling, allowOpenRouterParams = false }) {
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
    if (allowOpenRouterParams) {
      const topK = Number(sampling.topK);
      const repetitionPenalty = Number(sampling.repetitionPenalty);
      const minP = Number(sampling.minP);
      const topA = Number(sampling.topA);
      if (Number.isFinite(topK)) body.top_k = Math.round(topK);
      if (Number.isFinite(repetitionPenalty)) body.repetition_penalty = repetitionPenalty;
      if (Number.isFinite(minP)) body.min_p = minP;
      if (Number.isFinite(topA)) body.top_a = topA;
    }
  }

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
