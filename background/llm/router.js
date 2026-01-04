// background/llm/router.js — маршрутизация запросов LLM

import { getSettings } from '../settings.js';
import { nowMs } from '../utils.js';
import { buildPrompt } from '../../shared/prompt.js';
import { callOpenAI } from './openai.js';
import { callAzureOpenAI } from './azure.js';
import { callAnthropic } from './anthropic.js';
import { callOllama } from './ollama.js';
import { callGemini } from './gemini.js';

export async function callLLMRouter(payload) {
  const provider = await getProviderById(payload.providerId);
  if (!provider) throw new Error('Provider not found');

  const { sys, user } = buildPrompt(payload);
  const t0 = nowMs();
  let text = '';
  const sampling = {
    maxTokens: payload.maxTokens ?? null,
    temperature: payload.temperature ?? null,
    topP: payload.topP ?? null,
    topK: payload.topK ?? null,
    frequencyPenalty: payload.frequencyPenalty ?? null,
    presencePenalty: payload.presencePenalty ?? null,
    repetitionPenalty: payload.repetitionPenalty ?? null,
    minP: payload.minP ?? null,
    topA: payload.topA ?? null
  };

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
        timeoutMs: provider.timeoutMs || 120_000,
        sampling
      });
      break;
    case 'openrouter':
      text = await callOpenAI({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: payload.modelId,
        sys,
        user,
        orgId: provider.orgId,
        projectId: provider.projectId,
        timeoutMs: provider.timeoutMs || 120_000,
        sampling,
        allowOpenRouterParams: true
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
        apiVersion: provider.apiVersion || provider.azureApiVersion || payload.azureApiVersion,
        sampling
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
        maxTokens: sampling.maxTokens || provider.maxTokens || payload.maxOutputTokens
      });
      break;
    case 'ollama':
      text = await callOllama({
        baseUrl: provider.baseUrl,
        model: payload.modelId,
        sys,
        user,
        timeoutMs: provider.timeoutMs || 120_000,
        sampling
      });
      break;
    case 'gemini':
      text = await callGemini({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: payload.modelId,
        sys,
        user,
        timeoutMs: provider.timeoutMs || 120_000,
        sampling
      });
      break;
    default:
      text = await callOpenAI({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: payload.modelId, sys, user, sampling });
  }

  const ms = nowMs() - t0;
  return { ok: true, text, ms };
}

let providersCache = null;
let providersPromise = null;

async function getProviderById(providerId) {
  if (!providerId) return null;
  if (providersCache) {
    return providersCache.find(p => p.id === providerId) || null;
  }
  if (!providersPromise) {
    providersPromise = getSettings().then(settings => {
      providersCache = Array.isArray(settings?.providers) ? settings.providers : [];
      return providersCache;
    }).finally(() => {
      providersPromise = null;
    });
  }
  const providers = await providersPromise;
  return providers.find(p => p.id === providerId) || null;
}

export function invalidateLLMProviderCache() {
  providersCache = null;
}
