# Chrome Web Store Listing Guide

Use this checklist to publish `Job Description Analyzer` in the Chrome Web Store. All paths are relative to the repository root.

---

## 1. Required Assets

| Asset | Path / Notes |
|-------|--------------|
| Extension icon 128×128 | `icons/128.png` (derived from the SVG set, matches manifest) |
| Extension icon 48×48 | `icons/48.png` |
| Extension icon 16×16 | `icons/16.png` |
| Optional vector sources | `icons/*.svg` – use the `i-magic`, `i-copy`, etc. icons for screenshots or marketing collateral. |
| Promo banner 1400×560 | _Create before submission_ – capture overlay + Notion export, overlay text *“Analyze job descriptions with your CV”*. |
| Screenshots (minimum 1, recommended 3–5) | _Create before submission_ – see guidance below. |

### Screenshot Guidance

1. **Highlight & Analyze** – show the highlighter overlay selecting blocks and the timer running.  
2. **Popup result** – capture the popup with analysis rendered, Notion button visible, and translated tooltips for RU/EN.  
3. **Auto-extraction** – demonstrate Fast Start working on a recognised site.  
4. Optional: **Notion export** confirmation message.

Take screenshots at 1280×800 (Chrome Web Store requirement). Use a clean Chromium profile with only the extension enabled.

---

## 2. Listing Text

### Name

`Job Description Analyzer`

### Short Description (≤132 characters)

`Compare job postings with your CV in seconds using local or cloud LLMs, highlight skill gaps, and export results to Notion.`

### Full Description

```
Job Description Analyzer (JDA) helps you evaluate vacancies against your CV in seconds. Highlight relevant blocks on any job page, let your preferred LLM analyse the text, and get a structured report ready to share.

Key features:
• Floating overlay with draggable, resizable UI.
• Block highlighter with undo/redo and analysis timer.
• Auto-grab rules per site (CSS, DOM chain, or custom script).
• Flexible prompting: global templates and per-model overrides.
• Save to Notion with configurable field mapping and optional status defaults.
• Import/export of providers, models, prompts, rules, and integrations.

Privacy-friendly by design:
• CV, prompts, and API keys stay in your browser.
• No analytics, no background syncing.
• Optional host permissions requested only when you enable a provider.

Works with local LLMs (Ollama) and popular cloud APIs (OpenAI, Gemini, Anthropic, OpenRouter, Perplexity, DeepSeek, etc.). Perfect for recruiters, career coaches, or job seekers who want fast, repeatable evaluations of job requirements.
```

### Category

`Productivity`

### Language

`English (United States)` primary. Add Russian secondary once screenshots are prepared in both languages.

---

## 3. Links & Contact

| Field | Value |
|-------|-------|
| Homepage / Support URL | https://github.com/AndreyKolygin/smja-extension |
| Issue tracker | https://github.com/AndreyKolygin/smja-extension/issues |
| Privacy policy | https://github.com/AndreyKolygin/smja-extension/blob/main/docs/policies/privacy.md |

Ensure the GitHub repository is public so the policy link remains accessible.

---

## 4. Release Package

1. Run `scripts/build-release.sh`.  
2. Upload `dist/jda-extension-<version>.zip` to the Chrome Web Store draft.  
3. Verify the manifest version matches the listing version number.

---

## 5. Quality Checklist

- [ ] Manifest permissions match the listing description (no unused host permissions).  
- [ ] Popup, options, and overlay tested in English and Russian.  
- [ ] All tooltips/localised strings render correctly.  
- [ ] Screenshots/promo images updated for each major release.  
- [ ] Privacy policy & support links verified after publishing.
