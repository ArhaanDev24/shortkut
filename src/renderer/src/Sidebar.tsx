import { useEffect, useRef, useState } from 'react'
import Logo from './Logo'
import { IconBolt, IconCheck, IconClock, IconPlus, IconX } from './Icons'
import type { ChatMeta, TodayStats } from './types'

const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)

const fmtWorked = (s: number): string => {
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Little pink-tipped eraser that sweeps across a row being deleted. */
function Eraser(): React.JSX.Element {
  return (
    <span className="eraser" aria-hidden="true">
      <svg width="26" height="16" viewBox="0 0 26 16">
        <g transform="rotate(-10 13 8)">
          <rect x="1" y="3" width="24" height="11" rx="3" fill="#e8a09a" stroke="#38304a" strokeWidth="1.5" />
          <rect x="1" y="3" width="9" height="11" rx="3" fill="#c8442f" stroke="#38304a" strokeWidth="1.5" />
        </g>
      </svg>
      <i className="crumb c1" />
      <i className="crumb c2" />
      <i className="crumb c3" />
    </span>
  )
}

export default function Sidebar({
  chats,
  currentId,
  runningChatId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  stats,
  limitedLabel
}: {
  chats: ChatMeta[]
  currentId: string
  runningChatId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  stats: TodayStats | null
  limitedLabel: string | null
}): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  // A set, so erasing several chats in quick succession keeps every animation alive.
  const [erasingIds, setErasingIds] = useState<ReadonlySet<string>>(new Set())
  const eraseTimers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    return () => {
      for (const t of eraseTimers.current) clearTimeout(t)
    }
  }, [])

  const commit = (id: string): void => {
    setEditingId(null)
    const clean = draft.trim()
    if (clean) onRename(id, clean)
  }

  const startErase = (id: string): void => {
    setConfirmId(null)
    setErasingIds((s) => new Set(s).add(id))
    // The delete lands after the eraser has swept and the row collapsed.
    eraseTimers.current.push(
      setTimeout(() => {
        setErasingIds((s) => {
          const next = new Set(s)
          next.delete(id)
          return next
        })
        onDelete(id)
      }, 660)
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <Logo size={28} />
        <span className="sidebar-title">ShortKut</span>
      </div>

      <button className="new-chat" onClick={onNew}>
        <IconPlus size={14} />
        New chat
      </button>

      <div className="chat-list">
        {chats.length === 0 && <div className="chat-list-empty">Your chats will appear here</div>}
        {chats.map((c) => {
          const erasing = erasingIds.has(c.id)
          if (confirmId === c.id && !erasing) {
            return (
              <div key={c.id} className="chat-item confirm" onClick={(e) => e.stopPropagation()}>
                <span className="confirm-text">Erase this chat?</span>
                <button className="confirm-btn erase" onClick={() => startErase(c.id)}>
                  Erase
                </button>
                <button className="confirm-btn keep" onClick={() => setConfirmId(null)}>
                  Keep
                </button>
              </div>
            )
          }
          return (
            <div
              key={c.id}
              className={`chat-item ${c.id === currentId ? 'active' : ''} ${erasing ? 'erasing' : ''}`}
              onClick={() => {
                if (erasing) return
                setConfirmId(null)
                onSelect(c.id)
              }}
            >
              {c.id === runningChatId && <span className="chat-running" title="Agent is working here" />}
              {editingId === c.id ? (
                <input
                  className="chat-rename"
                  value={draft}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => commit(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(c.id)
                    else if (e.key === 'Escape') setEditingId(null)
                  }}
                />
              ) : (
                <span
                  className="chat-title"
                  title={`${c.title} — double-click to rename`}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setDraft(c.title)
                    setEditingId(c.id)
                  }}
                >
                  {c.title}
                </span>
              )}
              <span className="chat-time">{relativeTime(c.updatedAt)}</span>
              <button
                className="chat-del"
                title="Delete chat"
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmId(c.id)
                  setEditingId(null)
                }}
              >
                <IconX size={11} />
              </button>
              {erasing && <Eraser />}
            </div>
          )
        })}
      </div>

      {stats && (
        <div className="sidebar-today" title={`${stats.requests} model requests today`}>
          <div className="today-title">Today with ShortKut</div>
          <div className="today-stats">
            <span className="today-stat" title="Tasks finished today">
              <IconCheck size={11} />
              {stats.tasks} {stats.tasks === 1 ? 'task' : 'tasks'}
            </span>
            <span className="today-stat" title="Time ShortKut worked for you today">
              <IconClock size={11} />
              {fmtWorked(stats.seconds)}
            </span>
            <span className="today-stat" title="Tokens sent to your model today">
              <IconBolt size={11} />
              {fmtTokens(stats.tokens)} tok
            </span>
          </div>
          {limitedLabel && (
            <div className="today-warning" title="The provider rejected recent requests. It usually recovers within a few minutes.">
              {limitedLabel} is rate-limited right now
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
