import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatMessage, MessagePart } from './types'
import {
  IconAutomation,
  IconCheck,
  IconClock,
  IconCopy,
  IconCursor,
  IconEye,
  IconFile,
  IconFolder,
  IconFolderPlus,
  IconGear,
  IconLaunch,
  IconMove,
  IconPencil,
  IconSend,
  IconTerminal,
  IconTrash,
  IconUser
} from './Icons'

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

marked.setOptions({ breaks: true })
// Code blocks get a copy button; the actual copying is event-delegated in Markdown below.
marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
      return `<div class="codewrap"><button class="code-copy" type="button">Copy</button><pre><code${cls}>${escapeHtml(text)}</code></pre></div>`
    }
  }
})

function Markdown({ text }: { text: string }): React.JSX.Element {
  const html = DOMPurify.sanitize(marked.parse(text, { async: false }) as string)

  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const btn = (e.target as HTMLElement).closest?.('button.code-copy')
    if (!(btn instanceof HTMLButtonElement)) return
    const code = btn.parentElement?.querySelector('pre')?.innerText ?? ''
    void navigator.clipboard.writeText(code)
    btn.textContent = 'Copied!'
    btn.classList.add('done')
    setTimeout(() => {
      btn.textContent = 'Copy'
      btn.classList.remove('done')
    }, 1200)
  }

  return <div className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}

interface ToolMeta {
  Icon: (p: { size?: number }) => React.JSX.Element
  label: string
}

const TOOL_META: Record<string, ToolMeta> = {
  list_files: { Icon: IconFolder, label: 'Listed' },
  read_file: { Icon: IconFile, label: 'Read' },
  write_file: { Icon: IconPencil, label: 'Wrote' },
  move_file: { Icon: IconMove, label: 'Moved' },
  make_dir: { Icon: IconFolderPlus, label: 'Created folder' },
  delete_file: { Icon: IconTrash, label: 'Deleted' },
  run_command: { Icon: IconTerminal, label: 'Ran' },
  open_app: { Icon: IconLaunch, label: 'Opened' },
  applescript: { Icon: IconAutomation, label: 'Automation' },
  screenshot: { Icon: IconEye, label: 'Looked at the screen' },
  read_screen: { Icon: IconEye, label: 'Read the screen' },
  computer_click: { Icon: IconCursor, label: 'Clicked' },
  computer_type: { Icon: IconPencil, label: 'Typed' },
  computer_key: { Icon: IconAutomation, label: 'Pressed' },
  wait: { Icon: IconClock, label: 'Waited' },
  open_url: { Icon: IconLaunch, label: 'Opened' },
  find_contact: { Icon: IconUser, label: 'Looked up contact' },
  send_whatsapp: { Icon: IconSend, label: 'WhatsApp message to' }
}

function toolSummary(name: string, input: unknown): { meta: ToolMeta; text: string } {
  const i = (input ?? {}) as Record<string, unknown>
  const meta = TOOL_META[name] ?? { Icon: IconGear, label: name }
  const target =
    i.command ??
    i.path ??
    i.name ??
    i.url ??
    i.app ??
    i.phone ??
    i.description ??
    i.text ??
    i.key ??
    (typeof i.seconds === 'number'
      ? `${i.seconds}s`
      : i.from && i.to
        ? `${i.from} → ${i.to}`
        : typeof i.x === 'number'
          ? `(${i.x}, ${i.y})`
          : '')
  return { meta, text: `${meta.label} ${String(target)}`.trim() }
}

const fmtDuration = (s: number): string => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`)

function Part({ part }: { part: MessagePart }): React.JSX.Element | null {
  if (part.kind === 'text') {
    return part.text.trim() ? <Markdown text={part.text} /> : null
  }
  if (part.kind === 'error') {
    return <div className="error-part">{part.message}</div>
  }
  if (part.kind === 'duration') {
    return (
      <div className="duration-line">
        <IconClock size={12} />
        Took {fmtDuration(part.seconds)}
      </div>
    )
  }
  const { meta, text } = toolSummary(part.name, part.input)
  return (
    <details className="tool-chip">
      <summary>
        <meta.Icon size={14} />
        <span className="tool-summary-text">{text}</span>
        {part.output === undefined && <span className="tool-spinner" />}
      </summary>
      <div className="tool-detail">
        <div className="tool-detail-label">Input</div>
        <pre>{JSON.stringify(part.input, null, 2)}</pre>
        {part.output !== undefined && (
          <>
            <div className="tool-detail-label">Output</div>
            <pre>{part.output.length > 4000 ? part.output.slice(0, 4000) + '\n…' : part.output}</pre>
          </>
        )}
      </div>
    </details>
  )
}

/* Long tool runs collapse into one strip so replies stay readable: any run of 4+
 * consecutive finished tool chips folds up, but the last 2 parts of a message
 * always stay visible so fresh chips keep streaming in the open. */
type RenderItem =
  | { type: 'part'; part: MessagePart; idx: number }
  | { type: 'group'; parts: { part: MessagePart; idx: number }[] }

function groupParts(parts: MessagePart[]): RenderItem[] {
  const items: RenderItem[] = []
  let run: { part: MessagePart; idx: number }[] = []
  const flush = (): void => {
    if (run.length >= 4) items.push({ type: 'group', parts: run })
    else for (const r of run) items.push({ type: 'part', part: r.part, idx: r.idx })
    run = []
  }
  parts.forEach((part, idx) => {
    if (part.kind === 'tool' && part.output !== undefined && idx < parts.length - 2) {
      run.push({ part, idx })
    } else {
      flush()
      items.push({ type: 'part', part, idx })
    }
  })
  flush()
  return items
}

function AssistantBody({ parts }: { parts: MessagePart[] }): React.JSX.Element {
  return (
    <div className="assistant-body">
      {groupParts(parts).map((item) =>
        item.type === 'part' ? (
          <Part key={item.idx} part={item.part} />
        ) : (
          <details key={`g${item.parts[0].idx}`} className="tool-group">
            <summary>
              <IconGear size={13} />
              Worked through {item.parts.length} steps
            </summary>
            <div className="tool-group-body">
              {item.parts.map(({ part, idx }) => (
                <Part key={idx} part={part} />
              ))}
            </div>
          </details>
        )
      )}
    </div>
  )
}

/* The live status line: self-drawing scribble logo + what's happening right now + elapsed time.
 * startedAt anchors the timer to the real run start, so switching chats mid-run
 * (which remounts this component) doesn't reset the clock to 0:00. */
function WorkingLine({ activity, startedAt }: { activity: string | null; startedAt?: number }): React.JSX.Element {
  const startRef = useRef(startedAt ?? Date.now())
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - startRef.current) / 1000)))

  useEffect(() => {
    const t = setInterval(
      () => setElapsed(Math.max(0, Math.floor((Date.now() - startRef.current) / 1000))),
      1000
    )
    return () => clearInterval(t)
  }, [])

  const mins = Math.floor(elapsed / 60)
  const secs = String(elapsed % 60).padStart(2, '0')

  return (
    <div className="thinking">
      <svg className="working-logo" width="20" height="20" viewBox="0 0 120 120">
        <g fill="none" stroke="currentColor" strokeLinecap="round">
          <ellipse className="s1" cx="60" cy="60" rx="40" ry="36" strokeWidth="10" transform="rotate(18 60 60)" pathLength="100" />
          <ellipse className="s2" cx="59" cy="61" rx="34" ry="40" strokeWidth="9" transform="rotate(-24 60 60)" pathLength="100" />
          <ellipse className="s3" cx="60" cy="60" rx="25" ry="22" strokeWidth="11" transform="rotate(-40 60 60)" pathLength="100" />
        </g>
      </svg>
      <span className="working-text">{activity ?? 'Thinking…'}</span>
      <span className="working-time">
        {mins}:{secs}
      </span>
    </div>
  )
}

/** What ShortKut is doing right now: the newest tool call still waiting on its result. */
function currentActivity(messages: ChatMessage[]): string | null {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return null
  for (let i = last.parts.length - 1; i >= 0; i--) {
    const p = last.parts[i]
    if (p.kind === 'tool' && p.output === undefined) {
      return toolSummary(p.name, p.input).text + '…'
    }
  }
  return null
}

function UserMessage({ text, onEdit }: { text: string; onEdit: (text: string) => void }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="user-wrap">
      <div className="user-bubble">{text}</div>
      <div className="msg-actions">
        <button className="msg-action" title={copied ? 'Copied' : 'Copy'} onClick={copy}>
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
        </button>
        <button className="msg-action" title="Edit in composer" onClick={() => onEdit(text)}>
          <IconPencil size={12} />
        </button>
      </div>
    </div>
  )
}

export default function Messages({
  messages,
  running,
  onEditPrompt,
  runStartedAt
}: {
  messages: ChatMessage[]
  running: boolean
  onEditPrompt: (text: string) => void
  runStartedAt?: number
}): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const [hasNew, setHasNew] = useState(false)

  // The scrollable element is the parent (.chat). Follow output only while the
  // user is at the bottom — scrolling up to read must never get yanked back down.
  useEffect(() => {
    const scroller = wrapRef.current?.parentElement
    if (!scroller) return
    const onScroll = (): void => {
      const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
      pinnedRef.current = nearBottom
      if (nearBottom) setHasNew(false)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (pinnedRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    else setHasNew(true)
  }, [messages, running])

  const jumpToBottom = (): void => {
    pinnedRef.current = true
    setHasNew(false)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="messages" ref={wrapRef}>
      {messages.map((m) => (
        <div key={m.id} className={`message ${m.role}`}>
          {m.role === 'user' ? (
            <UserMessage text={m.parts[0].kind === 'text' ? m.parts[0].text : ''} onEdit={onEditPrompt} />
          ) : (
            <AssistantBody parts={m.parts} />
          )}
        </div>
      ))}
      {running && <WorkingLine activity={currentActivity(messages)} startedAt={runStartedAt} />}
      {hasNew && (
        <button className="scroll-pill" onClick={jumpToBottom}>
          ↓ new
        </button>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
