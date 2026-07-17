import { BrowserWindow, screen } from 'electron'

/**
 * Visual "ShortKut is working" layer: a purple glow around every screen edge
 * plus a purple crayon that rides the system cursor, tip planted on the
 * exact cursor point. Shown while the agent executes desktop actions
 * (commands, opening apps, automations).
 * All windows are click-through and never take focus.
 */

// Cursor-follower window: the crayon tip sits at (TIP_X, TIP_Y) inside it,
// and the window is positioned so that point tracks the real cursor.
const CURSOR_W = 100
const CURSOR_H = 100
const TIP_X = 20
const TIP_Y = 80

const BORDER_HTML = (withBadge: boolean): string => `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; pointer-events: none; }
  .frame {
    position: fixed; inset: 0;
    box-shadow:
      inset 0 0 140px 22px rgba(116, 68, 200, 0.40),
      inset 0 0 36px 6px rgba(116, 68, 200, 0.70);
    animation: breathe 2.2s ease-in-out infinite;
  }
  @keyframes breathe { 50% { opacity: 0.55; } }
  .badge {
    position: fixed; bottom: 96px; left: 50%; transform: translateX(-50%) rotate(-1deg);
    display: flex; align-items: center; gap: 9px;
    font: 700 14px 'Chalkboard SE', 'Comic Sans MS', cursive; color: #7444c8;
    background: rgba(247, 244, 237, 0.92);
    border: 2px solid #7444c8;
    padding: 6px 16px;
    border-radius: 18px 6px 20px 7px / 7px 20px 6px 18px;
    backdrop-filter: blur(10px);
    box-shadow: 0 4px 22px rgba(116, 68, 200, 0.4);
  }
  /* The ShortKut scribble ball, drawing itself while work happens */
  .logo { width: 21px; height: 21px; }
  .logo ellipse {
    stroke-dasharray: 100;
    animation: scribble 2.4s linear infinite;
  }
  .logo .s1 { animation-duration: 2.2s; }
  .logo .s2 { animation-duration: 2.7s; animation-delay: -0.6s; }
  .logo .s3 { animation-duration: 2.4s; animation-delay: -1.1s; }
  .logo .s4 { animation-duration: 2.9s; animation-delay: -0.3s; }
  .logo .s5 { animation-duration: 2.0s; animation-delay: -1.5s; }
  @keyframes scribble {
    from { stroke-dashoffset: 200; }
    to { stroke-dashoffset: 0; }
  }
</style>
<div class="frame"></div>
${
  withBadge
    ? `<div class="badge">
        <svg class="logo" viewBox="0 0 120 120">
          <g fill="none" stroke="#7444c8" stroke-linecap="round">
            <ellipse class="s1" cx="60" cy="60" rx="40" ry="36" stroke-width="9" transform="rotate(18 60 60)" pathLength="100"/>
            <ellipse class="s2" cx="59" cy="61" rx="37" ry="41" stroke-width="8" transform="rotate(-24 60 60)" pathLength="100"/>
            <ellipse class="s3" cx="60" cy="60" rx="30" ry="27" stroke-width="10" transform="rotate(-40 60 60)" pathLength="100"/>
            <ellipse class="s4" cx="58" cy="61" rx="22" ry="25" stroke-width="11" transform="rotate(30 60 60)" pathLength="100"/>
            <ellipse class="s5" cx="61" cy="58" rx="14" ry="12" stroke-width="12" transform="rotate(-15 60 60)" pathLength="100"/>
          </g>
        </svg>
        ShortKut is working…
      </div>`
    : ''
}`

const CRAYON_HTML = `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; pointer-events: none; }
  /* Soft pulsing glow pinned to the exact cursor point (the crayon tip). */
  .glow {
    position: fixed;
    left: ${TIP_X - 13}px; top: ${TIP_Y - 13}px; width: 26px; height: 26px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(116, 68, 200, 0.65) 0%, rgba(116, 68, 200, 0.25) 45%, rgba(116, 68, 200, 0) 70%);
    animation: tippulse 1.4s ease-in-out infinite;
  }
  @keyframes tippulse { 50% { transform: scale(1.35); opacity: 0.6; } }
  /* The purple crayon, tip at the cursor, rocking like it's scribbling. */
  .crayon {
    position: fixed;
    left: ${TIP_X - 14}px; top: ${TIP_Y - 76}px;
    width: 28px; height: 78px;
    transform-origin: 14px 76px;
    transform: rotate(45deg);
    animation: scribblerock 0.55s ease-in-out infinite alternate;
    filter: drop-shadow(0 2px 5px rgba(56, 48, 74, 0.35));
  }
  @keyframes scribblerock {
    from { transform: rotate(40deg); }
    to { transform: rotate(51deg); }
  }
</style>
<div class="glow"></div>
<svg class="crayon" viewBox="0 0 28 78">
  <g stroke="#38304a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <!-- body -->
    <rect x="6.5" y="16" width="15" height="46" rx="3.5" fill="#7444c8"/>
    <!-- paper wrapper band -->
    <rect x="5.5" y="27" width="17" height="24" rx="2" fill="#5d35a6"/>
    <path d="M5.5 32 h17 M5.5 46 h17" stroke="#38304a" stroke-width="1.2" opacity="0.45" fill="none"/>
    <!-- cone tip, point at (14,76) -->
    <path d="M14 76 L7.5 61 Q14 57 20.5 61 Z" fill="#8a5fd6"/>
  </g>
  <!-- waxy highlight -->
  <path d="M10 21 v38" stroke="rgba(255,255,255,0.35)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
</svg>`

const dataUrl = (html: string): string => 'data:text/html;charset=utf-8,' + encodeURIComponent(html)

let borderWins: BrowserWindow[] = []
let cursorWin: BrowserWindow | null = null
let cursorTimer: ReturnType<typeof setInterval> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let activeCount = 0

function makeOverlayWindow(bounds: Electron.Rectangle, html: string): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    hasShadow: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false,
    show: false,
    webPreferences: { sandbox: true }
  })
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  void win.loadURL(dataUrl(html))
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive()
  })
  return win
}

function createOverlays(): void {
  if (borderWins.length > 0) return
  const displays = screen.getAllDisplays()
  const primaryId = screen.getPrimaryDisplay().id
  borderWins = displays.map((d) => makeOverlayWindow(d.bounds, BORDER_HTML(d.id === primaryId)))

  const start = screen.getCursorScreenPoint()
  cursorWin = makeOverlayWindow(
    { x: start.x - TIP_X, y: start.y - TIP_Y, width: CURSOR_W, height: CURSOR_H },
    CRAYON_HTML
  )
  cursorTimer = setInterval(() => {
    if (!cursorWin || cursorWin.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    cursorWin.setPosition(p.x - TIP_X, p.y - TIP_Y, false)
  }, 16)
}

function destroyOverlays(): void {
  if (cursorTimer) {
    clearInterval(cursorTimer)
    cursorTimer = null
  }
  for (const win of borderWins) {
    if (!win.isDestroyed()) win.destroy()
  }
  borderWins = []
  if (cursorWin && !cursorWin.isDestroyed()) cursorWin.destroy()
  cursorWin = null
}

/** Call when a desktop action starts. Balanced by endActivity(). */
export function beginActivity(): void {
  activeCount++
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  createOverlays()
}

/** Call when a desktop action finishes. Overlays linger briefly to avoid flicker between steps. */
export function endActivity(): void {
  activeCount = Math.max(0, activeCount - 1)
  if (activeCount === 0) {
    hideTimer = setTimeout(() => {
      if (activeCount === 0) destroyOverlays()
    }, 1500)
  }
}

/** Immediate teardown (run aborted or app quitting). */
export function clearActivity(): void {
  activeCount = 0
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  destroyOverlays()
}
