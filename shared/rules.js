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
  const script = typeof raw.script === 'string' ? raw.script.trim() : '';
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
  return {
    strategy: ['css', 'chain', 'script'].includes(strategy) ? strategy : 'css',
    selector,
    chain,
    script,
    chainSequential: raw.chainSequential === undefined ? false : !!raw.chainSequential
  };
}

export async function evaluateRuleInPage(rule) {
  try {
    const strategy = (rule?.strategy || 'css').toLowerCase();

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
      return { ok: !!text, text, count };
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
      return { ok: !!combined, text: combined, count: captured.length };
    }

    if (strategy === 'script') {
      const body = String(rule?.script || '');
      if (!body.trim()) return { ok: false, error: 'empty_script' };
      try {
        const fn = new Function('document', 'window', 'root', '"use strict";' + body);
        const value = fn(document, window, document);
        const resolved = value && typeof value.then === 'function' ? await value : value;
        const text = typeof resolved === 'string'
          ? resolved
          : (resolved == null ? '' : String(resolved));
        const clean = text
          .replace(/\u00A0/g, ' ')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        return { ok: !!clean, text: clean, count: clean ? 1 : 0 };
      } catch (err) {
        return { ok: false, error: String(err && (err.message || err)) };
      }
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
