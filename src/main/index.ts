import { app, BrowserWindow, ipcMain, dialog, shell, systemPreferences } from 'electron'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { loadSettings, saveSettings, setApiKey, keyStatus, PROVIDER_DEFAULTS, type Settings } from './store'
import { listOllamaModels, testConnection } from './providers'
import { runAgent, forgetChat, stopAgent, resolveApproval, getRunningChatId } from './agent'
import { listChats, loadChatFile, deleteChatFile, renameChat, toDisplay, scrubStoredScreenshots } from './chats'
import { getTodayStats } from './usage'

/** Probe Automation consent by sending a benign Apple event; first call triggers the macOS consent dialog. */
function probeAutomation(): Promise<{ granted: boolean; message: string }> {
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to return name of first process'],
      { timeout: 60_000 },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve({ granted: true, message: 'Automation permission granted — ShortKut can control apps.' })
        } else if (/-1743|not authorized|authorised/i.test(stderr)) {
          resolve({
            granted: false,
            message:
              'Automation is blocked. In System Settings → Privacy & Security → Automation, enable "System Events" under ShortKut (shown as "Electron" during development), then try again.'
          })
        } else {
          resolve({ granted: false, message: `Could not verify: ${stderr.trim() || error.message}` })
        }
      }
    )
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: loadSettings().theme === 'dark' ? '#201c2b' : '#f4f1ea',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Links in chat markdown must open in the system browser, never navigate the app itself.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  scrubStoredScreenshots()

  ipcMain.handle('settings:get', () => ({
    settings: loadSettings(),
    hasKey: keyStatus(),
    providers: PROVIDER_DEFAULTS
  }))

  ipcMain.handle('settings:save', (_e, settings: Settings) => {
    saveSettings(settings)
  })

  ipcMain.handle('key:set', (_e, provider: string, key: string) => {
    setApiKey(provider, key)
    return keyStatus()
  })

  ipcMain.handle('workspace:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      message: 'Choose the folder ShortKut is allowed to work in'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const settings = loadSettings()
    settings.workspace = result.filePaths[0]
    saveSettings(settings)
    return settings.workspace
  })

  ipcMain.handle('ollama:models', (_e, baseUrl: string) => listOllamaModels(baseUrl))

  ipcMain.handle('connection:test', (_e, settings: Settings, key: string | null) =>
    testConnection(settings, key)
  )

  ipcMain.handle('permissions:status', () => ({
    platform: process.platform,
    accessibility:
      process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : true,
    screen: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') === 'granted' : true
  }))

  ipcMain.handle('permissions:request', async (_e, kind: 'accessibility' | 'automation' | 'screen') => {
    if (process.platform !== 'darwin') return { granted: true, message: 'Not needed on this platform.' }
    if (kind === 'accessibility') {
      // Prompts macOS to offer adding the app to the Accessibility list, then opens the pane.
      const granted = systemPreferences.isTrustedAccessibilityClient(true)
      if (!granted) {
        await shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
        )
      }
      return {
        granted,
        message: granted
          ? 'Accessibility permission granted — ShortKut can click and type in apps.'
          : 'Enable ShortKut (shown as "Electron" during development) in the Accessibility list that just opened, then check again.'
      }
    }
    if (kind === 'screen') {
      const granted = systemPreferences.getMediaAccessStatus('screen') === 'granted'
      if (!granted) {
        // A capture attempt registers the app with macOS so it appears in the pane.
        const tmp = path.join(app.getPath('temp'), 'sk-perm-probe.jpg')
        await new Promise<void>((resolve) => execFile('screencapture', ['-x', '-t', 'jpg', tmp], () => resolve()))
        await shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
        )
      }
      return {
        granted,
        message: granted
          ? 'Screen Recording permission granted — ShortKut can see the screen.'
          : 'Enable ShortKut (shown as "Electron" during development) in the Screen Recording list that just opened, then check again. macOS may require relaunching the app.'
      }
    }
    const result = await probeAutomation()
    if (!result.granted) {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Automation')
    }
    return result
  })

  ipcMain.handle('chats:list', () => listChats())
  ipcMain.handle('chats:get', (_e, id: string) => toDisplay(loadChatFile(id)?.messages ?? []))
  ipcMain.handle('chats:delete', (_e, id: string) => {
    if (getRunningChatId() === id) stopAgent()
    forgetChat(id)
    deleteChatFile(id)
  })
  ipcMain.handle('chats:rename', (_e, id: string, title: string) => renameChat(id, title))
  ipcMain.handle('stats:get', () => getTodayStats())

  ipcMain.on('chat:send', (e, chatId: string, text: string) => {
    void runAgent(chatId, text, e.sender)
  })
  ipcMain.on('chat:stop', () => stopAgent())
  ipcMain.on('approval:respond', (_e, id: string, approved: boolean) => {
    resolveApproval(id, approved)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
