// background/llm/gemini.js

export async function callGemini({ baseUrl, apiKey, model, sys, user }) {
  const url = `${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const parts = [];
  if (sys) parts.push({ text: sys + '\n\n' });
  parts.push({ text: user });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] })
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
