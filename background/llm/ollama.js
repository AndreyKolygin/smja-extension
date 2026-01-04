// background/llm/ollama.js
import { fetchWithTimeout } from '../utils.js';
import { getLocaleString, getPreferredUILang } from '../../shared/locale-loader.js';

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

const FALLBACK_MESSAGES = {
  cors: {
    en: 'Ollama HTTP 403 (CORS) — the server rejected origin {{ORIGIN}}.',
    ru: 'Ollama HTTP 403 (CORS): сервер отклонил origin {{ORIGIN}}.'
  },
  network: {
    en: 'Failed to connect to Ollama at {{BASE_URL}}. The service may be stopped or {{ORIGIN}} is missing in OLLAMA_ORIGINS.',
    ru: 'Не удалось подключиться к Ollama по адресу {{BASE_URL}}. Вероятно, сервис остановлен или переменная OLLAMA_ORIGINS не содержит {{ORIGIN}}.'
  },
  guideTitle: {
    en: 'How to fix it',
    ru: 'Как исправить'
  },
  guide: {
    en: [
      '1) Open a terminal and run the commands (the extension ID is already inserted):',
      'macOS / Linux:',
      '  export OLLAMA_HOST=127.0.0.1:11434',
      `  export OLLAMA_ORIGINS={{ORIGIN}}`,
      '  ollama serve',
      'Windows PowerShell:',
      '  setx OLLAMA_HOST "127.0.0.1:11434"',
      '  setx OLLAMA_ORIGINS "{{ORIGIN}}"',
      '  ollama serve',
      '2) Keep this terminal running — Ollama stops when the window closes.',
      '3) If the terminal was closed/restarted, open a new one, repeat the commands, and leave it running.',
      '4) Allow Chrome to access http://localhost:11434/* (chrome://extensions → Job Description Analyzer → Details → Permissions).',
      'baseUrl in settings: {{BASE_URL}}'
    ].join('\n'),
    ru: [
      '1) Открой терминал и выполни команды (ID уже подставлен):',
      'macOS / Linux:',
      '  export OLLAMA_HOST=127.0.0.1:11434',
      `  export OLLAMA_ORIGINS={{ORIGIN}}`,
      '  ollama serve',
      'Windows PowerShell:',
      '  setx OLLAMA_HOST "127.0.0.1:11434"',
      '  setx OLLAMA_ORIGINS "{{ORIGIN}}"',
      '  ollama serve',
      '2) Не закрывай терминал — Ollama останавливается, как только окно закрывается.',
      '3) Если терминал закрыт/перезапущен, открой новый, повтори команды и оставь процесс запущенным.',
      '4) Разреши Chrome доступ к http://localhost:11434/* (chrome://extensions → Job Description Analyzer → «Подробнее» → «Разрешения»).',
      'baseUrl в настройках: {{BASE_URL}}'
    ].join('\n')
  }
};

function applyPlaceholders(template, replacements) {
  if (!template) return '';
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    result = result.replace(pattern, value);
  }
  return result;
}

async function buildOllamaErrorMessage(type, root) {
  const replacements = { ORIGIN: EXTENSION_ORIGIN, BASE_URL: root };
  const baseError = applyPlaceholders(FALLBACK_MESSAGES[type === 'cors' ? 'cors' : 'network'].en, replacements);
  const lang = await getPreferredUILang();

  const guideTitleTemplate = await getLocaleString(
    lang,
    'errors.ollama.fixTitle',
    FALLBACK_MESSAGES.guideTitle[lang] || FALLBACK_MESSAGES.guideTitle.en
  );
  const guideTemplate = await getLocaleString(
    lang,
    'errors.ollama.guide',
    FALLBACK_MESSAGES.guide[lang] || FALLBACK_MESSAGES.guide.en
  );

  const guideTitle = applyPlaceholders(guideTitleTemplate, replacements);
  const guide = applyPlaceholders(guideTemplate, replacements).replace(/\\n/g, '\n');

  return `${baseError}\n\n${guideTitle}\n${guide}`;
}

export async function callOllama({ baseUrl, model, sys, user, timeoutMs = 120_000, sampling }) {
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
    const options = {};
    if (sampling && typeof sampling === 'object') {
      const temp = Number(sampling.temperature);
      const topP = Number(sampling.topP);
      const topK = Number(sampling.topK);
      const repeatPenalty = Number(sampling.repetitionPenalty);
      const presencePenalty = Number(sampling.presencePenalty);
      const frequencyPenalty = Number(sampling.frequencyPenalty);
      const maxTokens = Number(sampling.maxTokens);
      if (Number.isFinite(temp)) options.temperature = temp;
      if (Number.isFinite(topP)) options.top_p = topP;
      if (Number.isFinite(topK)) options.top_k = Math.round(topK);
      if (Number.isFinite(repeatPenalty)) options.repeat_penalty = repeatPenalty;
      if (Number.isFinite(presencePenalty)) options.presence_penalty = presencePenalty;
      if (Number.isFinite(frequencyPenalty)) options.frequency_penalty = frequencyPenalty;
      if (Number.isFinite(maxTokens) && maxTokens > 0) options.num_predict = Math.round(maxTokens);
    }
    const baseBody = { model, messages, stream: false };
    if (Object.keys(options).length) baseBody.options = options;
    let res = await doFetch(chatUrl, baseBody);

    if (res.status === 404 || res.status === 405) {
      const prompt = (sys ? sys + '\n\n' : '') + user;
      const genBody = { model, prompt, stream: false };
      if (Object.keys(options).length) genBody.options = options;
      res = await doFetch(genUrl, genBody);
    }

    if (!res.ok) {
      if (res.status === 403) {
        const message = await buildOllamaErrorMessage('cors', root);
        throw new Error(message);
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
    if (/Failed to fetch/i.test(msg) || /NetworkError/i.test(msg)) {
      const message = await buildOllamaErrorMessage('network', root);
      throw new Error(message);
    }
    throw e;
  }
}
