# ShortKut

A local-first AI agent for your Mac — tell it "clean up my Downloads folder" and watch it happen.

- **Free path first:** run local models with [Ollama](https://ollama.com) — no API key, no cost, nothing leaves your machine.
- **Or bring your own API key:** Anthropic (Claude), OpenAI (GPT), Google (Gemini), Mistral, or any OpenAI-compatible endpoint. Keys are encrypted with the macOS Keychain via Electron `safeStorage`.
- **No server, no account, no telemetry.** Chats are local JSON files; the only network traffic is between your machine and the model provider you chose.

## What the agent can do

You pick a **workspace folder**; the agent can then:

| Capability | Guardrail |
| --- | --- |
| List / read / write / move files, create folders | Locked inside the workspace folder |
| Delete files, run shell commands, AppleScript automations | Click-to-approve each time (or Auto mode with an always-visible Stop) |
| Open and drive Mac apps — clicks & keystrokes (CGEvent), screen reading (native OCR) | Screenshots deleted the moment a task ends |
| Send WhatsApp messages, look up contacts, create Calendar events | Recipients verified against Contacts; first-time recipients & duplicates always require approval, even in Auto mode |
| Never | Types passwords, one-time codes, or payment details; treats anything it *reads* (files, screens, messages) as data — never as instructions |

While ShortKut works, a purple glow frames the screen and a crayon rides the cursor, so you always see it acting in real time. A "Today with ShortKut" card tracks tasks, time worked, and tokens used (resets daily).

## Development

```bash
npm install
npm run dev        # Electron app with hot reload
npm run typecheck  # TypeScript check
npm run build      # production build into out/
npm run dist       # DMG installers into dist/ (arm64 + x64)
```

The website lives in `website/` (self-contained HTML + anime.js).

**Signing/notarization** (needed before public distribution): get an Apple Developer account, then set `CSC_LINK`/`CSC_KEY_PASSWORD` and `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` before `npm run dist`. Unsigned builds open locally via right-click → Open.

## Architecture

- `src/main/` — Electron main process: provider adapters (Vercel AI SDK), agent loop (`streamText` + tools, 25-step cap), workspace-scoped file tools, approval-gated shell/automation tools, computer-use (screenshot/OCR/click/type), context trimming + token-economy caps, usage metering, screen overlay, notifications.
- `src/preload/` — minimal `contextBridge` API (`window.shortkut`).
- `src/renderer/` — React chat UI: streaming markdown, tool chips, approvals, settings, crayon theme.

Chats persist as JSON in the app's user-data folder; screenshots are scrubbed after every run and on startup.

## Validation sprint (the current plan)

The next 30 days are about learning whether anyone wants this — not adding features.

- [x] Version control (this repo)
- [x] Windows claim removed from the website (macOS only until Windows is real)
- [x] Buildable DMG installers (`npm run dist`)
- [ ] Apple Developer account → signed + notarized DMG
- [ ] One 60-second video of the headline job (cleaning Downloads) for the website
- [ ] 10 strangers install and use it — watch at least 3 over screen share
- [ ] Fix whatever blocks non-technical users in onboarding (expect: API keys; push the Ollama path)

**Kill criterion:** if 10 real users can't be found in 30 days of honest trying, ShortKut graduates to portfolio piece and the lessons move to the next project. If 10 people use it twice, the next council question is monetization.

**Known risks being watched, not ignored:** unofficial WhatsApp automation can violate Meta's ToS (feature stays, but it is not the flagship pitch); an agent with shell access must treat everything it reads as data, never instructions (enforced in the system prompt); solo-dev time is the scarcest resource.
