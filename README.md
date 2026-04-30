<img width="100%" alt="80M AGENT DESKTOP" src="https://github.com/user-attachments/assets/80585955-3bae-4aee-af90-a1e61757ccb8" />

<br/>
<p align="center">
  <a href="https://github.com/guapdad4000/80m-agent-desktop/releases/"><img src="https://img.shields.io/badge/Download-Releases-FF6600?style=for-the-badge" alt="Releases"></a>
  <a href="https://discord.gg/NousResearch"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/guapdad4000/80m-agent-desktop/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
</p>

> **80m Agent Desktop** is a native desktop application for installing, configuring, and chatting with Hermes Agent — a self-improving AI assistant with tool use, multi-platform messaging, and a closed learning loop. Download the latest release for macOS, Linux, or Windows below.

## Languages

- English: `README.md`
- 简体中文: `README.zh-CN.md`

## Install

Download the latest build from the [Releases](https://github.com/guapdad4000/80m-agent-desktop/releases/) page.

| Platform | File                  |
| -------- | --------------------- |
| Windows  | `.exe`                |
| macOS    | `.dmg`                |
| Linux    | `.AppImage` or `.deb` |

> **macOS users:** The app is not code-signed or notarized. macOS will block it on first launch. To fix this, run the following after installing:
>
> ```bash
> xattr -cr "/Applications/80m Agent Desktop.app"
> ```
>
> Or right-click the app → **Open** → click **Open** in the confirmation dialog.

## What You Get

- **Guided first-run install** for Hermes Agent with progress tracking and dependency resolution
- **Multi-provider support** — OpenRouter, Anthropic, OpenAI, Google (Gemini), xAI (Grok), Nous Portal, Qwen, MiniMax, Hugging Face, Groq, and local OpenAI-compatible endpoints (LM Studio, Ollama, vLLM, llama.cpp)
- **Streaming chat UI** with SSE streaming, tool progress indicators, markdown rendering, and syntax highlighting
- **Token usage tracking** — live prompt/completion token counts and cost display in the chat footer
- **Session management** — full-text search (SQLite FTS5), date-grouped history, resume and search across conversations
- **Profile switching** — create, delete, and switch between separate Hermes environments with isolated config
- **14 toolsets** — web, browser, terminal, file, code execution, vision, image gen, TTS, skills, memory, session search, delegation, MoA, and task planning
- **Memory system** — view/edit memory entries, user profile memory, capacity tracking, and discoverable memory providers
- **Persona editor** — edit and reset your agent's SOUL.md personality
- **Saved models** — CRUD management for model configurations across providers
- **Scheduled tasks** — cron job builder with 15 delivery targets
- **16 messaging gateways** — Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Mattermost, Email (IMAP/SMTP), SMS, iMessage, DingTalk, Feishu/Lark, WeCom, WeChat, Webhooks, Home Assistant
- **Backup & import** — full data backup/restore from Settings
- **Auto-updater** — check for and install updates automatically
- **i18n ready** — internationalization framework with English and Simplified Chinese locales

## Preview

<table>
<tr>
<td width="50%" align="center"><b>Chat</b><br/><img width="100%" alt="Chat" src="https://github.com/user-attachments/assets/ca84a56c-4d14-4775-96bb-c725069988be" /></td>
<td width="50%" align="center"><b>Profiles</b><br/><img width="100%" alt="Profiles" src="https://github.com/user-attachments/assets/bd812e4a-bbdc-4141-b3a8-1ab5b0e561d4" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>Tools</b><br/><img width="100%" alt="Tools" src="https://github.com/user-attachments/assets/ad051fbe-055d-40d2-b6dd-959c522412d2" /></td>
<td width="50%" align="center"><b>Settings</b><br/><img width="100%" alt="Settings" src="https://github.com/user-attachments/assets/b3f7e0d8-b087-4935-b57c-f8db30491f2e" /></td>
</tr>
</table>

## How It Works

On first launch, the app:

1. Checks whether Hermes is already installed in `~/.hermes`.
2. If not installed, runs the official Hermes installer with dependency resolution (Git, uv, Python 3.11+).
3. Prompts for an API provider or local model endpoint.
4. Saves provider config and API keys through Hermes config files.
5. Launches the main workspace once setup is complete.

Chat requests go through a local API server (`http://127.0.0.1:8642`) with SSE streaming. The desktop app parses the stream in real time, rendering tool progress, markdown content, and token usage as it arrives.

## Screens

| Screen | Description |
|--------|-------------|
| **Chat** | Streaming conversation UI with tool progress and token tracking |
| **Sessions** | Browse, search, and resume past conversations |
| **Agents** | Create, delete, and switch between Hermes profiles |
| **Skills** | Browse, install, and manage bundled and installed skills |
| **Models** | Manage saved model configurations per provider |
| **Memory** | View/edit memory entries, user profile, and configure memory providers |
| **Soul** | Edit the active profile's persona (SOUL.md) |
| **Tools** | Enable or disable individual toolsets |
| **Schedules** | Create and manage cron jobs with delivery targets |
| **Gateway** | Configure and control messaging platform integrations |
| **Settings** | Provider config, credential pools, backup/import, log viewer, network settings, theme |

## Supported Providers

### LLM Providers

| Provider | Notes |
|----------|-------|
| **OpenRouter** | 200+ models via single API (recommended) |
| **Anthropic** | Direct Claude access |
| **OpenAI** | Direct GPT access |
| **Google (Gemini)** | Google AI Studio |
| **xAI (Grok)** | Grok models |
| **Nous Portal** | Free tier available |
| **Qwen** | QwenAI models |
| **MiniMax** | Global and China endpoints |
| **Hugging Face** | 20+ open models via HF Inference |
| **Groq** | Fast inference |
| **Local/Custom** | Any OpenAI-compatible endpoint |

Local presets are included for LM Studio, Ollama, vLLM, and llama.cpp.

### Messaging Platforms

Telegram, Discord, Slack, WhatsApp, Signal, Matrix/Element, Mattermost, Email (IMAP/SMTP), SMS (Twilio & Vonage), iMessage (BlueBubbles), DingTalk, Feishu/Lark, WeCom, WeChat, Webhooks, and Home Assistant.

## Development

### Prerequisites

- Node.js and npm
- A Unix-like shell environment for the Hermes installer (Linux/macOS; Windows via WSL or Git Bash)
- Network access for downloading Hermes during first-run install

### Install dependencies

```bash
npm install
```

### Start the app in development

```bash
npm run dev
```

### Run checks

```bash
npm run lint
npm run typecheck
```

### Run tests

```bash
npm run test
npm run test:watch
```

### Build the desktop app

```bash
npm run build
```

Platform packaging:

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

## First-Time Setup

When the app opens for the first time, it will either detect an existing Hermes installation or offer to install it for you.

Supported setup paths in the UI:

- `OpenRouter`
- `Anthropic`
- `OpenAI`
- `Local LLM` via an OpenAI-compatible base URL

Local presets are included for: LM Studio, Ollama, vLLM, llama.cpp.

Hermes files are managed in:

- `~/.hermes`
- `~/.hermes/.env`
- `~/.hermes/config.yaml`
- `~/.hermes/hermes-agent`
- `~/.hermes/profiles/` — named profile directories
- `~/.hermes/state.db` — session history database
- `~/.hermes/cron/jobs.json` — scheduled tasks

## Tech Stack

- **Electron** 39 — cross-platform desktop shell
- **React** 19 — UI framework
- **TypeScript** 5.9 — type safety across main and renderer processes
- **Tailwind CSS** 4 — utility-first styling
- **Vite** 7 + electron-vite — fast dev server and build tooling
- **better-sqlite3** — local session storage with FTS5 full-text search
- **i18next** — internationalization framework
- **Vitest** — test runner

## Contributing

Contributions are welcome! Check out the [Contributing Guide](CONTRIBUTING.md) to get started. If you're not sure where to begin, take a look at the [open issues](https://github.com/guapdad4000/80m-agent-desktop/issues). Found a bug or have a feature request? [File an issue](https://github.com/guapdad4000/80m-agent-desktop/issues/new).

## Legal

**80m Agent Desktop** is a desktop interface built on top of [Hermes Agent](https://github.com/NousResearch/hermes-agent) by [Nous Research](https://nousresearch.com). The desktop app is licensed MIT. Hermes Agent is a separate open-source project with its own license.
