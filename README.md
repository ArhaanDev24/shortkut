# ShortKut

A local-first AI agent for your desktop — tell it what you want in plain English and watch it work your computer for you.

- **Free path first:** run local models with [Ollama](https://ollama.com) — no API key, no cost, nothing leaves your machine.
- **Or bring your own API key:** Anthropic (Claude), OpenAI (GPT), Google (Gemini), Mistral, or any OpenAI-compatible endpoint. Keys are encrypted with the OS keychain (macOS Keychain / Windows Credential Manager).
- **No server, no account, no telemetry.** Chats are local JSON files; the only network traffic is between your machine and the model provider you choose.

## What it can do

You pick a **workspace folder**, then ShortKut can:

| Capability | Guardrail |
| --- | --- |
| List / read / write / move files, create folders | Locked inside the workspace folder |
| Delete files, run shell commands, AppleScript automations | Approve each time, or enable Auto mode with an always-visible Stop |
| Open and drive apps — clicks & keystrokes, screen reading via native OCR | Screenshots deleted the moment a task ends |
| Send WhatsApp messages, look up contacts, create Calendar events | Recipients verified against Contacts; first-time recipients and duplicates always require approval |
| Never | Types passwords, one-time codes, or payment details; treats anything it reads (files, screens, messages) as data, never as instructions |

While ShortKut works, a purple glow frames the screen and a crayon rides the cursor, so you always see it acting in real time. A "Today with ShortKut" card tracks tasks, time worked, and tokens used, resetting daily.

## Install

Download the latest build from the [releases page](https://github.com/ArhaanDev24/shortkut/releases/latest).

- **macOS** — `.dmg` (Apple Silicon & Intel)
- **Windows** — `.exe` (Windows 10+)

## Development

```bash
npm install
npm run dev        # Electron app with hot reload
npm run typecheck  # TypeScript check
npm run build      # production build into out/
npm run dist       # macOS DMGs into dist/
npm run dist:win   # Windows installer into dist/
```

The marketing site lives in `website/` (self-contained HTML + anime.js).

## Architecture

- `src/main/` — Electron main process: provider adapters (Vercel AI SDK), the agent loop (`streamText` + tools, 25-step cap), workspace-scoped file tools, approval-gated shell/automation, computer use (screenshot, OCR, click, type), context trimming, usage metering, the screen overlay, and notifications.
- `src/preload/` — minimal `contextBridge` API (`window.shortkut`).
- `src/renderer/` — React chat UI: streaming markdown, tool chips, approvals, settings, and the crayon theme.

Chats persist as JSON in the app's user-data folder; screenshots are scrubbed after every run and on startup.

## License

MIT
