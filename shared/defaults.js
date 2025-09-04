// shared/defaults.js — single source of default settings

// Default providers (stable ids)
const DEFAULT_PROVIDERS = [
  {
    id: 'prov_ollama',
    name: 'Ollama Local',
    type: 'ollama',
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    timeoutMs: 120000
  },
  {
    id: 'prov_gemini',
    name: 'Google Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    timeoutMs: 120000
  },
  {
    id: 'prov_openai',
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    timeoutMs: 120000
  }
];

// Default models (order matters for initial selection)
const DEFAULT_MODELS = [
  {
    id: 'model_ollama_llama3',
    providerId: 'prov_ollama',
    displayName: 'Llama 3 (Ollama)',
    modelId: 'llama3',
    active: true,
    systemPrompt: ''
  },
  {
    id: 'model_gemini_25_flash',
    providerId: 'prov_gemini',
    displayName: 'Gemini 2.5 Flash lite',
    modelId: 'gemini-2.5-flash-lite',
    active: true,
    systemPrompt: ''
  },
  {
    id: 'model_openai_gpt4omini',
    providerId: 'prov_openai',
    displayName: 'GPT-4o mini',
    modelId: 'gpt-4o-mini',
    active: false,
    systemPrompt: ''
  }
];

// Default site rules (enabled by default)
const DEFAULT_SITES = [
  {
    id: 'site_linkedin',
    host: 'linkedin.com/jobs/*',
    selector: 'div.display-flex.align-items-center.flex-1, h1.t-24.t-bold.inline, span.tvm__text.tvm__text--low-emphasis, div.feed-shared-inline-show-more-text',
    comment: 'LinkedIn job description',
    active: true
  },
  {
    id: 'site_hh',
    host: 'https://hh.ru/vacancy?',
    selector: 'div.magritte-card___bhGKz_8-0-6.magritte-card-style-primary___eZ6aX_8-0-6.magritte-card-shadow-level-0___RNbQK_8-0-6.magritte-card-stretched___0Uc0J_8-0-6, div.vacancy-description',
    comment: 'HeadHunter (hh.ru) vacancy description',
    active: true
  },
  {
    id: 'site_indeed',
    // use regex to match any TLD: indeed.com/.co.uk/etc
    host: '/https?:\\/\\/[^\\/]*indeed\\.[^\\/]+\//i',
    selector: '#jobDescriptionText, .jobsearch-jobDescriptionText',
    comment: 'Indeed job description',
    active: true
  }
];

// Default prompt templates
const DEFAULT_SYSTEM_TEMPLATE = [
  'You evaluate how well a CV matches a job description.',
  'Provide a structured, concise analysis with:',
  '- strengths (why this CV fits),',
  '- gaps/risks (what is missing),',
  '- missing skills (specific, prioritized),',
  '- actionable suggestions (short, concrete).',
  'Write clearly and avoid fluff.'
].join('\n');

const DEFAULT_OUTPUT_TEMPLATE = [
  '# Summary',
  '- Match (1–10):',
  '',
  '## Strengths',
  '- ...',
  '',
  '## Gaps',
  '- ...',
  '',
  '## Missing Skills',
  '- ...',
  '',
  '## Action Items',
  '- ...',
  '',
  '## Questions to Clarify',
  '- ...'
].join('\n');

export function getDefaultSettings() {
  return {
    version: undefined,
    general: { helpUrl: 'https://github.com/AndreyKolygin/smja-extension' },
    providers: DEFAULT_PROVIDERS.map(p => ({ ...p })),
    models: DEFAULT_MODELS.map(m => ({ ...m })),
    sites: DEFAULT_SITES.map(s => ({ ...s })),
    cv: '',
    systemTemplate: DEFAULT_SYSTEM_TEMPLATE,
    outputTemplate: DEFAULT_OUTPUT_TEMPLATE
  };
}

export const DEFAULTS = {
  PROVIDERS: DEFAULT_PROVIDERS,
  MODELS: DEFAULT_MODELS,
  SITES: DEFAULT_SITES,
  SYSTEM_TEMPLATE: DEFAULT_SYSTEM_TEMPLATE,
  OUTPUT_TEMPLATE: DEFAULT_OUTPUT_TEMPLATE
};

