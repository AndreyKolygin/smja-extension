# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog and this project adheres to SemVer via the extension `manifest.json` version field.

## [2.3.0] - 2025-10-27

### Added
- Multi-CV storage overhaul: Options → CV & Prompts now keeps multiple resumes with drag-and-drop ordering, inline editor, and synced selection between popup and highlighter.
- Resume selectors in popup overlay and block highlighter stay in sync with last choice, so Analyze from either UI uses the same CV text/id/title.
- Dark/light aware styling for the highlighter menu and overlay header buttons, plus safer options button handling when the runtime context is invalidated.

### Changed
- Highlighter Analyze button adopts popup styling (icon/layout) and now honors the selected CV, system/output templates, and per-model prompts consistently.
- CV import/export formats upgraded to persist arrays (`settings.cvs`, `activeCvId`) with migration for legacy single-string `settings.cv`.
- README/Quickstart updated with instructions for storing multiple resumes and selecting them before analysis.

### Fixed
- Prevented “Extension context invalidated” errors when opening settings from the overlay on sites like LinkedIn.
- Hid redundant “Fast start: unavailable” text and ensured the auto-grab button alone indicates availability.
- Removed stale Notion CV text by wiring export to the active resume.

## [2.2.0] - 2025-10-27

### Added
- DOM chain rules now consist of multiple named groups with add/remove actions, active toggles, and delete confirmations; each active group appends its captured text to the popup input in execution order.

### Changed
- Chain-step editor layout was rebuilt (selector 50 %, index 15 %, text 35 %) with responsive wrapping, unified number/text field styling, and Option hints now rely on localized strings instead of the `muted` helper class.
- Markdown export writes `# Original job description` so destination templates can treat the preserved vacancy text as a top-level section.

### Fixed
- Disabled chain groups are skipped during normalization/execution, preventing inactive selectors from leaking into auto-grab results.

## [2.1.0] - 2025-10-27

### Added
- Content overlay resizing: draggable window now supports vertical resize with clamped bounds and sticky positioning after resizing.

### Changed
- Overlay defaults to the top-right corner, preserves selected job description when closing the highlighter, and keeps the footer visible thanks to updated popup layout.
- Notion field editor redesigned (two-row grid, responsive cards with per-row limits and min/max widths) for clearer mapping.
- Documentation refreshed (README/README.ru/QUICKSTART) and MODEL_NOTES now references the changelog.

### Fixed
- Prevented pointer-capture errors when finishing drag/resize gestures in the overlay helper.

## [2.0.0] - 2025-10-27

### Added
- Floating app overlay: clicking the extension icon now opens a draggable window rendered inside the current tab (`content/app-overlay.js`), with optional resize handle and keyboard shortcuts.
- Block highlighter overlay with undo/redo, Analyze timer, and integration with the selected LLM model.
- Save to Notion integration: settings panel with dynamic field mapping, optional token export/import, and popup button for one-click export.
- Tabs in Options (LLM Settings, Auto-extraction Rules, CV & Prompts, Integrations, Lang & I/O) and sticky language/import/export blocks.
- Auto-extraction strategies now support CSS selector, DOM chain, and (beta) custom script modes; per-site settings upgraded with validation and summaries.
- Import/Export dialogs extended with Integrations group and optional secrets checkbox.

### Changed
- Per-model system prompts now take priority; use `{{GLOBAL_SYSTEM_PROMPT}}` and `{{RESULT_OUTPUT_TEMPLATE}}` tokens to embed or suppress global templates.
- Popup UI rebuilt to live inside the overlay (iframe), keeping job description/result fields persistent until explicitly cleared.
- Notion mapping UI redesigned: grouped rows, renamed “Static value” → “Source data value”, and improved validation for title fields.
- Default site rules normalised to include strategy metadata; settings normalisation extended accordingly.
- README/Quickstart documentation refreshed to match the new workflow.

### Fixed
- Additional CSP handling for Notion requests and overlay scripts.
- Content-script permission prompts when enabling Notion integration.
- Multiple UI glitches in Notion settings (password fields styling, button alignment) and Analyze button state transitions.

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
