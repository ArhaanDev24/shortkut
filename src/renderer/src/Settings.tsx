import { useEffect, useState } from 'react'
import { IconCheck, IconX } from './Icons'
import type { ProviderId, ProviderInfo, Settings } from './types'

const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'openai', 'google', 'mistral', 'ollama', 'custom']

export default function SettingsModal({
  settings,
  providers,
  hasKey,
  onClose,
  onSaved
}: {
  settings: Settings
  providers: Record<ProviderId, ProviderInfo>
  hasKey: Record<string, boolean>
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<Settings>({ ...settings })
  const [keyInput, setKeyInput] = useState('')
  const [keys, setKeys] = useState(hasKey)
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [isMac, setIsMac] = useState(false)
  const [accessibility, setAccessibility] = useState<boolean | null>(null)
  const [screenRec, setScreenRec] = useState<boolean | null>(null)
  const [permMsg, setPermMsg] = useState('')
  const [permBusy, setPermBusy] = useState(false)
  const [test, setTest] = useState<{ status: 'idle' | 'testing' | 'ok' | 'fail'; message: string }>({
    status: 'idle',
    message: ''
  })

  const info = providers[draft.provider]

  const runTest = async (): Promise<void> => {
    setTest({ status: 'testing', message: '' })
    const result = await window.shortkut.testConnection(draft, keyInput.trim() || null)
    setTest({ status: result.ok ? 'ok' : 'fail', message: result.message })
  }

  useEffect(() => {
    if (draft.provider === 'ollama') {
      void window.shortkut.listOllamaModels(draft.baseUrl || info.baseUrl).then(setOllamaModels)
    }
  }, [draft.provider, draft.baseUrl, info.baseUrl])

  useEffect(() => {
    void window.shortkut.permissionsStatus().then((s) => {
      setIsMac(s.platform === 'darwin')
      setAccessibility(s.accessibility)
      setScreenRec(s.screen)
    })
  }, [])

  const requestPermission = async (kind: 'accessibility' | 'automation' | 'screen'): Promise<void> => {
    setPermBusy(true)
    setPermMsg(kind === 'automation' ? 'Watch for a macOS permission prompt…' : '')
    const result = await window.shortkut.requestPermission(kind)
    setPermMsg(result.message)
    const status = await window.shortkut.permissionsStatus()
    setAccessibility(status.accessibility)
    setScreenRec(status.screen)
    setPermBusy(false)
  }

  const selectProvider = (p: ProviderId): void => {
    setDraft((d) => ({
      ...d,
      provider: p,
      // Returning to the saved provider restores its saved model; otherwise use the provider default.
      model: p === settings.provider ? settings.model : providers[p].model,
      baseUrl: p === settings.provider && settings.baseUrl ? settings.baseUrl : providers[p].baseUrl
    }))
    setKeyInput('')
    setTest({ status: 'idle', message: '' })
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    if (keyInput.trim()) {
      const status = await window.shortkut.setApiKey(draft.provider, keyInput.trim())
      setKeys(status)
    }
    // Theme/Auto may have been toggled while this modal was open; live values win over the draft.
    const current = (await window.shortkut.getSettings()).settings
    await window.shortkut.saveSettings({ ...draft, theme: current.theme, autoMode: current.autoMode })
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <label className="field-label">Provider</label>
        <div className="provider-grid">
          {PROVIDER_ORDER.map((p) => (
            <button
              key={p}
              className={`provider-card ${draft.provider === p ? 'active' : ''}`}
              onClick={() => selectProvider(p)}
            >
              <span className="provider-name">{providers[p].label}</span>
              <span className="provider-status">
                {!providers[p].needsKey ? (
                  'free · local'
                ) : keys[p] ? (
                  <>
                    <IconCheck size={10} /> key saved
                  </>
                ) : (
                  'key needed'
                )}
              </span>
            </button>
          ))}
        </div>

        <label className="field-label">Model</label>
        {draft.provider === 'ollama' && ollamaModels.length > 0 ? (
          <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
            {!ollamaModels.includes(draft.model) && <option value={draft.model}>{draft.model}</option>}
            {ollamaModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={draft.model}
            placeholder="model id, e.g. claude-sonnet-4-5"
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
        )}
        {draft.provider === 'ollama' && ollamaModels.length === 0 && (
          <p className="hint">
            Ollama not detected at {draft.baseUrl || info.baseUrl}. Install it from ollama.com and pull a model
            (e.g. <code>ollama pull llama3.2</code>) to chat for free.
          </p>
        )}

        {(draft.provider === 'ollama' || draft.provider === 'custom') && (
          <>
            <label className="field-label">Base URL</label>
            <input
              type="text"
              value={draft.baseUrl}
              placeholder={draft.provider === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.example.com/v1'}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            />
          </>
        )}

        {(info.needsKey || draft.provider === 'ollama') && (
          <>
            <label className="field-label">
              API key{draft.provider === 'ollama' && ' (optional)'}{' '}
              {keys[draft.provider] && (
                <span className="key-saved">
                  <IconCheck size={11} /> saved (enter a new one to replace)
                </span>
              )}
            </label>
            <input
              type="password"
              value={keyInput}
              placeholder={
                keys[draft.provider]
                  ? '••••••••••••••••'
                  : draft.provider === 'ollama'
                    ? 'Only for remote / Ollama cloud — leave empty for local'
                    : 'Paste your API key'
              }
              onChange={(e) => {
                setKeyInput(e.target.value)
                setTest({ status: 'idle', message: '' })
              }}
            />
            <p className="hint">
              {draft.provider === 'ollama'
                ? 'Local Ollama needs no key. Add one only if your Ollama server or Ollama cloud account requires it — stored encrypted in the system keychain.'
                : 'Stored encrypted on this Mac via the system keychain. It never leaves your machine.'}
            </p>
          </>
        )}

        {isMac && (
          <>
            <label className="field-label">macOS control permissions</label>
            <div className="perm-row">
              <div className="perm-info">
                <span className="provider-name">Accessibility</span>
                <span className="provider-status">
                  {accessibility === null ? (
                    'checking…'
                  ) : accessibility ? (
                    <>
                      <IconCheck size={10} /> granted — ShortKut can click &amp; type
                    </>
                  ) : (
                    'needed for clicking & typing in apps'
                  )}
                </span>
              </div>
              {!accessibility && (
                <button className="btn ghost" disabled={permBusy} onClick={() => void requestPermission('accessibility')}>
                  Grant…
                </button>
              )}
            </div>
            <div className="perm-row">
              <div className="perm-info">
                <span className="provider-name">Screen Recording</span>
                <span className="provider-status">
                  {screenRec === null ? (
                    'checking…'
                  ) : screenRec ? (
                    <>
                      <IconCheck size={10} /> granted — ShortKut can see the screen
                    </>
                  ) : (
                    'needed so ShortKut can see the screen'
                  )}
                </span>
              </div>
              {!screenRec && (
                <button className="btn ghost" disabled={permBusy} onClick={() => void requestPermission('screen')}>
                  Grant…
                </button>
              )}
            </div>
            <div className="perm-row">
              <div className="perm-info">
                <span className="provider-name">Automation</span>
                <span className="provider-status">lets ShortKut control apps (Notes, Finder, Safari…)</span>
              </div>
              <button className="btn ghost" disabled={permBusy} onClick={() => void requestPermission('automation')}>
                {permBusy ? 'Checking…' : 'Grant / Check…'}
              </button>
            </div>
            {permMsg && <p className="hint">{permMsg}</p>}
            <p className="hint">
              macOS asks once per app. During development ShortKut appears as &quot;Electron&quot; in System Settings →
              Privacy &amp; Security.
            </p>
            <p className="hint">
              Privacy: screenshots are captured to a temporary file, sent only to your chosen model provider, and
              deleted immediately. They are also scrubbed from chat history the moment a task finishes — nothing
              stays on this Mac.
            </p>
          </>
        )}

        <div className="test-row">
          <button
            className="btn ghost"
            onClick={() => void runTest()}
            disabled={
              test.status === 'testing' ||
              !draft.model ||
              (info.needsKey && !keyInput.trim() && !keys[draft.provider])
            }
          >
            {test.status === 'testing' ? 'Testing…' : 'Test connection'}
          </button>
          {test.status === 'testing' && <span className="test-msg dim">Contacting {draft.model}…</span>}
          {test.status === 'ok' && (
            <span className="test-msg ok">
              <IconCheck size={12} /> {test.message}
            </span>
          )}
          {test.status === 'fail' && (
            <span className="test-msg fail">
              <IconX size={12} /> {test.message}
            </span>
          )}
        </div>

        <div className="modal-buttons">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={saving || !draft.model}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
