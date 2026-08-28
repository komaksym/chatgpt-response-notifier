# ChatGPT Response Notifier

A reliability-first Chrome extension that alerts you when ChatGPT finishes responding or needs your approval.

## Features

- Response notifications stay visible until dismissed or clicked
- Detected responses notify even if Chrome's tab/window focus state is ambiguous
- Visual tab highlighting so you can identify which ChatGPT tab finished
- Optional custom chime with adjustable volume
- Detection of completed responses and action-required states
- Polls ChatGPT continuously and treats stable new assistant output as a completion fallback when ChatGPT's normal completion markers are missing
- Periodically re-checks and re-injects page monitors if Chrome invalidates or disconnects them
- Support for multiple ChatGPT tabs
- Diagnostic notification and sound tests from the popup

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder.
6. Open or refresh a ChatGPT tab.

## Usage

Open the extension popup to enable or disable desktop alerts, tab highlighting, and sound. The popup also shows notification permission, connected ChatGPT tabs, and the last detected event.

## Supported sites

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

## Version

Current manifest version: **0.8.13**.
