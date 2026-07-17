import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Local "today" stats. Providers don't let an API key query real quota usage,
 * so instead of pretending, ShortKut shows what it knows to be true: how many
 * tasks it ran today, how long it worked, and how many tokens it sent — plus
 * a live warning when a provider is actively rejecting requests.
 */

interface DayUsage {
  requests: number
  tokens: number
  tasks: number
  seconds: number
  /** Last time the provider itself rejected us with a rate-limit/quota error. */
  limitHitAt?: number
}

interface UsageFile {
  day: string
  providers: Record<string, DayUsage>
}

export interface TodayStats {
  tasks: number
  seconds: number
  tokens: number
  requests: number
  /** Provider id currently rejecting requests (rate limit), or null. */
  limitedProvider: string | null
}

function usagePath(): string {
  return path.join(app.getPath('userData'), 'usage.json')
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const EMPTY: DayUsage = { requests: 0, tokens: 0, tasks: 0, seconds: 0 }

function loadUsage(): UsageFile {
  try {
    const raw = JSON.parse(fs.readFileSync(usagePath(), 'utf8')) as UsageFile
    if (raw.day === today() && raw.providers) return raw
  } catch {
    // fresh file
  }
  return { day: today(), providers: {} }
}

function saveUsage(usage: UsageFile): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(usagePath(), JSON.stringify(usage))
  } catch {
    // metering must never break a run
  }
}

function bump(provider: string, fn: (u: DayUsage) => void): void {
  const usage = loadUsage()
  const entry = { ...EMPTY, ...usage.providers[provider] }
  fn(entry)
  usage.providers[provider] = entry
  saveUsage(usage)
}

/** One model request finished (a step in a run). */
export function recordUsage(provider: string, requests: number, tokens: number): void {
  bump(provider, (u) => {
    u.requests += requests
    u.tokens += tokens
  })
}

/** One whole task (run) finished, however it ended. */
export function recordRun(provider: string, seconds: number): void {
  bump(provider, (u) => {
    u.tasks += 1
    u.seconds += Math.max(0, Math.round(seconds))
  })
}

export function recordLimitHit(provider: string): void {
  bump(provider, (u) => {
    u.limitHitAt = Date.now()
  })
}

// How long a provider rejection keeps the warning up. Per-minute caps recover
// fast; exhausted daily quotas re-trigger the flag on the next attempt anyway.
const LIMIT_HIT_WINDOW_MS = 15 * 60 * 1000

export function getTodayStats(): TodayStats {
  const usage = loadUsage()
  const stats: TodayStats = { tasks: 0, seconds: 0, tokens: 0, requests: 0, limitedProvider: null }
  for (const [provider, u] of Object.entries(usage.providers)) {
    stats.tasks += u.tasks ?? 0
    stats.seconds += u.seconds ?? 0
    stats.tokens += u.tokens ?? 0
    stats.requests += u.requests ?? 0
    if (u.limitHitAt && Date.now() - u.limitHitAt < LIMIT_HIT_WINDOW_MS) {
      stats.limitedProvider = provider
    }
  }
  return stats
}
