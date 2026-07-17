import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ModelMessage } from 'ai'

export interface StoredChat {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ModelMessage[]
}

export interface ChatMeta {
  id: string
  title: string
  updatedAt: number
}

interface DisplayPart {
  kind: 'text' | 'tool'
  text?: string
  id?: string
  name?: string
  input?: unknown
  output?: string
}

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  parts: DisplayPart[]
}

function chatsDir(): string {
  const dir = path.join(app.getPath('userData'), 'chats')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function chatPath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9-]/g, '')
  if (!safe) throw new Error('Invalid chat id')
  return path.join(chatsDir(), `${safe}.json`)
}

export function loadChatFile(id: string): StoredChat | null {
  try {
    return JSON.parse(fs.readFileSync(chatPath(id), 'utf8'))
  } catch {
    return null
  }
}

export function saveChatFile(id: string, messages: ModelMessage[]): void {
  if (messages.length === 0) return
  const existing = loadChatFile(id)
  const firstUser = messages.find((m) => m.role === 'user')
  const title =
    typeof firstUser?.content === 'string'
      ? firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat'
      : 'New chat'
  const now = Date.now()
  const chat: StoredChat = {
    id,
    title: existing?.title ?? title,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages
  }
  fs.writeFileSync(chatPath(id), JSON.stringify(chat))
}

export function listChats(): ChatMeta[] {
  const metas: ChatMeta[] = []
  for (const file of fs.readdirSync(chatsDir())) {
    if (!file.endsWith('.json')) continue
    try {
      const chat = JSON.parse(fs.readFileSync(path.join(chatsDir(), file), 'utf8')) as StoredChat
      metas.push({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt })
    } catch {
      // skip corrupt files
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function deleteChatFile(id: string): void {
  fs.rmSync(chatPath(id), { force: true })
}

/** User-chosen titles stick: saveChatFile always keeps an existing title. */
export function renameChat(id: string, title: string): void {
  const chat = loadChatFile(id)
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!chat || !clean) return
  chat.title = clean
  fs.writeFileSync(chatPath(id), JSON.stringify(chat))
}

/** One-time hygiene at startup: remove screenshot data from any chat saved by older versions. */
export function scrubStoredScreenshots(): void {
  for (const file of fs.readdirSync(chatsDir())) {
    if (!file.endsWith('.json')) continue
    const full = path.join(chatsDir(), file)
    try {
      const chat = JSON.parse(fs.readFileSync(full, 'utf8')) as StoredChat
      let changed = false
      for (const m of chat.messages) {
        if (m.role !== 'tool' || !Array.isArray(m.content)) continue
        for (const part of m.content as any[]) {
          const output = part?.output
          if (part?.type !== 'tool-result' || output?.type !== 'content' || !Array.isArray(output.value)) continue
          if (!output.value.some((v: any) => v?.type === 'media')) continue
          part.output = { type: 'text', value: '[screenshot removed after the task finished]' }
          changed = true
        }
      }
      if (changed) fs.writeFileSync(full, JSON.stringify(chat))
    } catch {
      // skip corrupt files
    }
  }
}

/** Convert stored model messages back into the renderer's display shape. */
export function toDisplay(messages: ModelMessage[]): DisplayMessage[] {
  const out: DisplayMessage[] = []
  const toolParts = new Map<string, DisplayPart>()

  const textOf = (content: unknown): string => {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((p) => p?.type === 'text')
        .map((p) => p.text)
        .join('')
    }
    return ''
  }

  for (const m of messages) {
    if (m.role === 'user') {
      const text = textOf(m.content)
      if (text) out.push({ id: `h${out.length}`, role: 'user', parts: [{ kind: 'text', text }] })
    } else if (m.role === 'assistant') {
      const parts: DisplayPart[] = []
      if (typeof m.content === 'string') {
        if (m.content.trim()) parts.push({ kind: 'text', text: m.content })
      } else {
        for (const p of m.content) {
          if (p.type === 'text' && p.text.trim()) {
            parts.push({ kind: 'text', text: p.text })
          } else if (p.type === 'tool-call') {
            const part: DisplayPart = { kind: 'tool', id: p.toolCallId, name: p.toolName, input: p.input }
            toolParts.set(p.toolCallId, part)
            parts.push(part)
          }
        }
      }
      if (parts.length) out.push({ id: `h${out.length}`, role: 'assistant', parts })
    } else if (m.role === 'tool') {
      for (const p of m.content) {
        if (p.type !== 'tool-result') continue
        const target = toolParts.get(p.toolCallId)
        if (!target) continue
        const output = (p as any).output
        if (output?.type === 'content' && Array.isArray(output.value)) {
          // Media outputs (screenshots) must not dump base64 into the UI.
          const texts = output.value.filter((v: any) => v?.type === 'text').map((v: any) => v.text)
          const hasMedia = output.value.some((v: any) => v?.type === 'media')
          target.output = [hasMedia ? '[screenshot]' : '', ...texts].filter(Boolean).join('\n')
        } else {
          const value = output && typeof output === 'object' && 'value' in output ? output.value : output
          target.output = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        }
      }
    }
  }
  return out
}
