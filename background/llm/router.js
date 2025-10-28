// background/llm/router.js — маршрутизация запросов LLM

import { getSettings } from '../settings.js';
import { nowMs } from '../utils.js';
import { callOpenAI } from './openai.js';
import { callAzureOpenAI } from './azure.js';
import { callAnthropic } from './anthropic.js';
import { callOllama } from './ollama.js';
import { callGemini } from './gemini.js';

function buildPrompt({ cv, systemTemplate, outputTemplate, modelSystemPrompt, text }) {
  const globalPromptRaw = (systemTemplate || '').trim();
  const modelPromptRaw = (modelSystemPrompt || '').trim();
  const outputTemplateTrimmed = (outputTemplate || '').trim();

  const globalPlaceholder = /{{\s*GLOBAL_SYSTEM_PROMPT\s*}}/gi;
  const outputPlaceholder = /((?:не|not)\s+[^{}]*?)?{{\s*RESULT_OUTPUT_TEMPLATE\s*}}/gi;

  let includeOutputTemplate = !!outputTemplateTrimmed;

  const replaceOutputPlaceholders = (input) => {
    if (!input) return input;
    return input.replace(outputPlaceholder, (_, neg) => {
      includeOutputTemplate = false;
      if (neg) return neg.replace(/\s+$/, '');
      return outputTemplateTrimmed;
    });
  };

  let sys = '';

  if (modelPromptRaw) {
    let prompt = modelPromptRaw;
    if (globalPromptRaw) {
      prompt = prompt.replace(globalPlaceholder, globalPromptRaw);
    }
    prompt = replaceOutputPlaceholders(prompt);
    sys = prompt.trim();
  } else {
    let prompt = replaceOutputPlaceholders(globalPromptRaw);
    sys = prompt.trim();
  }

  const userParts = [];
  if (cv) userParts.push(`CV:\n${cv}`);
  if (text) userParts.push(`JOB DESCRIPTION:\n${text}`);
  if (includeOutputTemplate && outputTemplateTrimmed) {
    userParts.push(`OUTPUT FORMAT:\n${outputTemplateTrimmed}`);
  }

  const user = userParts.join('\n\n').trim();
  return { sys, user };
}

export async function callLLMRouter(payload) {
  const settings = await getSettings();
  const provider = settings.providers.find(p => p.id === payload.providerId);
  if (!provider) throw new Error('Provider not found');

  const { sys, user } = buildPrompt(payload);
  const t0 = nowMs();
  let text = '';

  switch (provider.type) {
    case 'openai':
      text = await callOpenAI({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: payload.modelId,
        sys,
        user,
        orgId: provider.orgId,
        projectId: provider.projectId,
        timeoutMs: provider.timeoutMs || 120_000
      });
      break;
    case 'azure':
      text = await callAzureOpenAI({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        deployment: payload.modelId,
        sys,
        user,
        timeoutMs: provider.timeoutMs || 120_000,
        apiVersion: provider.apiVersion || provider.azureApiVersion || payload.azureApiVersion
      });
      break;
    case 'anthropic':
      text = await callAnthropic({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: payload.modelId,
        sys,
        user,
        timeoutMs: provider.timeoutMs || 120_000,
        version: provider.apiVersion || provider.anthropicVersion,
        maxTokens: provider.maxTokens || payload.maxOutputTokens
      });
      break;
    case 'ollama':
      text = await callOllama({
        baseUrl: provider.baseUrl,
        model: payload.modelId,
        sys,
        user,
        timeoutMs: provider.timeoutMs || 120_000
      });
      break;
    case 'gemini':
      text = await callGemini({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: payload.modelId, sys, user });
      break;
    default:
      text = await callOpenAI({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: payload.modelId, sys, user });
  }

  const ms = nowMs() - t0;
  return { ok: true, text, ms };
}
