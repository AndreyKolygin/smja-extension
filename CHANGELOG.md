# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog and this project adheres to SemVer via the extension `manifest.json` version field.

## [0.4.5] - 2025-09-04

### Added
- Default setup on first run: providers (Ollama, Google Gemini, OpenAI), models (Llama 3, Gemini 1.5 Flash, GPT‑4o mini), site rules (LinkedIn, hh.ru, Indeed), and prompt templates.
- Reset to defaults (Options → Import / Export) with “Keep API keys” enabled by default.
- Export Settings modal with selectable groups and a checkbox to include provider API keys.
- Drag-and-drop reordering for models (grab handle in the first column).
- Two-column Settings layout (Language on the left, Import/Export on the right) with responsive stacking.

### Changed
- Cleaned up manifest to comply with MV3 best practices: removed `options_page`, removed `web_accessible_resources` for locales, switched content scripts to on‑demand injection, added `http://127.0.0.1:11434/*` to optional hosts.
- Removed version from persisted settings; UI now reads version from `chrome.runtime.getManifest()`.

### Fixed
- CSP issues from inline styles in Options (replaced with CSS classes).
- Safer content injection and error handling in content scripts.

---

For older changes, see Git history and GitHub Releases.

