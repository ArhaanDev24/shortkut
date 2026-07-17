export type ProviderId = 'anthropic' | 'openai' | 'google' | 'mistral' | 'ollama' | 'custom'

export interface Settings {
  provider: ProviderId
  model: string
  baseUrl: string
  workspace: string | null
  theme: 'light' | 'dark'
  autoMode: boolean
}

export interface ProviderInfo {
  label: string
  model: string
  baseUrl: string
  needsKey: boolean
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool-start'; id: string; name: string; input: unknown }
  | { type: 'tool-end'; id: string; output: string }
  | { type: 'approval'; id: string; kind: 'command' | 'delete' | 'automation'; detail: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; output?: string }
  | { kind: 'error'; message: string }
  // Display-only: how long the run took, appended when a task finishes or fails.
  | { kind: 'duration'; seconds: number }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  parts: MessagePart[]
}

export interface ChatMeta {
  id: string
  title: string
  updatedAt: number
}

export interface TodayStats {
  tasks: number
  seconds: number
  tokens: number
  requests: number
  limitedProvider: string | null
}

export interface ShortKutApi {
  getSettings: () => Promise<{
    settings: Settings
    hasKey: Record<string, boolean>
    providers: Record<ProviderId, ProviderInfo>
  }>
  saveSettings: (settings: Settings) => Promise<void>
  setApiKey: (provider: string, key: string) => Promise<Record<string, boolean>>
  pickWorkspace: () => Promise<string | null>
  listOllamaModels: (baseUrl: string) => Promise<string[]>
  testConnection: (settings: Settings, key: string | null) => Promise<{ ok: boolean; message: string }>
  permissionsStatus: () => Promise<{ platform: string; accessibility: boolean; screen: boolean }>
  requestPermission: (
    kind: 'accessibility' | 'automation' | 'screen'
  ) => Promise<{ granted: boolean; message: string }>
  listChats: () => Promise<ChatMeta[]>
  getChat: (id: string) => Promise<ChatMessage[]>
  deleteChat: (id: string) => Promise<void>
  renameChat: (id: string, title: string) => Promise<void>
  getStats: () => Promise<TodayStats>
  pathForFile: (file: File) => string
  sendMessage: (chatId: string, text: string) => void
  stop: () => void
  respondApproval: (id: string, approved: boolean) => void
  onAgentEvent: (cb: (chatId: string, event: AgentEvent) => void) => () => void
}

declare global {
  interface Window {
    shortkut: ShortKutApi
  }
}
