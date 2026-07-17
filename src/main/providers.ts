import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createMistral } from '@ai-sdk/mistral'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, type LanguageModel } from 'ai'
import { getApiKey, PROVIDER_DEFAULTS, type Settings } from './store'

export function buildModel(settings: Settings, overrideKey?: string): LanguageModel {
  const { provider, model } = settings
  const key = overrideKey ?? getApiKey(provider)

  if (PROVIDER_DEFAULTS[provider].needsKey && !key) {
    throw new Error(`No API key saved for ${PROVIDER_DEFAULTS[provider].label}. Add one in Settings.`)
  }

  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: key! })(model)
    case 'openai':
      return createOpenAI({ apiKey: key! })(model)
    case 'google':
      return createGoogleGenerativeAI({ apiKey: key! })(model)
    case 'mistral':
      return createMistral({ apiKey: key! })(model)
    case 'ollama':
      // Key is optional: local Ollama needs none, remote/cloud Ollama servers use one.
      return createOpenAICompatible({
        name: 'ollama',
        baseURL: settings.baseUrl || PROVIDER_DEFAULTS.ollama.baseUrl,
        apiKey: key ?? undefined
      })(model)
    case 'custom': {
      if (!settings.baseUrl) throw new Error('Set a base URL for your custom endpoint in Settings.')
      return createOpenAICompatible({
        name: 'custom',
        baseURL: settings.baseUrl,
        apiKey: key ?? undefined
      })(model)
    }
  }
}

export async function testConnection(
  settings: Settings,
  overrideKey?: string | null
): Promise<{ ok: boolean; message: string }> {
  try {
    if (!settings.model) return { ok: false, message: 'Pick a model first.' }
    const model = buildModel(settings, overrideKey || undefined)
    await generateText({
      model,
      prompt: 'Reply with the single word: ok',
      maxOutputTokens: 32,
      abortSignal: AbortSignal.timeout(20_000)
    })
    return { ok: true, message: `Connected — ${settings.model} responded.` }
  } catch (err: any) {
    let message = String(err?.message ?? err)
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') message = 'Timed out after 20s.'
    if (/401|unauthorized|invalid.*key|authentication/i.test(message)) message = 'Invalid API key (authentication failed).'
    if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) {
      message =
        settings.provider === 'ollama'
          ? 'Could not reach Ollama — is it running? (ollama serve)'
          : 'Could not reach the endpoint. Check the URL and your internet connection.'
    }
    return { ok: false, message: message.slice(0, 300) }
  }
}

export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const root = (baseUrl || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '')
    const key = getApiKey('ollama')
    const res = await fetch(`${root}/api/tags`, {
      signal: AbortSignal.timeout(2000),
      headers: key ? { Authorization: `Bearer ${key}` } : undefined
    })
    if (!res.ok) return []
    const data = (await res.json()) as { models?: { name: string }[] }
    return (data.models ?? []).map((m) => m.name)
  } catch {
    return []
  }
}
