# JDA Extension

JDA (Job Description Analyzer) is a Chromium-compatible browser extension that helps you align job postings with your CV and produce a structured summary in seconds. Everything runs locally inside the browser: the CV never leaves your machine, API keys stay in storage unless you explicitly export them.

---

## ✨ Key features

- **Floating workspace** — clicking the toolbar icon opens a draggable, resizable overlay with job description input, analysis result, and quick actions.
- **Smart block highlighter** — select arbitrary fragments on the page, use undo/redo, and track analysis time.
- **Auto-extraction rules** — per-site strategies with CSS selectors, DOM chains, or custom scripts for tricky pages.
- **Flexible prompts** — global templates plus per-model overrides with `{{GLOBAL_SYSTEM_PROMPT}}` and `{{RESULT_OUTPUT_TEMPLATE}}` tokens.
- **Save to Notion** — configurable field mapping, optional secrets export, status defaults, and Markdown-friendly output.
- **Import / export** — granular groups (providers, models, rules, prompts, CV, integrations) with merge or replace modes.

---

## 🔧 Installation

1. Download the latest release from [GitHub](https://github.com/AndreyKolygin/smja-extension/releases).
2. Unzip the archive.
3. In Chrome/Chromium:
   - Open `chrome://extensions/`
   - Enable **Developer mode**
   - Click **Load unpacked** and pick the extension folder
4. Pin the “JDA” icon to have quick access to the overlay.

Compatible with Chrome, Edge, Brave and other Chromium-based browsers.

---

## ⚙️ First-run defaults

Open Options after installation. The extension ships with sensible defaults:

- **Providers**: Ollama Local, Google Gemini, OpenAI
- **Models**: Llama 3 (Ollama, active), Gemini 2.5 Flash lite (active), GPT‑4o mini (inactive)
- **Auto-extraction rules**: LinkedIn, hh.ru, Indeed (enabled)
- **Templates**: global system prompt and Markdown output

Recommended first steps:

1. Paste your CV under **Options → CV & Prompts**.
2. Add API keys for Gemini/OpenAI if you plan to use cloud models.
3. Adjust the system/output templates to match your tone of voice.
4. (Optional) Configure **Integrations → Save to Notion** if you want one-click export.

All changes are saved automatically; the Save button is available for manual commit.

---

## 🖥 Using the overlay

1. Open a job posting page.
2. Click the extension icon — the overlay appears in the top-right corner (you can drag or resize it).
3. Click **Select job description** to highlight blocks manually, or use **Auto-grab** if a rule exists for the site.
4. Press **Analyze**. The report renders in Markdown, including match, key requirements, gaps, and action items.
5. Copy the result, save to Markdown, or send directly to Notion.

The job description and analysis persist until you clear them explicitly, so you can close/reopen the overlay without losing context.

---

## 🔌 Integrations & automation

### Notion

- Enable **Save to Notion** in Options → Integrations, provide integration token and database ID.
- Map properties via the field editor (Notion property + type + source). For `Analysis` / `Custom text` sources, fill in *Source data value*.
- The popup gets a dedicated **N** button once the integration is enabled.
- Export/import settings includes an “Integrations” group and an optional checkbox for secrets.

### Auto-extraction rules

Each rule contains:

- Site pattern (hostname, wildcard, regex or full URL mask)
- Strategy: **CSS**, **DOM chain**, or **Custom script**
- Optional comment and active toggle

DOM chains allow multi-step narrowing (selector + text filter + index). Script mode is fenced by CSP; use it for same-origin iframes only.

---

## 📥 Import & export

- **Export Settings** → choose groups, optionally include API keys or integration secrets.
- **Import Settings** → *Merge/add* (updates existing entries by ID) or *Replace* (overwrites selected groups).
- **Reset to defaults** → restores providers/models/rules/templates; by default this keeps stored API keys.

---

## 🔑 Supported providers

Google Gemini · OpenAI · Ollama · Hugging Face · Anthropic · Perplexity · OpenRouter · Azure OpenAI · Meta / xAI · DeepSeek

---

## 📄 Documentation

- [Quickstart](./QUICKSTART.md)
- [Changelog](./CHANGELOG.md)
- [Русская документация](./README.ru.md)
