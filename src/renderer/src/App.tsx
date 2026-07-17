import { useCallback, useEffect, useRef, useState } from 'react'
import Messages from './Messages'
import SettingsModal from './Settings'
import Sidebar from './Sidebar'
import Logo from './Logo'
import {
  IconAutomation,
  IconBolt,
  IconFolder,
  IconGear,
  IconMoon,
  IconSend,
  IconStop,
  IconSun,
  IconTerminal,
  IconTrash
} from './Icons'
import type {
  AgentEvent,
  ChatMessage,
  ChatMeta,
  MessagePart,
  ProviderId,
  ProviderInfo,
  Settings,
  TodayStats
} from './types'

interface Approval {
  id: string
  kind: 'command' | 'delete' | 'automation'
  detail: string
}

const APPROVAL_COPY = {
  command: {
    title: 'Run this command?',
    confirm: 'Run it',
    Icon: IconTerminal,
    danger: false,
    note: (ws: string | null) => `Runs in ${ws ?? 'your workspace'}.`
  },
  delete: {
    title: 'Delete this file?',
    confirm: 'Delete it',
    Icon: IconTrash,
    danger: true,
    note: () => 'This permanently removes it from your workspace.'
  },
  automation: {
    title: 'Let ShortKut control your Mac?',
    confirm: 'Allow it',
    Icon: IconAutomation,
    danger: false,
    note: () => 'Runs as an AppleScript automation. macOS may ask you to grant Accessibility permission on first use.'
  }
} as const

let nextId = 0
const uid = (): string => `m${nextId++}`

// Four thick passes; with strokeWidth 30 they blanket the whole 0-100 viewBox.
const SCRIBBLE_PATH = 'M -30 10 L 130 10 L -30 36 L 130 36 L -30 62 L 130 62 L -30 88 L 130 88'

/** Theme transition: a crayon rides a zigzag stroke, scribbling the new paper over the screen. */
function ThemeScribble({ color, fading }: { color: string; fading: boolean }): React.JSX.Element {
  const motionRef = useRef<SVGElement | null>(null)

  useEffect(() => {
    // SMIL clocks are document-based; dynamically-mounted animations need an explicit start.
    ;(motionRef.current as unknown as { beginElement?: () => void } | null)?.beginElement?.()
  }, [])

  return (
    <div className={`theme-sweep ${fading ? 'fading' : ''}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <path
          className="sweep-path"
          d={SCRIBBLE_PATH}
          pathLength={100}
          fill="none"
          stroke={color}
          strokeWidth={30}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <g>
          <g stroke="#38304a" strokeWidth="0.5" strokeLinejoin="round">
            <rect x="-6" y="-1.6" width="5.2" height="3.2" rx="0.9" fill="#7444c8" />
            <rect x="-4.6" y="-1.9" width="2" height="3.8" rx="0.5" fill="#5d35a6" />
            <path d="M -0.8 -1.4 L 1.9 0 L -0.8 1.4 Z" fill="#8a5fd6" />
          </g>
          <animateMotion
            ref={motionRef as React.Ref<SVGElement>}
            dur="0.95s"
            rotate="auto"
            fill="freeze"
            begin="indefinite"
            path={SCRIBBLE_PATH}
          />
        </g>
      </svg>
    </div>
  )
}

const SUGGESTIONS = [
  'Organize my Downloads folder by file type',
  'Message someone on WhatsApp',
  'Play a song',
  'Clean up my desktop',
  'Install an app for me'
]

/** Append a part to the last assistant message, or start a new assistant message. */
function appendPart(msgs: ChatMessage[], part: MessagePart): ChatMessage[] {
  const copy = [...msgs]
  const last = copy[copy.length - 1]
  if (!last || last.role !== 'assistant') {
    copy.push({ id: uid(), role: 'assistant', parts: [part] })
    return copy
  }
  const parts = [...last.parts]
  const lastPart = parts[parts.length - 1]
  if (part.kind === 'text' && lastPart?.kind === 'text') {
    parts[parts.length - 1] = { kind: 'text', text: lastPart.text + part.text }
  } else {
    parts.push(part)
  }
  copy[copy.length - 1] = { ...last, parts }
  return copy
}

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [providers, setProviders] = useState<Record<ProviderId, ProviderInfo> | null>(null)
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({})
  const [chats, setChats] = useState<ChatMeta[]>([])
  const [stats, setStats] = useState<TodayStats | null>(null)
  const [chatId, setChatId] = useState<string>(() => crypto.randomUUID())
  // Per-chat message buffers: streams keep landing in the right chat even while you browse others.
  const [store, setStore] = useState<Record<string, ChatMessage[]>>({})
  const [runningChatId, setRunningChatId] = useState<string | null>(null)
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [input, setInput] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  )
  const [inputFocused, setInputFocused] = useState(false)
  // Crayon theme transition: the NEW paper color gets scribbled over the screen,
  // the theme flips underneath, then the scribble fades away.
  const [sweep, setSweep] = useState<{ color: string; fading: boolean } | null>(null)
  const sweepBusy = useRef(false)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  // Files dropped from Finder, shown as chips above the composer until sent.
  const [droppedFiles, setDroppedFiles] = useState<string[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chatIdRef = useRef(chatId)
  const storeRef = useRef(store)
  // When each chat's current run started, so finished runs can show their total time.
  const runStartsRef = useRef<Record<string, number>>({})

  // The composer grows with its content, up to ~6 lines. scrollHeight excludes the
  // 2px borders (border-box), so add them back — otherwise every line is 4px "too
  // tall" and a scrollbar shows even for one sentence. Scrollbar only past the cap.
  const autosize = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const needed = el.scrollHeight + 4
    el.style.height = Math.min(needed, 160) + 'px'
    el.style.overflowY = needed > 160 ? 'auto' : 'hidden'
  }, [])

  const fillComposer = useCallback(
    (text: string) => {
      setInput(text)
      requestAnimationFrame(() => {
        autosize()
        inputRef.current?.focus()
      })
    },
    [autosize]
  )

  useEffect(() => {
    chatIdRef.current = chatId
  }, [chatId])

  useEffect(() => {
    storeRef.current = store
  }, [store])

  const updateChat = useCallback((id: string, fn: (msgs: ChatMessage[]) => ChatMessage[]) => {
    setStore((s) => ({ ...s, [id]: fn(s[id] ?? []) }))
  }, [])

  const refreshSettings = useCallback(async () => {
    const data = await window.shortkut.getSettings()
    setSettings(data.settings)
    setProviders(data.providers)
    setHasKey(data.hasKey)
    // settings.json is the source of truth for the theme; localStorage is just the pre-paint cache.
    const saved = data.settings.theme === 'dark' ? 'dark' : 'light'
    setTheme(saved)
    document.documentElement.dataset.theme = saved
    localStorage.setItem('sk-theme', saved)
  }, [])

  const refreshChats = useCallback(async () => {
    setChats(await window.shortkut.listChats())
  }, [])

  const refreshStats = useCallback(async () => {
    setStats(await window.shortkut.getStats())
  }, [])

  useEffect(() => {
    void refreshSettings()
    void refreshChats()
    void refreshStats()
    // Keep the "Today" card current even while idle — it visibly resets to zero
    // at midnight and clears expired rate-limit warnings without a restart.
    const t = setInterval(() => void refreshStats(), 60_000)
    return () => clearInterval(t)
  }, [refreshSettings, refreshChats, refreshStats])

  useEffect(() => {
    return window.shortkut.onAgentEvent((eventChatId: string, event: AgentEvent) => {
      switch (event.type) {
        case 'approval':
          setApprovals((q) => [...q, { id: event.id, kind: event.kind, detail: event.detail }])
          break
        case 'done': {
          const started = runStartsRef.current[eventChatId]
          if (started) {
            delete runStartsRef.current[eventChatId]
            const seconds = Math.max(1, Math.round((Date.now() - started) / 1000))
            updateChat(eventChatId, (msgs) => appendPart(msgs, { kind: 'duration', seconds }))
          }
          setRunningChatId(null)
          setApprovals([])
          void refreshChats()
          void refreshStats()
          break
        }
        case 'text':
          updateChat(eventChatId, (msgs) => appendPart(msgs, { kind: 'text', text: event.text }))
          break
        case 'tool-start':
          updateChat(eventChatId, (msgs) =>
            appendPart(msgs, { kind: 'tool', id: event.id, name: event.name, input: event.input })
          )
          break
        case 'tool-end':
          updateChat(eventChatId, (msgs) =>
            msgs.map((m) => ({
              ...m,
              parts: m.parts.map((p) =>
                p.kind === 'tool' && p.id === event.id ? { ...p, output: event.output } : p
              )
            }))
          )
          break
        case 'error':
          updateChat(eventChatId, (msgs) => appendPart(msgs, { kind: 'error', message: event.message }))
          break
      }
    })
  }, [refreshChats, refreshStats, updateChat])

  const running = runningChatId !== null
  const runningHere = runningChatId === chatId

  const send = useCallback(() => {
    const typed = input.trim()
    if ((!typed && droppedFiles.length === 0) || running) return
    const fileText = droppedFiles.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ')
    const text = [typed, fileText].filter(Boolean).join('\n')
    updateChat(chatId, (msgs) => [...msgs, { id: uid(), role: 'user', parts: [{ kind: 'text', text }] }])
    setInput('')
    setDroppedFiles([])
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.overflowY = 'hidden'
    }
    runStartsRef.current[chatId] = Date.now()
    setRunningChatId(chatId)
    window.shortkut.sendMessage(chatId, text)
  }, [input, droppedFiles, running, chatId, updateChat])

  const newChat = useCallback(() => {
    setChatId(crypto.randomUUID())
    setDroppedFiles([])
    inputRef.current?.focus()
  }, [])

  const selectChat = useCallback(async (id: string) => {
    if (id === chatIdRef.current) return
    setChatId(id)
    setDroppedFiles([])
    // Live/visited chats are already buffered; only cold chats load from disk.
    if (!(id in storeRef.current)) {
      const msgs = await window.shortkut.getChat(id)
      setStore((s) => (id in s ? s : { ...s, [id]: msgs }))
    }
  }, [])

  const renameChat = useCallback(
    async (id: string, title: string) => {
      await window.shortkut.renameChat(id, title)
      void refreshChats()
    },
    [refreshChats]
  )

  // Confirmation happens inline in the sidebar (crayon "Erase this chat?" strip).
  const deleteChat = useCallback(
    async (id: string) => {
      await window.shortkut.deleteChat(id)
      setStore((s) => {
        const { [id]: _gone, ...rest } = s
        return rest
      })
      if (id === chatIdRef.current) setChatId(crypto.randomUUID())
      void refreshChats()
    },
    [refreshChats]
  )

  const pickWorkspace = useCallback(async () => {
    const ws = await window.shortkut.pickWorkspace()
    if (ws && settings) setSettings({ ...settings, workspace: ws })
  }, [settings])

  const respondApproval = useCallback((id: string, ok: boolean) => {
    window.shortkut.respondApproval(id, ok)
    setApprovals((q) => q.filter((a) => a.id !== id))
  }, [])

  // Approvals answer to the keyboard: Enter allows, Esc denies.
  const pendingApprovalId = approvals[0]?.id ?? null
  useEffect(() => {
    if (!pendingApprovalId) return
    const onKey = (e: KeyboardEvent): void => {
      // Never hijack keys while the user is typing in the composer or an input.
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (e.key === 'Enter') {
        e.preventDefault()
        respondApproval(pendingApprovalId, true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        respondApproval(pendingApprovalId, false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingApprovalId, respondApproval])

  // Drag & drop: files from Finder become chips above the composer.
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragActive(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => {
        try {
          return window.shortkut.pathForFile(f)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
    if (!paths.length) return
    setDroppedFiles((prev) => [...prev, ...paths.filter((p) => !prev.includes(p))])
    inputRef.current?.focus()
  }, [])

  const toggleAutoMode = useCallback(() => {
    setSettings((s) => {
      if (!s) return s
      if (!s.autoMode) {
        const ok = window.confirm(
          'Turn on Auto mode?\n\nShortKut will run shell commands, delete files, and control apps WITHOUT asking you each time, until you turn Auto off. You can still hit Stop at any moment.'
        )
        if (!ok) return s
      }
      const next = { ...s, autoMode: !s.autoMode }
      void window.shortkut.saveSettings(next)
      return next
    })
  }, [])

  const applyTheme = useCallback((next: 'light' | 'dark') => {
    document.documentElement.dataset.theme = next
    localStorage.setItem('sk-theme', next)
    setTheme(next)
    setSettings((s) => {
      if (s) void window.shortkut.saveSettings({ ...s, theme: next })
      return s ? { ...s, theme: next } : s
    })
  }, [])

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      applyTheme(next)
      return
    }
    if (sweepBusy.current) return
    sweepBusy.current = true
    // A crayon scribbles the NEW paper over the screen; once covered, the theme
    // flips underneath, then the scribble sheet fades away.
    setSweep({ color: next === 'dark' ? '#201c2b' : '#f4f1ea', fading: false })
    setTimeout(() => {
      applyTheme(next)
      setSweep((s) => (s ? { ...s, fading: true } : s))
      setTimeout(() => {
        setSweep(null)
        sweepBusy.current = false
      }, 320)
    }, 950)
  }, [theme, applyTheme])

  if (!settings || !providers) return <div className="app" />

  const providerReady = !providers[settings.provider].needsKey || hasKey[settings.provider]
  const workspaceName = settings.workspace ? settings.workspace.split('/').pop() : null
  const messages = store[chatId] ?? []
  const approval = approvals[0] ?? null

  const limitedLabel = stats?.limitedProvider
    ? (providers[stats.limitedProvider as ProviderId]?.label.split(' ')[0] ?? stats.limitedProvider)
    : null

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        e.preventDefault()
        if (e.dataTransfer.types.includes('Files')) {
          dragDepth.current++
          setDragActive(true)
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragActive(false)
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <Sidebar
        chats={chats}
        currentId={chatId}
        runningChatId={runningChatId}
        onSelect={(id) => void selectChat(id)}
        onNew={newChat}
        onDelete={(id) => void deleteChat(id)}
        onRename={(id, title) => void renameChat(id, title)}
        stats={stats}
        limitedLabel={limitedLabel}
      />

      <div className="main-col">
        <header className="topbar">
          <div className="topbar-actions">
            <button
              className={`pill auto ${settings.autoMode ? 'on' : ''}`}
              onClick={toggleAutoMode}
              title={
                settings.autoMode
                  ? 'Auto mode is ON: ShortKut acts without asking. Click to turn off.'
                  : 'Auto mode: let ShortKut run commands and control apps without asking each time'
              }
            >
              <IconBolt size={13} />
              Auto
            </button>
            <button
              className="pill icon-only"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
            </button>
            <button className="pill" onClick={pickWorkspace} title={settings.workspace ?? 'Pick a workspace folder'}>
              <IconFolder size={14} />
              {workspaceName ?? 'Pick workspace'}
            </button>
            <button className="pill" onClick={() => setShowSettings(true)} title="Provider & model settings">
              <IconGear size={14} />
              {providers[settings.provider].label.split(' ')[0]} · {settings.model || 'no model'}
            </button>
          </div>
        </header>

        <main className="chat" key={chatId}>
          {messages.length === 0 ? (
            <div className="empty">
              <svg className="empty-doodle ed1" viewBox="0 0 40 40" fill="none" stroke="#c8442f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 4 L24 16 L36 16 L26 23 L30 35 L20 27 L10 35 L14 23 L4 16 L16 16 Z" /></svg>
              <svg className="empty-doodle ed2" viewBox="0 0 40 40" fill="none" stroke="#7444c8" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 28 L12 12 L20 28 L28 12 L36 28" /></svg>
              <svg className="empty-doodle ed3" viewBox="0 0 40 40" fill="none" stroke="#7444c8" strokeWidth="3" strokeLinecap="round"><path d="M20 20 m-3 0 a3 3 0 1 0 6 0 a6 6 0 1 0 -12 0 a9 9 0 1 0 18 0 a12 12 0 1 0 -24 0" /></svg>
              <svg className="empty-doodle ed4" viewBox="0 0 40 40" fill="none" stroke="#c8442f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 30 C 12 8, 26 8, 32 20" /><path d="M32 20l-7-2M32 20l1-7" /></svg>
              <div className="empty-logo">
                <Logo size={148} label animated />
              </div>
              <p>Your AI agent, entirely on your desktop. No servers, no accounts — your keys, your models, your files.</p>
              {(!providerReady || !settings.workspace) && (
                <div className="setup-card">
                  <div className="setup-title">Get set up in two crayon strokes</div>
                  <button className={`setup-step ${providerReady ? 'done' : ''}`} onClick={() => setShowSettings(true)}>
                    <svg className="setup-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M4.5 12.5l5 5L19.5 6.5" pathLength="100" /></svg>
                    <span>Add your AI — no API key? Pick Ollama: free &amp; local</span>
                  </button>
                  <button className={`setup-step ${settings.workspace ? 'done' : ''}`} onClick={pickWorkspace}>
                    <svg className="setup-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M4.5 12.5l5 5L19.5 6.5" pathLength="100" /></svg>
                    <span>Pick a workspace folder for file work</span>
                  </button>
                  <button className="setup-step" onClick={() => inputRef.current?.focus()}>
                    <svg className="setup-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M4.5 12.5l5 5L19.5 6.5" pathLength="100" /></svg>
                    <span>Give it a job in plain English</span>
                  </button>
                </div>
              )}
              {providerReady && (
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="suggestion" onClick={() => fillComposer(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Messages
              messages={messages}
              running={runningHere}
              onEditPrompt={fillComposer}
              runStartedAt={runStartsRef.current[chatId]}
            />
          )}
        </main>

        <footer className="composer">
          {droppedFiles.length > 0 && (
            <div className="file-chips">
              {droppedFiles.map((p) => (
                <span key={p} className="file-chip" title={p}>
                  <IconFolder size={11} />
                  {p.split('/').pop()}
                  <button
                    className="file-chip-x"
                    title="Remove"
                    onClick={() => setDroppedFiles((prev) => prev.filter((x) => x !== p))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            placeholder={
              !providerReady
                ? 'Add a provider in settings first'
                : running && !runningHere
                  ? 'Working in another chat — wait or stop it first'
                  : 'Ask ShortKut to do something…'
            }
            disabled={!providerReady}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value)
              autosize()
            }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          {inputFocused && input.trim() && !running && (
            <span className="composer-hint">⏎ send · ⇧⏎ new line</span>
          )}
          {running ? (
            <button
              className="send stop"
              onClick={() => window.shortkut.stop()}
              title={runningHere ? 'Stop ShortKut' : 'Stop the run happening in the other chat'}
            >
              <IconStop size={13} />
              Stop
            </button>
          ) : (
            <button
              className="send"
              onClick={send}
              disabled={(!input.trim() && droppedFiles.length === 0) || !providerReady}
            >
              <IconSend size={14} />
              Send
            </button>
          )}
        </footer>
      </div>

      {approval && (
        <div className="modal-backdrop">
          <div className="modal approval">
            <div className="approval-head">
              <span className={`approval-badge ${APPROVAL_COPY[approval.kind].danger ? 'danger' : ''}`}>
                {(() => {
                  const Icon = APPROVAL_COPY[approval.kind].Icon
                  return <Icon size={17} />
                })()}
              </span>
              <h2>{APPROVAL_COPY[approval.kind].title}</h2>
            </div>
            <pre className="approval-detail">{approval.detail}</pre>
            <p className="approval-note">
              {APPROVAL_COPY[approval.kind].note(settings.workspace)}
              {approvals.length > 1 && ` (${approvals.length - 1} more pending)`}
            </p>
            <div className="modal-buttons">
              <button className="btn ghost" onClick={() => respondApproval(approval.id, false)}>
                Deny
              </button>
              <button className="btn danger" onClick={() => respondApproval(approval.id, true)}>
                {APPROVAL_COPY[approval.kind].confirm}
              </button>
            </div>
            <div className="approval-keys">⏎ allow · esc deny</div>
          </div>
        </div>
      )}

      {dragActive && (
        <div className="drop-overlay">
          <div className="drop-inner">
            <IconFolder size={30} />
            Drop it — ShortKut will take it from here
          </div>
        </div>
      )}

      {sweep && <ThemeScribble color={sweep.color} fading={sweep.fading} />}

      {showSettings && (
        <SettingsModal
          settings={settings}
          providers={providers}
          hasKey={hasKey}
          onClose={() => setShowSettings(false)}
          onSaved={() => void refreshSettings()}
        />
      )}
    </div>
  )
}
