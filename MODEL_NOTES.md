# Codex Model Notes

## Назначение
- Минимальный справочник по коду, чтобы `rg`/поиск тратил меньше токенов.
- После каждого апдейта или команды «Обнови это дерьмо» дописывай краткое резюме в раздел ниже.

## Каркас расширения
- `manifest.json` → MV3, `background/index.js` как сервис-воркер; `host_permissions` пусты, `optional_host_permissions` содержит провайдеров.
- `shared/defaults.js` → единственный источник дефолтных провайдеров, моделей, сайтов, шаблонов.
- `background/settings.js` → CRUD настроек (`getSettings`, `saveSettings`, `resetSettings`, `applyUiMode*`).
- `background/utils.js` → `sanitizeText`, `requireFields`, `guardedCall`, `nowMs`.
- `background/index.js` → обрабатывает сообщения (`GET_ACTIVE_TAB`, `BEGIN_SELECTION`, `EXTRACT_FROM_PAGE`, `CALL_LLM`, `START_ANALYZE`, ...), инжектит контент-скрипты, вызывает `callLLMRouter`.
- `background/llm/router.js` → `callLLMRouter` готовит prompt (`sys`,`user`) и шлет в адаптеры (`openai`, `azure`, `anthropic`, `ollama`, `gemini`).
- `background/llm/*` → fetch-адаптеры (OpenAI нормализует URL, Azure добавляет `apiVersion`, Anthropic/Оllama/Gemini обрабатывают таймауты).

## Контент-скрипты
- `content/content.js` → фоновый бейдж (`debugBadge`), safe polling storage, ответ на `__PING__`, обработка `EXTRACT_SELECTOR`.
- `content/select.js` → overlay‑селекция: `STATE` хранит диапазоны, `createOverlay`/`mergeSameLineRects`, кнопка `Start analyze` вызывает `chrome.runtime.sendMessage`.

## UI / state
- `ui/popup.html` + `ui/popup.js` → точка входа попапа.
- `ui/options.html` + `ui/js/options-*.js` → страницы настроек (providers/models/sites/import-export).
- `ui/js/state.js` → стор попапа; `ui/js/messaging.js` слушает `LLM_RESULT`, `SELECTION_*`.
- `ui/locales/{en,ru}.json` → перевод строк.

## Поиск по ключам
- Выделение → `rg "SELECTION_RESULT"`.
- LLM вызов → `rg "CALL_LLM"` или `rg "callLLMRouter"`.
- Сброс настроек → `rg "RESET_DEFAULTS"`.
- Дефолтные шаблоны → `rg "DEFAULT_SYSTEM_TEMPLATE" shared/defaults.js`.
## Журнал
- Подробные изменения ведутся в `CHANGELOG.md`. Здесь оставляем только структуры и быстрые ссылки для поиска по проекту.
