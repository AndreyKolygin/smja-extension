// background/llm/azure.js

export async function callAzureOpenAI({ baseUrl, apiKey, deployment, sys, user, timeoutMs = 120_000, apiVersion }) {
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

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), Math.max(10_000, Number(timeoutMs) || 120_000));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Azure OpenAI HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    const msg = String(e && (e.message || e));
    if (msg.includes('AbortError') || msg.includes('aborted')) {
      throw new Error(`Azure OpenAI request timed out after ${Math.round((Number(timeoutMs)||120000)/1000)}s.`);
    }
    throw e;
  } finally {
    clearTimeout(to);
  }
}
