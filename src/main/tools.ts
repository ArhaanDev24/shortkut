import { tool } from 'ai'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import { exec, execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import { screen } from 'electron'
import { beginActivity, endActivity } from './overlay'

const execFileP = promisify(execFile)

const AUTOMATION_BLOCKED =
  'macOS blocked this: ShortKut does not have Automation permission for that app yet. ' +
  'Tell the user to open ShortKut Settings → "macOS control permissions" and click Grant next to Automation ' +
  '(or enable it in System Settings → Privacy & Security → Automation). Then they can ask again.'

const ACCESSIBILITY_BLOCKED =
  'macOS blocked this: keystrokes and UI clicking need Accessibility permission. ' +
  'Tell the user to open ShortKut Settings → "macOS control permissions" and click Grant next to Accessibility. ' +
  'Then they can ask again.'

function runAppleScript(
  script: string,
  abortSignal?: AbortSignal,
  language: 'applescript' | 'javascript' = 'applescript'
): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'osascript',
      language === 'javascript' ? ['-l', 'JavaScript', '-e', script] : ['-e', script],
      { timeout: 60_000, maxBuffer: 1_000_000, signal: abortSignal },
      (error, stdout, stderr) => {
        const err = stderr.trim()
        if (error && /-1743|not authorized|authorised/i.test(err)) return resolve(AUTOMATION_BLOCKED)
        if (error && /assistive access|-25211|accessibility/i.test(err)) return resolve(ACCESSIBILITY_BLOCKED)
        const parts: string[] = []
        if (stdout.trim()) parts.push(stdout.trim())
        if (error && error.killed) parts.push('[automation timed out after 60s]')
        else if (error) parts.push(`[error] ${err || error.message}`)
        else if (err) parts.push(`[stderr] ${err}`)
        resolve(parts.join('\n').slice(0, 8_000) || 'Done (no output).')
      }
    )
  })
}

/** Screenshots are downscaled to save tokens; clicks are mapped back to real screen points.
 * lastShot maps image pixels → screen points: screenPoint = origin + imagePixel * scale. */
const MAX_SHOT_WIDTH = 1024
let lastShot = { originX: 0, originY: 0, scale: 1 }

const KEY_CODES: Record<string, number> = {
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  left: 123,
  right: 124,
  down: 125,
  up: 126
}

/* macOS virtual key codes for character keys (US layout) — lets us send real CGEvents for shortcuts. */
const CHAR_KEY_CODES: Record<string, number> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14,
  r: 15, y: 16, t: 17, '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23, '=': 24, '9': 25,
  '7': 26, '-': 27, '8': 28, '0': 29, ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35, l: 37,
  j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46, '.': 47, '`': 50
}

const MODIFIER_FLAGS: Record<string, number> = {
  command: 0x100000,
  shift: 0x20000,
  control: 0x40000,
  option: 0x80000
}

/** Recently sent messages per number — used to catch accidental duplicate sends. */
const recentSends = new Map<string, { message: string; at: number }>()

/** Typing/Return inside these apps can send messages — always confirm with the user, even in Auto mode. */
const MESSAGING_APPS = ['whatsapp', 'messages', 'telegram', 'signal', 'discord', 'slack', 'messenger', 'instagram']

async function frontmostMessagingApp(abortSignal?: AbortSignal): Promise<string | null> {
  const front = (
    await runAppleScript(
      'tell application "System Events" to get name of first process whose frontmost is true',
      abortSignal
    )
  )
    .trim()
    .toLowerCase()
  return MESSAGING_APPS.find((a) => front.includes(a)) ?? null
}

function setClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('pbcopy')
    p.on('close', () => resolve())
    p.on('error', reject)
    p.stdin.end(text)
  })
}

/** JXA that posts a real CGEvent mouse click at screen-point coordinates. */
function jxaClick(px: number, py: number, double: boolean): string {
  return `ObjC.import('CoreGraphics');
var pt = $.CGPointMake(${px}, ${py});
function post(type, state) { var e = $.CGEventCreateMouseEvent($.nil, type, pt, 0); if (state > 0) { $.CGEventSetIntegerValueField(e, 1, state); } $.CGEventPost(0, e); }
post(5, 0);
$.NSThread.sleepForTimeInterval(0.06);
post(1, 1); post(2, 1);
${double ? '$.NSThread.sleepForTimeInterval(0.12); post(1, 2); post(2, 2);' : ''}
'ok';`
}

/** JXA that posts a real CGEvent key press. */
function jxaKey(code: number, flags: number): string {
  return `ObjC.import('CoreGraphics');
var d = $.CGEventCreateKeyboardEvent($.nil, ${code}, true);
var u = $.CGEventCreateKeyboardEvent($.nil, ${code}, false);
${flags ? `$.CGEventSetFlags(d, ${flags}); $.CGEventSetFlags(u, ${flags});` : ''}
$.CGEventPost(0, d);
$.NSThread.sleepForTimeInterval(0.03);
$.CGEventPost(0, u);
'ok';`
}

interface AppWindow {
  id: number
  x: number
  y: number
  w: number
  h: number
}

/** Find the largest on-screen window belonging to an app, so we can capture just that window. */
async function findAppWindow(appName: string, abortSignal?: AbortSignal): Promise<AppWindow | null> {
  const jxa = `ObjC.import('CoreGraphics');
ObjC.bindFunction('CGWindowListCopyWindowInfo', ['id', ['unsigned int', 'unsigned int']]);
var list = $.CGWindowListCopyWindowInfo(17, 0);
var best = null;
for (var i = 0; i < list.count; i++) {
  var d = list.objectAtIndex(i);
  var owner = d.objectForKey('kCGWindowOwnerName');
  var layer = d.objectForKey('kCGWindowLayer');
  if (owner.isNil() || layer.js != 0) continue;
  if (owner.js !== ${JSON.stringify(appName)}) continue;
  var b = d.objectForKey('kCGWindowBounds');
  var area = b.objectForKey('Width').js * b.objectForKey('Height').js;
  if (!best || area > best.area) best = { id: d.objectForKey('kCGWindowNumber').js, x: b.objectForKey('X').js, y: b.objectForKey('Y').js, w: b.objectForKey('Width').js, h: b.objectForKey('Height').js, area: area };
}
best ? JSON.stringify(best) : 'none';`
  try {
    const out = await runAppleScript(jxa, abortSignal, 'javascript')
    const parsed = JSON.parse(out)
    return parsed && parsed.id && parsed.w > 50 ? parsed : null
  } catch {
    return null
  }
}

/** Bring an app to the front and wait until it is ACTUALLY frontmost and freshly rendered.
 * Backgrounded apps keep stale window buffers (and pause syncing), so capturing without this
 * shows old content. */
async function activateApp(appName: string, abortSignal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => execFile('open', ['-a', appName], () => resolve()))
  for (let i = 0; i < 8; i++) {
    const front = await runAppleScript(
      'tell application "System Events" to get name of first process whose frontmost is true',
      abortSignal
    )
    if (front.trim().toLowerCase() === appName.toLowerCase()) break
    await sleep(500, abortSignal)
  }
  // Frontmost is not enough — give it a moment to sync new content and repaint.
  await sleep(1500, abortSignal)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

export interface ApprovalRequest {
  kind: 'command' | 'delete' | 'automation'
  detail: string
  /** When true, the user must approve even in Auto mode (e.g. unverified message recipients). */
  force?: boolean
}

export interface ToolContext {
  workspace: string | null
  requestApproval: (req: ApprovalRequest) => Promise<boolean>
  /** Has the user already confirmed this message recipient in this chat session? */
  isRecipientKnown?: (digits: string) => boolean
  rememberRecipient?: (digits: string) => void
}

// Token economy: many users run ShortKut on free API tiers, so tool outputs are
// capped hard — a single unbounded file read or command dump can eat more tokens
// than the rest of the task combined.
const MAX_READ_BYTES = 24_000
const MAX_LIST_ENTRIES = 250

function resolveInWorkspace(ctx: ToolContext, p: string): string {
  if (!ctx.workspace) {
    throw new Error('No workspace folder is set. Ask the user to pick one via the folder button in the top bar.')
  }
  const resolved = path.resolve(ctx.workspace, p)
  if (resolved !== ctx.workspace && !resolved.startsWith(ctx.workspace + path.sep)) {
    throw new Error(`Path "${p}" is outside the workspace folder. Only paths inside the workspace are allowed.`)
  }
  return resolved
}

export function buildTools(ctx: ToolContext) {
  return {
    list_files: tool({
      description:
        'List files and folders in the workspace. Directories end with "/". Use path "." for the workspace root.',
      inputSchema: z.object({
        path: z.string().describe('Directory path relative to the workspace root, e.g. "." or "docs"'),
        recursive: z.boolean().optional().describe('List the full tree recursively')
      }),
      execute: async ({ path: p, recursive }) => {
        const dir = resolveInWorkspace(ctx, p)
        const entries = await fs.readdir(dir, { withFileTypes: true, recursive: !!recursive })
        const lines: string[] = []
        let truncated = false
        for (const e of entries) {
          const parent = path.relative(dir, e.parentPath ?? dir)
          const rel = parent ? path.join(parent, e.name) : e.name
          const segments = rel.split(path.sep)
          if (e.name === '.DS_Store') continue
          // Never descend into VCS metadata or dependency folders.
          if (segments.includes('.git') || segments.slice(0, -1).includes('node_modules')) continue
          if (lines.length >= MAX_LIST_ENTRIES) {
            truncated = true
            break
          }
          lines.push(e.isDirectory() ? rel + '/' : rel)
        }
        if (lines.length === 0) return '(empty directory)'
        return lines.join('\n') + (truncated ? `\n…truncated at ${MAX_LIST_ENTRIES} entries` : '')
      }
    }),

    read_file: tool({
      description: 'Read a text file from the workspace.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to the workspace root')
      }),
      execute: async ({ path: p }) => {
        const file = resolveInWorkspace(ctx, p)
        const stat = await fs.stat(file)
        if (stat.size > MAX_READ_BYTES) {
          const fh = await fs.open(file, 'r')
          try {
            const buf = Buffer.alloc(MAX_READ_BYTES)
            await fh.read(buf, 0, MAX_READ_BYTES, 0)
            return buf.toString('utf8') + `\n…truncated (file is ${stat.size} bytes)`
          } finally {
            await fh.close()
          }
        }
        return await fs.readFile(file, 'utf8')
      }
    }),

    write_file: tool({
      description: 'Create or overwrite a text file in the workspace. Parent folders are created automatically.',
      inputSchema: z.object({
        path: z.string().describe('File path relative to the workspace root'),
        content: z.string().describe('Full file content to write')
      }),
      execute: async ({ path: p, content }) => {
        const file = resolveInWorkspace(ctx, p)
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, content, 'utf8')
        return `Wrote ${Buffer.byteLength(content)} bytes to ${p}`
      }
    }),

    move_file: tool({
      description: 'Move or rename a file or folder within the workspace.',
      inputSchema: z.object({
        from: z.string().describe('Current path relative to the workspace root'),
        to: z.string().describe('New path relative to the workspace root')
      }),
      execute: async ({ from, to }) => {
        const src = resolveInWorkspace(ctx, from)
        const dest = resolveInWorkspace(ctx, to)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.rename(src, dest)
        return `Moved ${from} → ${to}`
      }
    }),

    make_dir: tool({
      description: 'Create a folder (and any missing parents) in the workspace.',
      inputSchema: z.object({
        path: z.string().describe('Folder path relative to the workspace root')
      }),
      execute: async ({ path: p }) => {
        await fs.mkdir(resolveInWorkspace(ctx, p), { recursive: true })
        return `Created folder ${p}`
      }
    }),

    delete_file: tool({
      description:
        'Delete a file or folder in the workspace. The user is asked to approve every deletion, so explain why first.',
      inputSchema: z.object({
        path: z.string().describe('Path relative to the workspace root'),
        recursive: z.boolean().optional().describe('Required to delete a non-empty folder')
      }),
      execute: async ({ path: p, recursive }) => {
        const target = resolveInWorkspace(ctx, p)
        const approved = await ctx.requestApproval({ kind: 'delete', detail: p })
        if (!approved) return 'The user denied this deletion. Do not retry; ask them how to proceed instead.'
        await fs.rm(target, { recursive: !!recursive })
        return `Deleted ${p}`
      }
    }),

    run_command: tool({
      description:
        'Run a shell command. The user is asked to approve every command before it runs. Commands run in the workspace folder unless cwd is given. Output is captured; interactive commands are not supported.',
      inputSchema: z.object({
        command: z.string().describe('The shell command to run'),
        cwd: z.string().optional().describe('Working directory relative to the workspace root (default ".")')
      }),
      execute: async ({ command, cwd }, { abortSignal }) => {
        const dir = resolveInWorkspace(ctx, cwd ?? '.')
        const approved = await ctx.requestApproval({ kind: 'command', detail: command })
        if (!approved) return 'The user denied this command. Do not retry; ask them how to proceed instead.'
        beginActivity()
        try {
          return await new Promise<string>((resolve) => {
            exec(
              command,
              { cwd: dir, timeout: 120_000, maxBuffer: 1_000_000, env: process.env, signal: abortSignal },
              (error, stdout, stderr) => {
                const parts: string[] = []
                if (stdout) parts.push(stdout)
                if (stderr) parts.push(`[stderr]\n${stderr}`)
                if (error && error.killed) parts.push('[command timed out after 120s]')
                else if (error && typeof error.code === 'number') parts.push(`[exit code ${error.code}]`)
                else if (error) parts.push(`[failed to run: ${error.message}]`)
                const joined = parts.join('\n')
                // Keep head + tail: the end of command output carries the result/error.
                resolve(
                  (joined.length > 8_000
                    ? joined.slice(0, 4_000) + '\n…[middle truncated to save tokens]…\n' + joined.slice(-3_500)
                    : joined) || '(no output, exit code 0)'
                )
              }
            )
          })
        } finally {
          endActivity()
        }
      }
    }),

    open_app: tool({
      description:
        'Open an application on the user\'s computer, optionally with a file from the workspace or a URL. Examples: open Safari, open Notes, open a PDF in Preview.',
      inputSchema: z.object({
        name: z.string().describe('Application name as it appears in /Applications, e.g. "Safari", "Notes", "Visual Studio Code"'),
        target: z.string().optional().describe('Optional file path (relative to the workspace) or URL to open with the app')
      }),
      execute: async ({ name, target }, { abortSignal }) => {
        if (process.platform !== 'darwin') return 'Opening apps is only supported on macOS for now.'
        const args = ['-a', name]
        if (target) {
          const isUrl = /^https?:\/\//i.test(target)
          args.push(isUrl ? target : resolveInWorkspace(ctx, target))
        }
        beginActivity()
        try {
          return await new Promise<string>((resolve) => {
            execFile('open', args, { timeout: 15_000, signal: abortSignal }, (error, _stdout, stderr) => {
              if (error) {
                const detail = stderr.trim() || error.message
                if (/unable to find application/i.test(detail)) {
                  resolve(
                    `No application named "${name}" was found. Use the exact name from /Applications (e.g. "Google Chrome", not "Chrome"). You can list them with the run_command tool: ls /Applications`
                  )
                } else {
                  resolve(`Could not open ${name}: ${detail}`)
                }
              } else {
                resolve(`Opened ${name}${target ? ` with ${target}` : ''}`)
              }
            })
          })
        } finally {
          endActivity()
        }
      }
    }),

    applescript: tool({
      description:
        'Run an AppleScript to control apps, click menus, type, or read window contents. User approves each script — keep them small, set `description`. Prefer app-native scripting (tell application "Notes") over System Events keystrokes.',
      inputSchema: z.object({
        script: z.string().describe('The AppleScript source to run'),
        description: z.string().describe('One short sentence telling the user what this automation does')
      }),
      execute: async ({ script, description }, { abortSignal }) => {
        if (process.platform !== 'darwin') return 'Automation is only supported on macOS for now.'
        const approved = await ctx.requestApproval({ kind: 'automation', detail: `${description}\n\n${script}` })
        if (!approved) return 'The user denied this automation. Do not retry; ask them how to proceed instead.'
        beginActivity()
        try {
          return await runAppleScript(script, abortSignal)
        } finally {
          endActivity()
        }
      }
    }),

    send_whatsapp: tool({
      description:
        'Send a WhatsApp message in one reliable step (opens the chat, prefills text, sends). Get the number with find_contact first, then verify the sent bubble with read_screen.',
      inputSchema: z.object({
        recipient_name: z.string().describe('Contact name the user referred to (e.g. "Mummy") — verified against Contacts before sending'),
        phone: z.string().describe('Country code + digits, e.g. "917261879779" (symbols stripped)'),
        message: z.string().describe('The message text to send')
      }),
      execute: async ({ recipient_name, phone, message }, { abortSignal }) => {
        if (process.platform !== 'darwin') return 'WhatsApp sending is only supported on macOS for now.'
        let digits = phone.replace(/\D/g, '')
        if (digits.length < 8) return `"${phone}" does not look like a full phone number with country code.`

        // Safety: the number must actually belong to the named contact.
        const esc = recipient_name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        const numbersRaw = await runAppleScript(
          `tell application "Contacts"
	set output to ""
	repeat with p in (every person whose name contains "${esc}")
		repeat with ph in (phones of p)
			set output to output & (value of ph) & linefeed
		end repeat
	end repeat
	return output
end tell`,
          abortSignal
        )
        const savedNumbers = numbersRaw
          .split('\n')
          .map((s) => s.replace(/\D/g, ''))
          .filter((s) => s.length >= 8)
        const matched = savedNumbers.find((n) => n.slice(-10) === digits.slice(-10))
        const verified = !!matched
        if (savedNumbers.length > 0 && !verified) {
          return (
            `SAFETY STOP — nothing was sent. The number +${digits} does not match any number saved for ` +
            `"${recipient_name}" in Contacts (their saved numbers end in ${savedNumbers.map((n) => '…' + n.slice(-4)).join(', ')}). ` +
            'Re-run find_contact and pass the exact number it returns.'
          )
        }
        // The saved contact number is the source of truth — never trust a shortened copy of it,
        // and never deep-link a number that lacks its country code (it can resolve to a stranger).
        if (matched && matched.length > digits.length) digits = matched
        digits = digits.replace(/^0+/, '')
        if (digits.length < 11) {
          return (
            `STOP — +${digits} looks like a local number without a country code, and WhatsApp links ` +
            'without one can open the WRONG person. Ask the user for their country code, then retry with it prepended (digits only). Nothing was sent.'
          )
        }
        const note = verified
          ? ` — verified: this is "${recipient_name}" in Contacts`
          : ` — WARNING: could not verify this number against Contacts ("${recipient_name}" has no saved numbers or was not found)`
        // First message to a recipient in this chat always confirms with the user, even in Auto mode.
        const firstTime = !(ctx.isRecipientKnown?.(digits) ?? false)
        const firstNote = firstTime ? 'First message to this recipient in this chat — check it is the right person.\n' : ''
        // Duplicate guard: a second send to the same number within minutes is almost always a mistake.
        const prev = recentSends.get(digits)
        const isDupe = !!prev && Date.now() - prev.at < 3 * 60_000
        const dupeNote = isDupe
          ? `DUPLICATE WARNING: a message was already sent to this number ${Math.round((Date.now() - prev.at) / 1000)}s ago ("${prev.message.slice(0, 80)}"). Approve ONLY if you really want another message sent.\n`
          : ''
        const approved = await ctx.requestApproval({
          kind: 'automation',
          detail: `${dupeNote}${firstNote}Send WhatsApp message to +${digits}${note}:\n"${message}"`,
          force: !verified || firstTime || isDupe
        })
        if (!approved) return 'The user denied sending this message. Do not retry; ask them how to proceed instead.'
        ctx.rememberRecipient?.(digits)
        recentSends.set(digits, { message, at: Date.now() })
        beginActivity()
        try {
          // Cold starts are the main cause of "typed but never sent" — make sure the app is up first.
          const wasRunning = await runAppleScript(
            'tell application "System Events" to (exists process "WhatsApp") as text',
            abortSignal
          )
          if (wasRunning.trim() !== 'true') {
            await new Promise<void>((resolve) => execFile('open', ['-a', 'WhatsApp'], () => resolve()))
            await sleep(5000, abortSignal)
          }
          const url = `whatsapp://send?phone=${digits}&text=${encodeURIComponent(message)}`
          await new Promise<void>((resolve, reject) =>
            execFile('open', [url], { signal: abortSignal }, (e) => (e ? reject(e) : resolve()))
          )
          await sleep(3000, abortSignal)
          await activateApp('WhatsApp', abortSignal)
          const bounds = await runAppleScript(
            'tell application "System Events" to tell process "WhatsApp" to get {position, size} of front window',
            abortSignal
          )
          const nums = bounds.match(/-?\d+/g)?.map(Number)
          if (!nums || nums.length < 4) {
            return `Could not locate the WhatsApp window (got: ${bounds}). Fall back to screenshot + computer_click on the send button.`
          }
          const [wx, wy, ww, wh] = nums
          // The message input bar sits along the bottom edge of the chat window.
          // 65% width lands in the text field, clear of the attach button (left) and send/mic (right).
          await runAppleScript(jxaClick(Math.round(wx + ww * 0.65), Math.round(wy + wh - 30), false), abortSignal, 'javascript')
          await sleep(400, abortSignal)
          await runAppleScript(jxaKey(36, 0), abortSignal, 'javascript')
          // Second return is a no-op if the first one sent; catches late-focus misses.
          await sleep(600, abortSignal)
          await runAppleScript(jxaKey(36, 0), abortSignal, 'javascript')
          await sleep(500, abortSignal)
          return (
            'Chat opened, input focused, send pressed. Now verify with read_screen: the message should appear in the thread with an EMPTY input box. ' +
            'If the text is still in the input, click the send (arrow) button beside it — do NOT call send_whatsapp again for this request under any circumstances. ' +
            'If verification is unclear, tell the user instead of retrying. Report in one short sentence.'
          )
        } catch (err: any) {
          return `WhatsApp send failed: ${err?.message ?? err}`
        } finally {
          endActivity()
        }
      }
    }),

    find_contact: tool({
      description:
        'Look up a person in the user\'s macOS Contacts by (partial) name. Returns matching names with their phone numbers and emails. Use this to resolve names like "Mummy" into a phone number for messaging/calling deep links instead of asking the user for the number.',
      inputSchema: z.object({
        name: z.string().describe('Full or partial contact name, e.g. "Mummy"')
      }),
      execute: async ({ name }, { abortSignal }) => {
        if (process.platform !== 'darwin') return 'Contact lookup is only supported on macOS for now.'
        const approved = await ctx.requestApproval({ kind: 'automation', detail: `Look up "${name}" in Contacts` })
        if (!approved) return 'The user denied the contact lookup. Do not retry; ask them how to proceed instead.'
        const esc = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        const script = `tell application "Contacts"
	set output to ""
	set matches to (every person whose name contains "${esc}")
	repeat with p in matches
		set entryLine to (name of p)
		repeat with ph in (phones of p)
			set entryLine to entryLine & " | phone: " & (value of ph)
		end repeat
		repeat with em in (emails of p)
			set entryLine to entryLine & " | email: " & (value of em)
		end repeat
		set output to output & entryLine & linefeed
	end repeat
	return output
end tell`
        const result = await runAppleScript(script, abortSignal)
        if (result === 'Done (no output).' || !result.trim()) {
          return `No contact matching "${name}" found in Contacts. Try a shorter partial name, or fall back to searching inside the messaging app's own UI.`
        }
        return `Contacts matching "${name}":\n${result}\nFor WhatsApp deep links use digits only with country code (strip +, spaces, dashes). If the number has no country code, ask the user for it once.`
      }
    }),

    wait: tool({
      description: 'Pause (0.2–15s, prefer 1–3) to let an app launch or a page load before the next step.',
      inputSchema: z.object({
        seconds: z.number().describe('How long to wait, in seconds (max 15)')
      }),
      execute: async ({ seconds }, { abortSignal }) => {
        const s = Math.min(Math.max(seconds, 0.2), 15)
        beginActivity()
        try {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, s * 1000)
            abortSignal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                resolve()
              },
              { once: true }
            )
          })
          return `Waited ${s} seconds.`
        } finally {
          endActivity()
        }
      }
    }),

    open_url: tool({
      description:
        'Open a URL or app deep link. Without "app" it uses the DEFAULT browser — when the user names a browser you MUST pass it as app. Handles https:// and schemes like "whatsapp://send?phone=+15551234567&text=hi". Prefer deep links / direct search URLs over clicking through UI.',
      inputSchema: z.object({
        url: z.string().describe('The URL or deep link to open'),
        app: z
          .string()
          .optional()
          .describe('Open in this specific app, e.g. "Safari" or "Google Chrome" — required whenever the user named a browser')
      }),
      execute: async ({ url, app }, { abortSignal }) => {
        if (process.platform !== 'darwin') return 'Opening URLs is only supported on macOS for now.'
        if (/^file:/i.test(url)) return 'file:// links are not allowed here; use open_app with a workspace file instead.'
        const approved = await ctx.requestApproval({
          kind: 'automation',
          detail: `Open ${url}${app ? ` in ${app}` : ' (default browser)'}`
        })
        if (!approved) return 'The user denied opening this link. Do not retry; ask them how to proceed instead.'
        beginActivity()
        try {
          return await new Promise<string>((resolve) => {
            execFile(
              'open',
              app ? ['-a', app, url] : [url],
              { timeout: 15_000, signal: abortSignal },
              (error, _stdout, stderr) => {
                if (error) resolve(`Could not open ${url}${app ? ` in ${app}` : ''}: ${stderr.trim() || error.message}`)
                else resolve(`Opened ${url}${app ? ` in ${app}` : ' in the default browser'}`)
              }
            )
          })
        } finally {
          endActivity()
        }
      }
    }),

    screenshot: tool({
      description:
        'SEE the screen as an image (needs a vision model; expensive — prefer read_screen for text). Use to find click coordinates. For small text, call again with region set to that area to zoom. computer_click uses pixels of the most recent screenshot.',
      inputSchema: z.object({
        app: z
          .string()
          .optional()
          .describe('App to bring to the front before capturing, e.g. "WhatsApp" — always set this when looking at a specific app'),
        region: z
          .object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number()
          })
          .optional()
          .describe('Zoom into this rectangle of the PREVIOUS screenshot (in its pixel coordinates) at full sharpness')
      }),
      execute: async ({ app, region }) => {
        if (process.platform !== 'darwin') return { error: 'Screenshots are only supported on macOS for now.' }
        const file = path.join(os.tmpdir(), `sk-shot-${Date.now()}.jpg`)
        try {
          let win: AppWindow | null = null
          if (app) {
            await activateApp(app)
            if (!region) win = await findAppWindow(app)
          }

          if (win) {
            // Capture just the app's window: no other apps in frame, sharper text per token.
            await execFileP('screencapture', ['-x', '-o', '-l', String(win.id), '-t', 'jpg', file])
            const winPx = (await execFileP('sips', ['-g', 'pixelWidth', file])).stdout
            const capPxW = Number(winPx.match(/pixelWidth: (\d+)/)?.[1] ?? win.w)
            const outW = Math.min(MAX_SHOT_WIDTH, capPxW)
            const outH = Math.round(outW * (win.h / win.w))
            await execFileP('sips', ['-z', String(outH), String(outW), '-s', 'format', 'jpeg', '-s', 'formatOptions', '60', file])
            lastShot = { originX: win.x, originY: win.y, scale: win.w / outW }
            const data = await fs.readFile(file, { encoding: 'base64' })
            return { width: outW, height: outH, data, zoomed: false, window: app }
          }

          await execFileP('screencapture', ['-x', '-t', 'jpg', file])
          const { width: pointW, height: pointH } = screen.getPrimaryDisplay().size
          const sizeOut = (await execFileP('sips', ['-g', 'pixelWidth', file])).stdout
          const capW = Number(sizeOut.match(/pixelWidth: (\d+)/)?.[1] ?? pointW)
          const backing = capW / pointW

          let originX = 0
          let originY = 0
          let viewW = pointW
          let viewH = pointH
          let outW: number

          if (region) {
            // region arrives in the previous screenshot's pixel space; map to screen points.
            const rx = lastShot.originX + region.x * lastShot.scale
            const ry = lastShot.originY + region.y * lastShot.scale
            const rw = Math.max(40, region.width * lastShot.scale)
            const rh = Math.max(40, region.height * lastShot.scale)
            originX = Math.max(0, Math.min(Math.round(rx), pointW - 40))
            originY = Math.max(0, Math.min(Math.round(ry), pointH - 40))
            viewW = Math.min(Math.round(rw), pointW - originX)
            viewH = Math.min(Math.round(rh), pointH - originY)
            await execFileP('sips', [
              '-c', String(Math.round(viewH * backing)), String(Math.round(viewW * backing)),
              '--cropOffset', String(Math.round(originY * backing)), String(Math.round(originX * backing)),
              file
            ])
            // Zoomed crops keep native (Retina) sharpness up to the size cap.
            outW = Math.min(MAX_SHOT_WIDTH, Math.round(viewW * backing))
          } else {
            outW = Math.min(MAX_SHOT_WIDTH, pointW)
          }

          const outH = Math.round(outW * (viewH / viewW))
          await execFileP('sips', [
            '-z', String(outH), String(outW),
            '-s', 'format', 'jpeg',
            '-s', 'formatOptions', region ? '70' : '55',
            file
          ])
          lastShot = { originX, originY, scale: viewW / outW }
          const data = await fs.readFile(file, { encoding: 'base64' })
          return { width: outW, height: outH, data, zoomed: !!region }
        } catch (err: any) {
          return {
            error:
              `Could not capture the screen: ${err?.message ?? err}. ` +
              'If the image is blank or this keeps failing, ShortKut needs Screen Recording permission — ' +
              'tell the user to grant it in Settings → macOS control permissions.'
          }
        } finally {
          await fs.rm(file, { force: true })
        }
      },
      toModelOutput: (output: any) =>
        output?.data
          ? {
              type: 'content',
              value: [
                {
                  type: 'text',
                  text: output.zoomed
                    ? `Zoomed screenshot (${output.width}x${output.height}) of the selected region at full sharpness. Its pixel coordinates work with computer_click.`
                    : output.window
                      ? `Screenshot of the ${output.window} window only (${output.width}x${output.height}). Use these pixel coordinates with computer_click.`
                      : `Screenshot of the main display (${output.width}x${output.height}). Use these pixel coordinates with computer_click. If small text (like chat messages) is not clearly readable, call screenshot again with region around that area to zoom in.`
                },
                { type: 'media', mediaType: 'image/jpeg', data: output.data }
              ]
            }
          : { type: 'text', value: String(output?.error ?? 'Screenshot failed.') }
    }),

    read_screen: tool({
      description:
        'Read ALL visible text on the screen using the Mac\'s built-in OCR — works with any model, no vision needed. Returns every line of text with its click coordinates. This is the most reliable way to read chat messages, emails, lists, or any on-screen text; quote its output exactly. ALWAYS pass app when reading a specific app so it is brought to the front first. Use screenshot for layout/visual questions, read_screen whenever the answer is text.',
      inputSchema: z.object({
        app: z
          .string()
          .optional()
          .describe('App to bring to the front before reading, e.g. "WhatsApp" — always set this when reading a specific app')
      }),
      execute: async ({ app }) => {
        if (process.platform !== 'darwin') return 'Screen reading is only supported on macOS for now.'
        const file = path.join(os.tmpdir(), `sk-ocr-${Date.now()}.jpg`)
        try {
          let win: AppWindow | null = null
          if (app) {
            await activateApp(app)
            win = await findAppWindow(app)
          }
          // Capturing the app's own window keeps other apps' text from leaking into the result.
          if (win) {
            await execFileP('screencapture', ['-x', '-o', '-l', String(win.id), '-t', 'jpg', file])
          } else {
            await execFileP('screencapture', ['-x', '-t', 'jpg', file])
          }
          const { width: pointW, height: pointH } = screen.getPrimaryDisplay().size
          const jxa = `ObjC.import('Cocoa');
ObjC.import('Vision');
var data = $.NSData.dataWithContentsOfFile(${JSON.stringify(file)});
var handler = $.VNImageRequestHandler.alloc.initWithDataOptions(data, $.NSDictionary.dictionary);
var req = $.VNRecognizeTextRequest.alloc.init;
req.recognitionLevel = 0;
var err = Ref();
handler.performRequestsError($.NSArray.arrayWithObject(req), err);
var res = req.results;
var out = [];
if (!res.isNil()) { for (var i = 0; i < res.count; i++) { var o = res.objectAtIndex(i); var top = o.topCandidates(1).objectAtIndex(0); var bb = o.boundingBox; out.push(JSON.stringify({ t: top.string.js, x: bb.origin.x, y: bb.origin.y, w: bb.size.width, h: bb.size.height })); } }
out.join('\\n');`
          const raw = await runAppleScript(jxa, undefined, 'javascript')
          if (raw.startsWith('macOS blocked')) return raw
          const items = raw
            .split('\n')
            .map((l) => {
              try {
                return JSON.parse(l) as { t: string; x: number; y: number; w: number; h: number }
              } catch {
                return null
              }
            })
            .filter((i): i is { t: string; x: number; y: number; w: number; h: number } => i !== null)
          if (items.length === 0) {
            return 'No readable text found on screen. If the screen clearly has text, ShortKut may be missing Screen Recording permission (Settings → macOS control permissions).'
          }
          const baseX = win ? win.x : 0
          const baseY = win ? win.y : 0
          const areaW = win ? win.w : pointW
          const areaH = win ? win.h : pointH
          const mapped = items
            .map((it) => ({
              text: it.t,
              cx: Math.round(baseX + (it.x + it.w / 2) * areaW),
              cy: Math.round(baseY + (1 - it.y - it.h / 2) * areaH)
            }))
            .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
          // Group into visual rows so a message and its own timestamp appear together.
          const rows: { y: number; items: { cx: number; text: string }[] }[] = []
          for (const l of mapped) {
            const last = rows[rows.length - 1]
            if (last && Math.abs(l.cy - last.y) <= 10) {
              last.items.push({ cx: l.cx, text: l.text })
            } else {
              rows.push({ y: l.cy, items: [{ cx: l.cx, text: l.text }] })
            }
          }
          const lines = rows.map(
            (r) => `y=${r.y}: ` + r.items.map((i) => `(${i.cx}) ${JSON.stringify(i.text)}`).join('  ')
          )
          // Coordinates are raw screen points; reset the click mapping to 1:1.
          lastShot = { originX: 0, originY: 0, scale: 1 }
          const source = win
            ? `${app} window only`
            : app
              ? `whole screen (couldn't isolate "${app}"; other apps' text may be mixed in)`
              : 'whole screen'
          const capturedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          // The messaging-specific guidance (timestamp pairing, chat-list edge) is only
          // relevant when reading a messaging app — omit it everywhere else to save tokens.
          const isMessaging = !!app && MESSAGING_APPS.some((a) => app.toLowerCase().includes(a))
          const messagingNote = isMessaging
            ? ` Chat rules: x below ${Math.round(baseX + areaW * 0.33)} is the chat LIST (other chats) — ignore it; in the conversation, x below ${Math.round(baseX + areaW * 0.66)} is the OTHER person, above is you. A message's time is the small text in its row or the row just below — quote exactly, and if none is near a message say so; never borrow a time.`
            : ''
          return (
            `${source}, captured ${capturedAt}. Lines are visual rows top-to-bottom: y=<row> (x) "text". Click via that (x) and y with computer_click.${messagingNote}\n` +
            lines.join('\n').slice(0, 7_000)
          )
        } catch (err: any) {
          return `Could not read the screen: ${err?.message ?? err}`
        } finally {
          await fs.rm(file, { force: true })
        }
      }
    }),

    computer_click: tool({
      description:
        'Click the mouse at screen coordinates taken from the latest screenshot. Use double: true for double-clicks. Take a screenshot first to find the target and afterwards to verify.',
      inputSchema: z.object({
        x: z.number().describe('X coordinate in screenshot pixels'),
        y: z.number().describe('Y coordinate in screenshot pixels'),
        double: z.boolean().optional().describe('Double-click instead of single click')
      }),
      execute: async ({ x, y, double }, { abortSignal }) => {
        if (process.platform !== 'darwin') return 'Computer control is only supported on macOS for now.'
        const detail = `${double ? 'Double-click' : 'Click'} at (${Math.round(x)}, ${Math.round(y)})`
        const approved = await ctx.requestApproval({ kind: 'automation', detail })
        if (!approved) return 'The user denied this click. Do not retry; ask them how to proceed instead.'
        const px = Math.round(lastShot.originX + x * lastShot.scale)
        const py = Math.round(lastShot.originY + y * lastShot.scale)
        beginActivity()
        try {
          const result = await runAppleScript(jxaClick(px, py, !!double), abortSignal, 'javascript')
          return result === 'ok' || result === 'Done (no output).' ? `${detail} done.` : result
        } finally {
          endActivity()
        }
      }
    }),

    computer_type: tool({
      description:
        'Insert text into the focused field (via clipboard paste; supports emoji/multiline, newlines are line breaks not sends). Click the target field first. Never type passwords or payment details.',
      inputSchema: z.object({
        text: z.string().describe('The text to insert')
      }),
      execute: async ({ text }, { abortSignal }) => {
        if (process.platform !== 'darwin') return 'Computer control is only supported on macOS for now.'
        const preview = text.length > 60 ? text.slice(0, 60) + '…' : text
        // Typing into a chat app can become a sent message — that always needs the user's OK.
        const messenger = await frontmostMessagingApp(abortSignal)
        const approved = await ctx.requestApproval({
          kind: 'automation',
          detail: messenger ? `Type into ${messenger} (this may become a sent message): ${preview}` : `Type: ${preview}`,
          force: !!messenger
        })
        if (!approved) return 'The user denied this typing. Do not retry; ask them how to proceed instead.'
        beginActivity()
        try {
          // Paste instead of synthetic keystrokes: apps cannot ignore it, and unicode survives.
          const oldClipboard = (await execFileP('pbpaste').catch(() => ({ stdout: '' }))).stdout
          await setClipboard(text)
          const result = await runAppleScript(jxaKey(9, 0x100000), abortSignal, 'javascript') // cmd+V
          await sleep(350, abortSignal)
          if (oldClipboard) await setClipboard(oldClipboard).catch(() => {})
          return result === 'ok' || result === 'Done (no output).'
            ? `Inserted ${text.length} characters into the focused field.`
            : result
        } finally {
          endActivity()
        }
      }
    }),

    computer_key: tool({
      description:
        'Press a keyboard key, optionally with modifiers. Examples: key "return"; key "a" with modifiers ["command"] to select all; key "tab"; arrow keys "up"/"down"/"left"/"right".',
      inputSchema: z.object({
        key: z.string().describe('A single character, or a named key: return, tab, escape, space, delete, up, down, left, right, home, end, pageup, pagedown'),
        modifiers: z
          .array(z.enum(['command', 'option', 'control', 'shift']))
          .optional()
          .describe('Modifier keys to hold')
      }),
      execute: async ({ key, modifiers }, { abortSignal }) => {
        if (process.platform !== 'darwin') return 'Computer control is only supported on macOS for now.'
        const combo = [...(modifiers ?? []), key].join('+')
        // Return inside a chat app sends whatever is in the input — always confirm that.
        const isSendKey = ['return', 'enter'].includes(key.toLowerCase())
        const messenger = isSendKey ? await frontmostMessagingApp(abortSignal) : null
        const approved = await ctx.requestApproval({
          kind: 'automation',
          detail: messenger ? `Press ${combo} in ${messenger} — this SENDS the current input` : `Press ${combo}`,
          force: !!messenger
        })
        if (!approved) return 'The user denied this key press. Do not retry; ask them how to proceed instead.'
        const code = KEY_CODES[key.toLowerCase()] ?? CHAR_KEY_CODES[key.toLowerCase()]
        beginActivity()
        try {
          let result: string
          if (code !== undefined) {
            // Real CGEvent key press — System Events keystrokes are ignored by some apps.
            const flags = (modifiers ?? []).reduce((sum, m) => sum | (MODIFIER_FLAGS[m] ?? 0), 0)
            result = await runAppleScript(jxaKey(code, flags), abortSignal, 'javascript')
          } else {
            const using = modifiers?.length ? ` using {${modifiers.map((m) => `${m} down`).join(', ')}}` : ''
            result = await runAppleScript(
              `tell application "System Events" to keystroke "${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"${using}`,
              abortSignal
            )
          }
          return result === 'ok' || result === 'Done (no output).' ? `Pressed ${combo}.` : result
        } finally {
          endActivity()
        }
      }
    })
  }
}
