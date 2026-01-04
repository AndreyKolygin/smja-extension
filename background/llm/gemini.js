// background/llm/gemini.js
import { fetchWithTimeout } from '../utils.js';

export async function callGemini({ baseUrl, apiKey, model, sys, user, timeoutMs = 120_000, sampling }) {
  const url = `${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const parts = [];
  if (sys) parts.push({ text: sys + '\n\n' });
  parts.push({ text: user });
  const generationConfig = {};
  if (sampling && typeof sampling === 'object') {
    const temp = Number(sampling.temperature);
    const topP = Number(sampling.topP);
    const topK = Number(sampling.topK);
    const maxTokens = Number(sampling.maxTokens);
    if (Number.isFinite(temp)) generationConfig.temperature = temp;
    if (Number.isFinite(topP)) generationConfig.topP = topP;
    if (Number.isFinite(topK)) generationConfig.topK = Math.round(topK);
    if (Number.isFinite(maxTokens) && maxTokens > 0) generationConfig.maxOutputTokens = Math.round(maxTokens);
  }
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], ...(Object.keys(generationConfig).length ? { generationConfig } : {}) }),
    timeout: Math.max(10_000, Number(timeoutMs) || 120_000)
  });
  if (!res.ok) {
    const code = res.status;
    let hint = '';
    if (code === 404) {
      hint = ' (Check baseUrl is https://generativelanguage.googleapis.com/v1beta and modelId exists)';
    }
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${code}${hint}: ${bodyText.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
}
