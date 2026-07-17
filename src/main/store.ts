import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'mistral' | 'ollama' | 'custom'

export interface Settings {
  provider: ProviderId
  model: string
  /** Base URL for ollama / custom OpenAI-compatible endpoints */
  baseUrl: string
  workspace: string | null
  theme: 'light' | 'dark'
  /** Auto mode: the user pre-approves commands, deletions, and automations for this machine. */
  autoMode: boolean
}

export const PROVIDER_DEFAULTS: Record<ProviderId, { label: string; model: string; baseUrl: string; needsKey: boolean }> = {
  anthropic: { label: 'Anthropic (Claude)', model: 'claude-sonnet-4-5', baseUrl: '', needsKey: true },
  openai: { label: 'OpenAI (GPT)', model: 'gpt-4o', baseUrl: '', needsKey: true },
  google: { label: 'Google (Gemini)', model: 'gemini-2.5-flash', baseUrl: '', needsKey: true },
  mistral: { label: 'Mistral', model: 'mistral-large-latest', baseUrl: '', needsKey: true },
  ollama: { label: 'Ollama (local, free)', model: 'llama3.2', baseUrl: 'http://localhost:11434/v1', needsKey: false },
  custom: { label: 'Custom (OpenAI-compatible)', model: '', baseUrl: '', needsKey: true }
}

const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  model: PROVIDER_DEFAULTS.anthropic.model,
  baseUrl: '',
  workspace: null,
  theme: 'light',
  autoMode: false
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function keysPath(): string {
  return path.join(app.getPath('userData'), 'keys.json')
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
    return { ...DEFAULT_SETTINGS, ...raw }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
}

/** API keys are encrypted with the OS keychain (Electron safeStorage) and never leave this machine. */
function loadKeyFile(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(keysPath(), 'utf8'))
  } catch {
    return {}
  }
}

export function setApiKey(provider: string, key: string): void {
  const keys = loadKeyFile()
  if (!key) {
    delete keys[provider]
  } else if (safeStorage.isEncryptionAvailable()) {
    keys[provider] = safeStorage.encryptString(key).toString('base64')
  } else {
    keys[provider] = 'plain:' + Buffer.from(key).toString('base64')
  }
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(keysPath(), JSON.stringify(keys, null, 2))
}

export function getApiKey(provider: string): string | null {
  const stored = loadKeyFile()[provider]
  if (!stored) return null
  try {
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    }
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return null
  }
}

export function keyStatus(): Record<string, boolean> {
  const keys = loadKeyFile()
  const status: Record<string, boolean> = {}
  for (const p of Object.keys(PROVIDER_DEFAULTS)) status[p] = p in keys
  return status
}
