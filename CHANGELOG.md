# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog and this project adheres to SemVer via the extension `manifest.json` version field.

## [2.7.0] - 2026-01-04

### Added
- Context menu actions: Select description, Auto-grab, and Open side panel.
- Side panel support (opens the main UI in a persistent panel).
- Result caching with forced refresh on “Start over”, plus cached badge in the popup.
- Approximate token counter (input + output) in the popup.
- Per-model sampling parameters in Options (temperature, top‑p, penalties, etc.) with provider support.

### Changed
- Import mode selector switched to segmented control.
- Sampling parameters in the model editor are grouped into a collapsible block with inline range hints.
- Auto-grab context menu item now appears only when a site rule matches the current page.

### Fixed
- Side panel UI no longer gets stuck on non‑HTTP(S) pages when the active tab changes.

## [2.6.0] - 2025-12-27

### Added
- Highlighter menu now follows the popup theme preference (light/dark/system), with theme switching decoupled from OS settings.

### Changed
- Highlighter menu styling aligned with the popup neumorphism palette, including button states and CV selector visuals.
- Meta overlay defaults updated: Page data starts expanded, Meta tags start collapsed to reduce noise on large pages.
- Options dialogs now use a scrollable content area with sticky footer buttons, so Import/Export and rule editing stay usable on small screens.

### Fixed
- Highlighter CV selector is isolated from host page CSS (e.g., LinkedIn), preventing site styles from breaking layout or colors.
- Background page scroll is locked while options dialogs are open, avoiding jump-to-top and preserving scroll position.

## [2.5.0] - 2025-11-26

### Added
- Meta overlay button in the popup header: opens a draggable, searchable list of all meta tags on the page, lets you copy placeholder names, and can be refreshed without closing the main overlay.
- “Meta Tags Template” now works as an add-on for CSS/DOM-chain rules, with toggles to append the rendered output to the Job description (LLM input) and/or show it under the Position matching result. Template values are also forwarded to Notion, clipboard copy, and Markdown export.
- “Page meta data” source in the Notion integration plus support for the native `select` property type, so any placeholder (e.g. `meta:property:og:title`) can populate structured fields.
- Copy and Save-to-Markdown actions now append the Page meta data block so exported notes contain both the analysis and the captured tags.

### Changed
- Fast start and manual analyze reuse the same template payloads, guaranteeing consistent data between the job description, result view, Notion export, clipboard, and Markdown files.
- Meta overlay header doubles as a drag handle but ignores clicks on buttons/input fields, keeping search and controls responsive.

### Fixed
- Notion export strips inline Markdown formatting before writing to fields, preventing outputs like `*Не указана**`.
- Settings page no longer triggers CSP violations when showing the “cache cleared” hint (styles moved into CSS classes).

## [2.4.0] - 2025-11-21

### Changed
- Removed the non-functional “Custom script” rule type; auto-extraction now uses a **Template** strategy that substitutes collected page variables (title, description, meta tags, schema.org data, selection, etc.).
- Added a page-variable collector shared by fast start and options, so templates work without any unsafe `eval`.

## [2.3.1] - 2025-10-27

### Added
- Template blanks under `docs/templates/**/blank_*.json` for providers/models, models-only, auto-extraction rules, CVs, system prompts, output templates, and Notion integrations.

### Changed
- Import dialog now splits “CV & Prompts” into dedicated groups (CVs, System Prompt Template, Result Output Template) so users can import only the desired piece of data.
- System/output templates respect `Replace data` even when importing empty strings; Groups to import only apply to sections present in the JSON.

### Fixed
- System Prompt Template and Result Output Template are properly replaced when importing JSON that contains these keys, even in “Replace data” mode.

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
