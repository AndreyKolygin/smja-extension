// shared/prompt.js — prompt builder shared between UI and background

export function buildPrompt({ cv, systemTemplate, outputTemplate, modelSystemPrompt, text }) {
  const globalPromptRaw = (systemTemplate || '').trim();
  const modelPromptRaw = (modelSystemPrompt || '').trim();
  const outputTemplateTrimmed = (outputTemplate || '').trim();

  const globalPlaceholder = /((?:не|not)\s+[^{}]*?)?{{\s*GLOBAL_SYSTEM_PROMPT\s*}}/gi;
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

  const replaceGlobalPlaceholders = (input) => {
    if (!input) return input;
    return input.replace(globalPlaceholder, (_, neg) => {
      if (neg) return neg.replace(/\s+$/, '');
      if (globalPromptRaw) {
        return globalPromptRaw;
      }
      return '';
    });
  };

  let sys = '';

  if (modelPromptRaw) {
    let prompt = modelPromptRaw;
    prompt = replaceGlobalPlaceholders(prompt);
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
