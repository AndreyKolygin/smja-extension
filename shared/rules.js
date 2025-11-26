// shared/rules.js — normalize and evaluate auto-extraction rules

export function normalizeRuleForExec(ruleOrSelector) {
  if (!ruleOrSelector && ruleOrSelector !== '') return null;
  if (typeof ruleOrSelector === 'string') {
    const selector = ruleOrSelector.trim();
    if (!selector) return null;
    return {
      strategy: 'css',
      selector,
      chain: [],
      script: ''
    };
  }
  const raw = (ruleOrSelector && typeof ruleOrSelector === 'object') ? ruleOrSelector : {};
  const strategy = typeof raw.strategy === 'string' ? raw.strategy.toLowerCase() : 'css';
  const selector = typeof raw.selector === 'string' ? raw.selector.trim() : '';
  const template = typeof raw.template === 'string' ? raw.template.trim() : '';
  const templateToJob = raw.templateToJob === true;
  const templateToResult = raw.templateToResult === true;
  const chain = Array.isArray(raw.chain)
    ? raw.chain.map((step) => {
        const sel = typeof step?.selector === 'string' ? step.selector.trim() : '';
        if (!sel) return null;
        const text = typeof step?.text === 'string' ? step.text.trim() : '';
        let nth = null;
        if (Number.isFinite(step?.nth)) {
          nth = Math.max(0, Math.floor(step.nth));
        } else if (typeof step?.nth === 'string' && step.nth.trim()) {
          const parsed = Number(step.nth.trim());
          if (Number.isFinite(parsed) && parsed >= 0) {
            nth = Math.floor(parsed);
          }
        }
        return { selector: sel, text, nth };
      }).filter(Boolean)
    : [];
  const supported = ['css', 'chain', 'template'];
  return {
    strategy: supported.includes(strategy) ? strategy : 'css',
    selector,
    chain,
    template,
    chainSequential: raw.chainSequential === undefined ? false : !!raw.chainSequential,
    templateToJob,
    templateToResult
  };
}

export async function evaluateRuleInPage(rule) {
  try {
    const strategy = (rule?.strategy || 'css').toLowerCase();
    const templateSource = typeof rule?.template === 'string' ? rule.template.trim() : '';
    let templatePayloadCache = null;

    function getSelectionContent() {
      try {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return { text: '', html: '' };
        const text = sel.toString().trim();
        const range = sel.getRangeAt(0).cloneContents();
        const div = document.createElement('div');
        div.appendChild(range);
        return { text, html: div.innerHTML };
      } catch {
        return { text: '', html: '' };
      }
    }

    function collectMetaTags() {
      if (!document || !document.querySelectorAll) return [];
      return Array.from(document.querySelectorAll('meta'))
        .map(meta => {
          const name = meta.getAttribute('name');
          const property = meta.getAttribute('property');
          const itemprop = meta.getAttribute('itemprop');
          const content = meta.getAttribute('content') || meta.getAttribute('value') || '';
          return { name, property, itemprop, content };
        })
        .filter(entry => entry.content && (entry.name || entry.property || entry.itemprop));
    }

    function collectSchemaOrgData() {
      if (!document || !document.querySelectorAll) return [];
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      const result = [];
      scripts.forEach(script => {
        const raw = script.textContent || script.innerText;
        if (!raw) return;
        try {
          const data = JSON.parse(raw);
          if (data) result.push(data);
        } catch {
          // ignore invalid JSON
        }
      });
      return result;
    }

    function getMainImage() {
      const selectors = [
        'meta[property="og:image"]',
        'meta[name="og:image"]',
        'meta[name="twitter:image"]',
        'link[rel="image_src"]',
        'meta[itemprop="image"]'
      ];
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          const val = el?.getAttribute('content') || el?.getAttribute('href') || '';
          if (val) return val;
        } catch {}
      }
      return '';
    }

    function getFavicon() {
      const rels = ['icon', 'shortcut icon', 'apple-touch-icon'];
      for (const rel of rels) {
        try {
          const el = document.querySelector(`link[rel="${rel}"]`);
          const href = el?.getAttribute('href');
          if (href) return new URL(href, document.baseURI).href;
        } catch {}
      }
      return '';
    }

    function addSchemaOrgVariables(data, variables, prefix = '') {
      if (!data) return;
      if (Array.isArray(data)) {
        data.forEach((item, index) => {
          if (!item || typeof item !== 'object') return;
          if (item['@type']) {
            const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
            types.forEach(type => addSchemaOrgVariables(item, variables, `@${type}:`));
          } else {
            addSchemaOrgVariables(item, variables, `[${index}]:`);
          }
        });
        return;
      }
      if (typeof data === 'object') {
        const keyRoot = prefix ? prefix.replace(/:$/, '') : '';
        if (keyRoot) {
          variables[`schema:${keyRoot}`] = JSON.stringify(data);
        }
        Object.entries(data).forEach(([key, value]) => {
          if (value && typeof value === 'object') {
            addSchemaOrgVariables(value, variables, keyRoot ? `${keyRoot}.${key}:` : `${key}:`);
          } else {
            const normalized = keyRoot ? `${keyRoot}.${key}` : key;
            variables[`schema:${normalized}`] = String(value ?? '').trim();
          }
        });
      }
    }

    function buildTemplateVariables() {
      const map = {};
      const selection = getSelectionContent();
      const bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
      const base = {
        title: document.title || '',
        url: location.href || '',
        site: location.hostname || '',
        domain: (location.hostname || '').replace(/^www\./, ''),
        description: document.querySelector('meta[name="description"]')?.content || '',
        author: document.querySelector('meta[name="author"]')?.content || '',
        published: document.querySelector('meta[property="article:published_time"]')?.content || '',
        language: document.documentElement?.getAttribute('lang') || '',
        selection: selection.text || '',
        selectionHtml: selection.html || '',
        content: bodyText.trim(),
        contentHtml: document.documentElement?.outerHTML || '',
        date: new Date().toISOString(),
        time: new Date().toISOString(),
        words: bodyText ? bodyText.trim().split(/\s+/).length.toString() : '0',
        image: getMainImage(),
        favicon: getFavicon()
      };
      Object.entries(base).forEach(([key, value]) => {
        map[key] = String(value ?? '').trim();
      });

      const meta = collectMetaTags();
      meta.forEach(entry => {
        if (entry.name) map[`meta:name:${entry.name}`] = entry.content;
        if (entry.property) map[`meta:property:${entry.property}`] = entry.content;
        if (entry.itemprop) map[`meta:itemprop:${entry.itemprop}`] = entry.content;
      });

      const schema = collectSchemaOrgData();
      addSchemaOrgVariables(schema, map);

      return map;
    }

    function normalizeTemplateValue(value) {
      if (value == null) return '';
      try {
        return String(value).trim();
      } catch {
        return '';
      }
    }

    function applyTemplate(tmpl, variables) {
      if (!tmpl) return { text: '', entries: [] };
      const seen = [];
      const replaced = tmpl.replace(/{{\s*([^}]+)\s*}}/g, (match, rawKey) => {
        const key = String(rawKey || '').trim();
        if (!key) return '';
        if (!seen.includes(key)) seen.push(key);
        return variables[key] ?? '';
      });
      const cleaned = replaced
        .replace(/\u00A0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      const entries = seen
        .map((key) => ({ key, value: normalizeTemplateValue(variables[key]) }))
        .filter(entry => entry.value);
      return { text: cleaned, entries };
    }

    function getTemplatePayload() {
      if (!templateSource) return null;
      if (templatePayloadCache) return templatePayloadCache;
      const variables = buildTemplateVariables();
      templatePayloadCache = applyTemplate(templateSource, variables);
      return templatePayloadCache;
    }

    const IGNORE_SELECTORS = ['#jda-app-overlay', '#jda-highlighter-menu', '#__jda_debug_badge'];
    function isIgnoredNode(node) {
      const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!el) return false;
      for (const sel of IGNORE_SELECTORS) {
        try {
          if (el.closest(sel)) return true;
        } catch {
          // ignore selector errors
        }
      }
      return false;
    }

    function nodesToText(nodes) {
      const unique = [];
      const seen = new Set();
      for (const node of nodes || []) {
        if (!node || seen.has(node) || isIgnoredNode(node)) continue;
        seen.add(node);
        const text = (node.innerText ?? node.textContent ?? '').trim();
        if (text) unique.push(text);
      }
      const text = unique.join('\n\n')
        .replace(/\u00A0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return { text, count: unique.length };
    }

    function collectNodes(root, selector) {
      const parts = String(selector || '').split(',').map(s => s.trim()).filter(Boolean);
      const seen = new Set();
      const out = [];

      function pushNode(node) {
        if (node && !seen.has(node) && !isIgnoredNode(node)) {
          seen.add(node);
          out.push(node);
        }
      }

      function collect(rootNode, sel) {
        if (!rootNode || !sel) return;
        try {
          if (rootNode instanceof Element && rootNode.matches?.(sel) && !isIgnoredNode(rootNode)) {
            pushNode(rootNode);
          }
        } catch {}
        try {
          const list = rootNode.querySelectorAll ? rootNode.querySelectorAll(sel) : [];
          for (const node of list) pushNode(node);
        } catch {}
        const descendants = rootNode.querySelectorAll ? rootNode.querySelectorAll('*') : [];
        for (const el of descendants) {
          if (el.shadowRoot) {
            collect(el.shadowRoot, sel);
          }
        }
      }

      for (const part of parts) {
        collect(root, part);
      }
      return out;
    }

    if (strategy === 'css') {
      const selector = String(rule?.selector || '').trim();
      if (!selector) return { ok: false, error: 'no_selector' };
      const nodes = collectNodes(document, selector);
      const { text, count } = nodesToText(nodes);
      const result = { ok: !!text, text, count };
      const templatePayload = getTemplatePayload();
      if (templatePayload?.text) result.templateText = templatePayload.text;
      if (templatePayload?.entries?.length) result.templateEntries = templatePayload.entries;
      return result;
    }

    if (strategy === 'chain') {
      const chain = Array.isArray(rule?.chain) ? rule.chain : [];
      if (!chain.length) return { ok: false, error: 'empty_chain' };
      const sequential = rule?.chainSequential ? true : false;
      if (!sequential) {
        let current = [document];
        for (const step of chain) {
          const sel = String(step?.selector || '').trim();
          if (!sel) continue;
          const next = [];
          const seen = new Set();
          for (const scope of current) {
            const nodes = collectNodes(scope, sel);
            let filtered = nodes;
            const textFilter = String(step?.text || '').trim().toLowerCase();
            if (textFilter) {
              filtered = filtered.filter(node => {
                const raw = (node.innerText ?? node.textContent ?? '').toLowerCase();
                return raw.includes(textFilter);
              });
            }
            const nth = Number.isFinite(step?.nth) ? step.nth : null;
            if (nth != null) {
              filtered = filtered[nth] ? [filtered[nth]] : [];
            }
            for (const node of filtered) {
              if (node && !seen.has(node)) {
                seen.add(node);
                next.push(node);
              }
            }
          }
          current = next;
          if (!current.length) break;
        }
        const { text, count } = nodesToText(current);
        return { ok: !!text, text, count };
      }
      const captured = [];
      for (const step of chain) {
        const sel = String(step?.selector || '').trim();
        if (!sel) continue;
        let nodes = collectNodes(document, sel);
        const textFilter = String(step?.text || '').trim().toLowerCase();
        if (textFilter) {
          nodes = nodes.filter(node => {
            const raw = (node.innerText ?? node.textContent ?? '').toLowerCase();
            return raw.includes(textFilter);
          });
        }
        const nth = Number.isFinite(step?.nth) ? step.nth : null;
        if (nth != null) {
          nodes = nodes[nth] ? [nodes[nth]] : [];
        }
        const { text } = nodesToText(nodes);
        if (text) captured.push(text);
      }
      const combined = captured.join('\n\n').trim();
      const result = { ok: !!combined, text: combined, count: captured.length };
      const templatePayload = getTemplatePayload();
      if (templatePayload?.text) result.templateText = templatePayload.text;
      if (templatePayload?.entries?.length) result.templateEntries = templatePayload.entries;
      return result;
    }

    if (strategy === 'template') {
      if (!templateSource) return { ok: false, error: 'empty_template' };
      const templatePayload = getTemplatePayload() || { text: '', entries: [] };
      return {
        ok: !!templatePayload.text,
        text: templatePayload.text,
        count: templatePayload.text ? 1 : 0,
        templateText: templatePayload.text,
        templateEntries: templatePayload.entries
      };
    }

    return { ok: false, error: 'unknown_strategy' };
  } catch (err) {
    return { ok: false, error: String(err && (err.message || err)) };
  }
}

export function wildcardToRegExp(str, { anchor = true } = {}) {
  const esc = String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = esc.replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
  return new RegExp((anchor ? '^' : '') + body + (anchor ? '$' : ''), 'i');
}

export function siteMatches(url, pattern) {
  try {
    const full = String(url || '');
    const u = new URL(full);
    const host = (u.hostname || '').toLowerCase();
    let p = String(pattern || '').trim();
    if (!p) return false;

    if (p.startsWith('/') && p.lastIndexOf('/') > 0) {
      const last = p.lastIndexOf('/');
      const body = p.slice(1, last);
      const flags = p.slice(last + 1) || 'i';
      try { return new RegExp(body, flags).test(full); } catch { return false; }
    }

    if (p.includes('://')) {
      const rx = new RegExp(
        String(p)
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\\\*/g, '.*')
          .replace(/\\\?/g, '.'),
        'i'
      );
      return rx.test(full);
    }

    let hostPart = p;
    let pathPart = '';
    if (p.startsWith('/')) {
      hostPart = '';
      pathPart = p;
    } else if (p.includes('/')) {
      const i = p.indexOf('/');
      hostPart = p.slice(0, i);
      pathPart = p.slice(i);
    }

    hostPart = hostPart.toLowerCase();

    if (hostPart) {
      if (hostPart.startsWith('*.')) {
        const bare = hostPart.slice(2);
        if (!(host === bare || host.endsWith(`.${bare}`))) return false;
      } else if (!(host === hostPart || host.endsWith(`.${hostPart}`))) {
        return false;
      }
    }

    if (pathPart) {
      const rx = wildcardToRegExp(pathPart, { anchor: true });
      return rx.test(u.pathname || '/');
    }

    return true;
  } catch {
    return false;
  }
}

export function findMatchingRule(rules, url) {
  if (!Array.isArray(rules)) return null;
  for (const rule of rules) {
    if (!rule || rule.active === false) continue;
    const host = rule.host || rule.pattern || '';
    if (siteMatches(url, host)) return rule;
  }
  return null;
}
