# SMJA Extension

Браузерное расширение для анализа вакансий и сравнения их с вашим резюме.  
Работает локально, поддерживает Google Gemini, OpenAI, Ollama и другие LLM‑провайдеры.

---

## 🚀 Установка

1. Скачайте и распакуйте архив с расширением.
2. Откройте в браузере `chrome://extensions/`.
3. Включите **Режим разработчика**.
4. Нажмите **Загрузить распакованное** → выберите папку с расширением.

---

## ⚙️ Быстрый старт (с дефолтами)

При первом запуске уже предустановлены:
- Провайдеры: Ollama Local, Google Gemini, OpenAI
- Модели: Llama 3 (Ollama, активна), Gemini 1.5 Flash (активна), GPT‑4o mini (выкл)
- Сайты: LinkedIn, hh.ru, Indeed (авто‑извлечение включено)
- Шаблоны System Prompt и Result Output

Что нужно сделать:
1) Вставьте своё CV (Options → General → CV)
2) Укажите API‑ключи (по желанию) для Gemini / OpenAI
3) При необходимости поменяйте шаблоны

Автосохранение включено; можно также нажать Save.

---

## 📊 Использование

1. Откройте вакансию.
2. Выделите её описание.
3. Нажмите на иконку расширения → **Analyze**.
4. Получите отчёт: соответствие резюме и вакансии, требования, пробелы, рекомендации.

---

## 💾 Импорт и экспорт

- Export Settings — модалка выбора групп: Provider Settings (отдельно “Include API keys”), Models, Auto‑extraction Rules, CV, System Prompt Template, Result Output Template
- Import Settings — режим Merge/Replace и выбор групп

---

## 🔑 Поддерживаемые провайдеры

- Google Gemini  
- OpenAI  
- Ollama  
- Hugging Face  
- Anthropic  
- Perplexity  
- OpenRouter  
- Azure OpenAI  
- Meta / xAI  
- DeepSeek  

---

## 📎 Ссылки

- [GitHub проекта](https://github.com/AndreyKolygin/smja-extension)
