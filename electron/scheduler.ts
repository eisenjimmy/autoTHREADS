import { db } from './localdb'
import { getSettings } from './settings'
import { allDrafts, updateDraft } from './drafts'
import { publishPost, publishReply } from './threadsApi'
import { runAutoDraft } from './pipeline'
import {
  needsThreadSplit,
  splitIntoThreadParts,
  THREADS_MAX_CHARS,
  THREADS_MAX_THREAD_CHARS,
} from './threadSplit'

const TICK_MS = 15_000
const FIRST_TICK_MS = 5_000
const LAST_RUN_KEY = 'autoDraftLastRun'
const MAX_CHARS = THREADS_MAX_CHARS
/** Failed drafts (post or reply) are retried after this delay. */
const FAILED_RETRY_MS = 60_000
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

let started = false
// Posting and auto-drafting have independent guards so a slow auto-draft run
// (a local model can take minutes) never delays a due scheduled post.
let postingInFlight = false
let autoDraftInFlight = false

export function startScheduler(): void {
  if (started) return
  started = true
  void recoverInterrupted()
  setTimeout(() => tickAll(), FIRST_TICK_MS)
  setInterval(() => tickAll(), TICK_MS)
}

function tickAll(): void {
  void tickPosting()
  void tickAutoDraft()
}

/** A draft stuck in 'posting' means the app died mid-publish.
 *  If we already persisted thread progress, retry can continue without re-posting part 1. */
async function recoverInterrupted(): Promise<void> {
  try {
    for (const d of allDrafts()) {
      if (d.status !== 'posting') continue
      const posted = typeof d.threadPartsPosted === 'number' ? d.threadPartsPosted : 0
      if (d.threadRootId && posted > 0) {
        await updateDraft(d.id, {
          status: 'failed',
          error:
            `Interrupted after publishing ${posted} part(s) of a thread. ` +
            `Retry will continue remaining parts without re-posting earlier ones.`,
        })
      } else {
        await updateDraft(d.id, {
          status: 'failed',
          error:
            'Interrupted while publishing — this post may already be live on Threads. Check your profile before retrying.',
        })
      }
    }
  } catch (err) {
    console.error('[scheduler] recovery failed', err)
  }
}

function isRetryableFailed(d: {
  status: string
  updatedAt?: number
  error?: string
  kind?: string
  threadRootId?: string
  threadPartsPosted?: number
}): boolean {
  if (d.status !== 'failed') return false
  const updated = typeof d.updatedAt === 'number' ? d.updatedAt : 0
  // Mid-thread resume: retry a bit sooner so 2/n lands without waiting a full minute.
  const waitMs = isPartialThreadDraft(d) ? Math.min(FAILED_RETRY_MS, 25_000) : FAILED_RETRY_MS
  if (Date.now() - updated < waitMs) return false
  // Permanent validation errors — don't spin forever.
  const err = (d.error ?? '').toLowerCase()
  // Note: over-limit posts are now split into threads at publish — only hard-fail empty/missing.
  if (/empty|missing the post|thread too long/i.test(err)) return false
  // Cannot safely resume without a root id and with only a generic interrupt.
  if (
    /may already be live on threads\. check your profile/i.test(err) &&
    !d.threadRootId &&
    !parseThreadProgressFromError(d.error)
  ) {
    return false
  }
  return true
}

async function tickPosting(): Promise<void> {
  if (postingInFlight) return
  postingInFlight = true
  try {
    const due = allDrafts().filter(isDue)
    const retries = allDrafts().filter(isRetryableFailed)
    const queue = [...due, ...retries]
    for (const d of queue) {
      // Re-check against the live cache: the user may have unscheduled or edited
      // this draft while an earlier publish in this loop was awaiting.
      const cur = allDrafts().find((x) => x.id === d.id)
      if (!cur) continue
      if (cur.status === 'scheduled' && !isDue(cur)) continue
      if (cur.status === 'failed' && !isRetryableFailed(cur)) continue
      if (cur.status !== 'scheduled' && cur.status !== 'failed') continue
      const res = await postDraftNow(d.id)
      if (!res.ok) console.error(`[scheduler] publish ${d.id} failed: ${res.message}`)
    }
  } catch (err) {
    console.error('[scheduler] posting tick failed', err)
  } finally {
    postingInFlight = false
  }
}

async function tickAutoDraft(): Promise<void> {
  if (autoDraftInFlight) return
  const settings = getSettings()
  if (!settings.autoDraft.enabled) return
  const lastRun = db.get<number>(LAST_RUN_KEY) ?? 0
  if (Date.now() - lastRun < settings.autoDraft.intervalMinutes * 60_000) return
  autoDraftInFlight = true
  try {
    // Stamp before running so a failing run waits a full interval instead of hot-looping.
    await db.set(LAST_RUN_KEY, Date.now())
    await runAutoDraft()
  } catch (err) {
    console.error('[scheduler] auto-draft tick failed', err)
  } finally {
    autoDraftInFlight = false
  }
}

function isDue(d: { status: string; scheduledAt?: number }): boolean {
  return d.status === 'scheduled' && typeof d.scheduledAt === 'number' && d.scheduledAt <= Date.now()
}

/** Parse "Thread part 2/3 failed after 1/3 live" style errors for resume. */
function parseThreadProgressFromError(error?: string): { partsPosted: number } | null {
  if (!error) return null
  const m = error.match(/failed after\s+(\d+)\s*\/\s*\d+\s+live/i)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 1) return null
  return { partsPosted: Math.floor(n) }
}

async function failDraft(
  id: string,
  message: string,
  progress?: { threadRootId?: string; threadPartsPosted?: number; permalink?: string }
): Promise<{ ok: boolean; message: string }> {
  try {
    // Never wipe resume fields — partial threads must retry remaining parts only.
    const cur = allDrafts().find((d) => d.id === id)
    await updateDraft(id, {
      status: 'failed',
      error: message,
      threadRootId: progress?.threadRootId ?? cur?.threadRootId,
      threadPartsPosted: progress?.threadPartsPosted ?? cur?.threadPartsPosted,
      threadsMediaId: progress?.threadRootId ?? cur?.threadsMediaId ?? cur?.threadRootId,
      permalink: progress?.permalink ?? cur?.permalink,
    })
  } catch (err) {
    console.error(`[scheduler] could not persist failed status for ${id}`, err)
  }
  return { ok: false, message }
}

/** Persist thread progress; throws if save fails after media is already live. */
async function persistThreadProgress(
  draftId: string,
  progress: {
    threadRootId: string
    threadPartsPosted: number
    permalink?: string
  }
): Promise<void> {
  await updateDraft(draftId, {
    threadRootId: progress.threadRootId,
    threadPartsPosted: progress.threadPartsPosted,
    threadsMediaId: progress.threadRootId,
    permalink: progress.permalink,
  })
  const verify = allDrafts().find((d) => d.id === draftId)
  if (
    !verify?.threadRootId ||
    verify.threadRootId !== progress.threadRootId ||
    (verify.threadPartsPosted ?? 0) < progress.threadPartsPosted
  ) {
    throw new Error(
      `Could not persist thread progress (root=${progress.threadRootId}, parts=${progress.threadPartsPosted}). ` +
        `Part(s) may already be live — do not re-post from scratch.`
    )
  }
}

type ThreadPublishOpts = {
  draftId: string
  /** Resume from a previous partial publish (never re-post earlier parts). */
  resumeRootId?: string
  resumePartsPosted?: number
  resumePermalink?: string
  /** Prior error text — used to recover partsPosted if fields were lost. */
  priorError?: string
}

/**
 * Publish a top-level post; if text exceeds Threads max chars, split into
 * numbered parts (1/3, 2/3, 3/3) and reply each subsequent part under the root.
 * Progress is persisted after each part so a failed/retry mid-thread does not
 * re-post part 1 (the classic 1/2 duplicate bug).
 */
async function publishPostMaybeThread(
  cfg: { accessToken: string; userId: string },
  text: string,
  imageUrl: string | undefined,
  opts: ThreadPublishOpts
): Promise<{ id: string; permalink?: string; parts: number }> {
  if (!needsThreadSplit(text)) {
    const res = await publishPost(cfg, text, imageUrl)
    return { ...res, parts: 1 }
  }
  const parts = splitIntoThreadParts(text)
  if (parts.length === 0) throw new Error('Nothing to publish after thread split')
  if (parts.length === 1) {
    const res = await publishPost(cfg, parts[0], imageUrl)
    return { ...res, parts: 1 }
  }

  let rootId = (opts.resumeRootId ?? '').trim()
  let partsPosted =
    typeof opts.resumePartsPosted === 'number' && Number.isFinite(opts.resumePartsPosted)
      ? Math.max(0, Math.floor(opts.resumePartsPosted))
      : 0
  let permalink = opts.resumePermalink

  // Recover progress from a prior error if draft fields were lost.
  if ((!rootId || partsPosted < 1) && opts.priorError) {
    const parsed = parseThreadProgressFromError(opts.priorError)
    if (parsed && partsPosted < parsed.partsPosted) {
      partsPosted = parsed.partsPosted
    }
  }

  // Resume: if we already have a root, never re-publish part 1.
  if (rootId && partsPosted < 1) partsPosted = 1

  // Without a root id but with evidence part(s) are live — refuse to re-post part 1.
  if (!rootId && partsPosted >= 1) {
    throw new Error(
      `Thread already partially live (${partsPosted}/${parts.length}) but root id is missing. ` +
        `Check Threads and delete the duplicate root if needed; cannot auto-resume safely.`
    )
  }

  if (partsPosted >= parts.length && rootId) {
    return { id: rootId, permalink, parts: parts.length }
  }

  if (!rootId || partsPosted < 1) {
    // First part is the root post (image only on root).
    const root = await publishPost(cfg, parts[0], imageUrl)
    rootId = root.id
    permalink = root.permalink
    partsPosted = 1
    // MUST land on disk before part 2 — otherwise a retry re-posts 1/n.
    try {
      await persistThreadProgress(opts.draftId, {
        threadRootId: rootId,
        threadPartsPosted: 1,
        permalink,
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Thread part 1/${parts.length} is LIVE (root=${rootId}) but progress save failed: ${detail}. ` +
          `Retry must resume with this root — do not publish a new 1/${parts.length}.`
      )
    }
  }

  for (let i = partsPosted; i < parts.length; i++) {
    // Stagger so Meta containers settle; always reply to root for a flat 1/n thread.
    await delay(1800)
    try {
      await publishReply(cfg, parts[i], rootId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Re-persist progress before failing so the next retry never restarts at 0.
      try {
        await persistThreadProgress(opts.draftId, {
          threadRootId: rootId,
          threadPartsPosted: partsPosted,
          permalink,
        })
      } catch (persistErr) {
        console.error(`[scheduler] re-persist after part ${i + 1} failure`, persistErr)
      }
      throw new Error(
        `Thread part ${i + 1}/${parts.length} failed after ${partsPosted}/${parts.length} live` +
          (rootId ? ` (root=${rootId})` : '') +
          `: ${msg}`
      )
    }
    partsPosted = i + 1
    await persistThreadProgress(opts.draftId, {
      threadRootId: rootId,
      threadPartsPosted: partsPosted,
      permalink,
    })
  }

  return { id: rootId, permalink, parts: parts.length }
}

export async function postDraftNow(id: string): Promise<{ ok: boolean; message: string }> {
  const draft = allDrafts().find((d) => d.id === id)
  if (!draft) return { ok: false, message: 'Draft not found' }
  if (draft.status === 'posting') return { ok: false, message: 'Already posting' }
  if (draft.status === 'posted') return { ok: false, message: 'Already posted' }
  const text = typeof draft.text === 'string' ? draft.text.trim() : ''
  // Fail (not plain-return) so an empty *scheduled* draft stops being retried every tick.
  if (!text) return failDraft(id, 'Draft text is empty')
  if (draft.kind === 'reply') {
    if (!draft.replyToId) return failDraft(id, 'Reply draft is missing the post it replies to')
    if (text.length > MAX_CHARS) {
      return failDraft(id, `Reply exceeds the ${MAX_CHARS}-character limit`)
    }
  } else if (text.length > THREADS_MAX_THREAD_CHARS) {
    return failDraft(
      id,
      `Thread too long (max ~${THREADS_MAX_THREAD_CHARS} chars / multi-post thread). Shorten the draft.`
    )
  }
  const { accessToken, userId } = getSettings().threads
  if (!accessToken) {
    return failDraft(id, 'Threads API is not configured — save credentials in Settings first.')
  }

  // Snapshot resume fields before status flip (re-read after in case of races).
  const resumeRootId = draft.threadRootId
  const resumePartsPosted = draft.threadPartsPosted
  const resumePermalink = draft.permalink
  const priorError = draft.error

  try {
    await updateDraft(id, { status: 'posting', error: undefined })
    // Re-load so we don't lose threadRootId if another path wrote it.
    const live = allDrafts().find((d) => d.id === id) ?? draft
    const cfg = { accessToken, userId }
    const res =
      live.kind === 'reply'
        ? { ...(await publishReply(cfg, text, live.replyToId!)), parts: 1 }
        : await publishPostMaybeThread(cfg, text, live.imageUrl, {
            draftId: id,
            resumeRootId: live.threadRootId || resumeRootId,
            resumePartsPosted: live.threadPartsPosted ?? resumePartsPosted,
            resumePermalink: live.permalink || resumePermalink,
            priorError: priorError,
          })
    try {
      await updateDraft(id, {
        status: 'posted',
        postedAt: Date.now(),
        threadsMediaId: res.id,
        threadRootId: res.parts > 1 ? res.id : live.threadRootId || resumeRootId,
        threadPartsPosted: res.parts > 1 ? res.parts : live.threadPartsPosted ?? resumePartsPosted,
        permalink: res.permalink,
        error: undefined,
      })
    } catch (err) {
      // Publish succeeded; report ok even if the status write failed, or a retry would double-post.
      console.error(`[scheduler] posted ${id} but could not persist status`, err)
    }
    const msg =
      res.parts > 1
        ? `Posted to Threads as a ${res.parts}-part thread (1/${res.parts}…)`
        : 'Posted to Threads'
    return { ok: true, message: msg }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Prefer live draft progress (may have been updated mid-publish).
    const after = allDrafts().find((d) => d.id === id)
    const rootMatch = message.match(/root=([0-9]+)/i)
    return failDraft(id, message, {
      threadRootId: after?.threadRootId || rootMatch?.[1] || resumeRootId,
      threadPartsPosted:
        after?.threadPartsPosted ??
        parseThreadProgressFromError(message)?.partsPosted ??
        resumePartsPosted,
      permalink: after?.permalink || resumePermalink,
    })
  }
}

/** True if this failed post draft is a mid-thread resume (do not generate a new post). */
export function isPartialThreadDraft(d: {
  kind?: string
  status?: string
  threadRootId?: string
  threadPartsPosted?: number
  error?: string
}): boolean {
  if (d.kind === 'reply') return false
  if (d.status !== 'failed' && d.status !== 'posting') return false
  if (d.threadRootId && (d.threadPartsPosted ?? 0) >= 1) return true
  if (parseThreadProgressFromError(d.error)) return true
  if (/part 1\/\d+ is LIVE/i.test(d.error ?? '')) return true
  return false
}
