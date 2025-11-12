// shared/defaults.js — single source of default settings

import { ensureCvList } from './cv.js';

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
    strategy: 'css',
    selector: 'div.display-flex.align-items-center.flex-1, h1.t-24.t-bold.inline, span.tvm__text.tvm__text--low-emphasis, div.feed-shared-inline-show-more-text',
    comment: 'LinkedIn job description',
    active: true
  },
  {
    id: 'site_hh',
    host: 'https://hh.ru/vacancy?',
    strategy: 'css',
    selector: 'div.magritte-card___bhGKz_8-0-6.magritte-card-style-primary___eZ6aX_8-0-6.magritte-card-shadow-level-0___RNbQK_8-0-6.magritte-card-stretched___0Uc0J_8-0-6, div.vacancy-description',
    comment: 'HeadHunter (hh.ru) vacancy description',
    active: true
  },
  {
    id: 'site_indeed',
    // use regex to match any TLD: indeed.com/.co.uk/etc
    host: '/https?:\\/\\/[^\\/]*indeed\\.[^\\/]+\//i',
    strategy: 'css',
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

const DEFAULT_NOTION_FIELDS = [
  {
    id: 'notion_field_title',
    label: 'Title (analysis summary)',
    propertyName: '',
    propertyType: 'title',
    source: 'analysis',
    staticValue: ''
  },
  {
    id: 'notion_field_job',
    label: 'Job description',
    propertyName: '',
    propertyType: 'rich_text',
    source: 'jobDescription',
    staticValue: ''
  }
];

const DEFAULT_CVS = ensureCvList([
  {
    id: 'cv_default',
    title: 'CV 1',
    content: '',
    updatedAt: 0,
    isDefault: true
  }
]);

const DEFAULT_ACTIVE_CV_ID = DEFAULT_CVS[0]?.id || 'cv_default';

const DEFAULT_NOTION = {
  enabled: false,
  token: '',
  databaseId: '',
  fields: DEFAULT_NOTION_FIELDS
};

export function getDefaultSettings() {
  return {
    version: undefined,
    general: { helpUrl: 'https://github.com/AndreyKolygin/smja-extension' },
    providers: DEFAULT_PROVIDERS.map(p => ({ ...p })),
    models: DEFAULT_MODELS.map(m => ({ ...m })),
    sites: DEFAULT_SITES.map(s => ({ ...s })),
    cvs: DEFAULT_CVS.map(cv => ({ ...cv })),
    activeCvId: DEFAULT_ACTIVE_CV_ID,
    systemTemplate: DEFAULT_SYSTEM_TEMPLATE,
    outputTemplate: DEFAULT_OUTPUT_TEMPLATE,
    integrations: {
      notion: {
        enabled: DEFAULT_NOTION.enabled,
        token: '',
        databaseId: '',
        fields: DEFAULT_NOTION.fields.map(f => ({ ...f }))
      }
    }
  };
}

export const DEFAULTS = {
  PROVIDERS: DEFAULT_PROVIDERS,
  MODELS: DEFAULT_MODELS,
  SITES: DEFAULT_SITES,
  CVS: DEFAULT_CVS,
  ACTIVE_CV_ID: DEFAULT_ACTIVE_CV_ID,
  SYSTEM_TEMPLATE: DEFAULT_SYSTEM_TEMPLATE,
  OUTPUT_TEMPLATE: DEFAULT_OUTPUT_TEMPLATE,
  NOTION: DEFAULT_NOTION
};
