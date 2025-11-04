# Privacy Policy for Job Description Analyzer (JDA)

_Last updated: 2025-10-26_

JDA is a browser extension that helps you analyse job descriptions against your CV. The extension is designed to run entirely on the client side. We do not collect, transmit or sell any personal information.

## What data is processed

- **CV, prompts, settings** – stored locally inside the extension using `chrome.storage.local`.
- **API keys** – stored locally when you enter them in the settings. They are only transmitted directly to the corresponding LLM or Notion API endpoints that you explicitly configure.
- **Job descriptions and analysis results** – kept in the extension’s local storage so you can reopen the popup and continue working. They are not sent to any third-party service unless you trigger an action (e.g. Save to Notion).

## Data sharing

JDA does not send any data to the extension author or third-party analytics services. Data leaves your device only when you:

- Call an LLM provider that you configured.
- Save a result to Notion via your integration token.
- Download a Markdown file to your computer.

All such actions are initiated manually by you.

## Permissions

The extension requests the minimal permissions required to:

- Inject the overlay on the active tab (`activeTab`, `tabs`, `scripting`).
- Download Markdown reports (`downloads`).
- Persist your configuration locally (`storage`).
- Access optional host permissions **only** for the LLM or Notion hosts you enable.

## Contact

If you have any questions or privacy-related requests, please open an issue on GitHub: https://github.com/AndreyKolygin/smja-extension/issues

By using this extension you agree to this privacy policy.
