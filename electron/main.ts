import { app, BrowserWindow, ipcMain, shell } from 'electron'
import * as path from 'path'
import { getSettings, setSettings } from './settings'
import { testLlm } from './llm'
import { generatePostDraft, generateReplyDraft } from './pipeline'
import { testThreads, scrapeRecentTexts, fetchUnansweredEngagement } from './threadsApi'
import { startThreadsOAuth } from './threadsOAuth'
import { fetchTopicNews } from './news'
import { generateImageKeywords, searchImages } from './images'
import { allDrafts, upsertDraft, deleteDraft, setDraftsChangedListener } from './drafts'
import { startScheduler, postDraftNow } from './scheduler'
import {
  startAutopilot,
  buildAutopilotStatus,
  runAutopilotNow,
  setAutopilotStatusListener,
} from './autopilot'
import { db } from './localdb'
import type { AppSettings, AutopilotStatus, Draft, LlmSettings } from './types'

// Two instances would race the scheduler and drafts store on the same files.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const theme = getSettings().theme
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: theme === 'dark' ? '#0e0e0e' : '#ffffff',
    autoHideMenuBar: true,
    title: 'AutoThreads',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Any window.open / target=_blank goes to the system browser, never a child window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL
    // Compare parsed origins, not string prefixes: "http://localhost:5174@evil.com"
    // startsWith-passes but resolves to evil.com, which would inherit the preload bridge.
    if (devUrl && sameOrigin(url, devUrl)) return
    e.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  const broadcastAutopilot = (status: AutopilotStatus): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send('autopilot:status', status)
    }
  }

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', async (_e, settings: AppSettings) => {
    await setSettings(settings)
    // Config (interval, caps, goal, persona) may have changed — refresh the UI status.
    broadcastAutopilot(buildAutopilotStatus())
  })

  ipcMain.handle('autopilot:status', () => buildAutopilotStatus())
  ipcMain.handle('autopilot:set-running', async (_e, running: boolean) => {
    const settings = getSettings()
    await setSettings({ ...settings, autopilot: { ...settings.autopilot, enabled: running === true } })
    // Launch: reset BOTH post and reply timers so first checks fire immediately
    // (not after a full interval). Reply checks are independent of posts.
    if (running === true) {
      await db.set('autopilotLastRun', 0)
      await db.set('autopilotLastReplyRun', 0)
      // Kick immediately so replies/mentions run now (don't wait for the poll).
      void runAutopilotNow()
    }
    return buildAutopilotStatus()
  })
  ipcMain.handle('autopilot:run-now', () => runAutopilotNow())

  ipcMain.handle('llm:test', (_e, llm: LlmSettings) => testLlm(llm))
  ipcMain.handle('llm:generate-post', (_e, input: Parameters<typeof generatePostDraft>[0]) =>
    generatePostDraft(input)
  )
  ipcMain.handle('llm:generate-reply', (_e, input: Parameters<typeof generateReplyDraft>[0]) =>
    generateReplyDraft(input)
  )

  ipcMain.handle('threads:test', (_e, cfg: { accessToken: string; userId: string }) =>
    testThreads(cfg)
  )
  ipcMain.handle('threads:oauth-start', (_e, cfg: Parameters<typeof startThreadsOAuth>[0]) =>
    startThreadsOAuth(cfg)
  )
  ipcMain.handle('threads:scrape-style', async (_e, count: number) => {
    const threads = getSettings().threads
    if (!threads.accessToken) {
      return { ok: false, samples: [], message: 'Threads API is not configured — save credentials in Settings first.' }
    }
    try {
      const limit = Math.max(1, Math.min(50, Math.floor(Number(count)) || 10))
      const samples = await scrapeRecentTexts(threads, limit)
      if (samples.length === 0) {
        return { ok: false, samples: [], message: 'No text posts found on this Threads account.' }
      }
      return { ok: true, samples, message: `Imported ${samples.length} recent posts as style samples.` }
    } catch (err) {
      return { ok: false, samples: [], message: errMsg(err) }
    }
  })
  ipcMain.handle('threads:unanswered', async () => {
    const threads = getSettings().threads
    if (!threads.accessToken) {
      return { ok: false, replies: [], message: 'Threads API is not configured — save credentials in Settings first.' }
    }
    try {
      // Always include @mentions for the Replies page + Full-Auto.
      const { replies, mentionError, threadCap } = await fetchUnansweredEngagement(threads, {
        includeMentions: true,
      })
      const mentionCount = replies.filter((r) => r.kind === 'mention').length
      const replyCount = replies.length - mentionCount
      let message = ''
      if (mentionError) message = mentionError
      else if (replies.length === 0) message = ''
      else message = `${replyCount} reply(ies), ${mentionCount} mention(s)`
      if (threadCap.threadsTruncated > 0) {
        message = message
          ? `${message}. Long threads capped at ${threadCap.maxPerThread} unanswered each ` +
            `(${threadCap.threadsTruncated} thread(s), ${threadCap.dropped} skipped).`
          : `Long threads capped at ${threadCap.maxPerThread} unanswered each ` +
            `(${threadCap.threadsTruncated} thread(s), ${threadCap.dropped} skipped).`
      }
      return {
        ok: true,
        replies,
        message,
        mentionError: mentionError ?? null,
        threadCap,
      }
    } catch (err) {
      return { ok: false, replies: [], message: errMsg(err), mentionError: null, threadCap: null }
    }
  })

  ipcMain.handle('news:fetch', (_e, input: unknown) => {
    if (typeof input === 'object' && input !== null) {
      const value = input as { query?: unknown; mode?: unknown }
      return fetchTopicNews({
        query: String(value.query ?? '').trim(),
        mode: value.mode === 'blogs' ? 'blogs' : 'news',
        sources: getSettings().newsSources,
      })
    }
    return fetchTopicNews({ query: String(input ?? '').trim(), sources: getSettings().newsSources })
  })
  ipcMain.handle('images:keywords', (_e, input: Parameters<typeof generateImageKeywords>[0]) =>
    generateImageKeywords(input)
  )
  ipcMain.handle('images:search', (_e, query: string) => searchImages(String(query ?? '').trim()))

  ipcMain.handle('drafts:all', () => allDrafts())
  ipcMain.handle('drafts:upsert', (_e, draft: Draft) => upsertDraft(draft))
  ipcMain.handle('drafts:delete', (_e, id: string) => deleteDraft(id))
  ipcMain.handle('drafts:post-now', async (_e, id: string) => {
    const res = await postDraftNow(id)
    return { ...res, drafts: allDrafts() }
  })

  ipcMain.handle('app:open-external', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url)
    return Promise.resolve()
  })

  setDraftsChangedListener((drafts) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send('drafts:changed', drafts)
    }
  })
  setAutopilotStatusListener(broadcastAutopilot)

  createWindow()
  startScheduler()
  startAutopilot()

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
