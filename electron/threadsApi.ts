import type { TestResult, ThreadsPost, UnansweredReply } from './types'

/** Meta Threads Graph API client. All calls carry a 15s abort timeout. */

const BASE = 'https://graph.threads.net/v1.0'
const TIMEOUT_MS = 15000

export interface ThreadsCfg {
  accessToken: string
  userId: string
}

class ThreadsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message)
    this.name = 'ThreadsApiError'
  }
}

/** Prefer an explicit Threads user id; fall back to `me`. Wrong/stale user ids cause
 *  "The requested resource does not exist" on create/publish. */
const uid = (cfg: ThreadsCfg): string => {
  const id = cfg.userId.trim()
  // Threads media/user ids are numeric strings; reject obviously bad values.
  if (id && /^\d+$/.test(id)) return id
  return 'me'
}
const snippet = (body: string): string => body.replace(/\s+/g, ' ').trim().slice(0, 200) || '(empty body)'
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

async function apiFetch<T>(
  cfg: ThreadsCfg,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string>
): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: cfg.accessToken })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res =
      method === 'GET'
        ? await fetch(`${BASE}${path}?${qs}`, { signal: controller.signal })
        : await fetch(`${BASE}${path}`, { method: 'POST', body: qs, signal: controller.signal })
    const body = await res.text()
    let json: unknown = null
    try {
      json = body ? JSON.parse(body) : null
    } catch {
      json = null
    }
    if (!res.ok) {
      const apiErr = (json as { error?: { message?: string; code?: number } } | null)?.error
      if (apiErr && typeof apiErr.message === 'string') {
        throw new ThreadsApiError('Threads API: ' + apiErr.message, res.status, apiErr.code)
      }
      throw new ThreadsApiError(`Threads API: HTTP ${res.status} — ${snippet(body)}`, res.status)
    }
    if (json === null || typeof json !== 'object') {
      throw new ThreadsApiError(`Threads API: unexpected non-JSON response (HTTP ${res.status}) — ${snippet(body)}`, res.status)
    }
    return json as T
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Threads API: request to ${path} timed out after ${TIMEOUT_MS / 1000}s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const apiGet = <T>(cfg: ThreadsCfg, path: string, params: Record<string, string>): Promise<T> =>
  apiFetch<T>(cfg, 'GET', path, params)
const apiPost = <T>(cfg: ThreadsCfg, path: string, params: Record<string, string>): Promise<T> =>
  apiFetch<T>(cfg, 'POST', path, params)

export async function testThreads(cfg: ThreadsCfg): Promise<TestResult & { username?: string; userId?: string }> {
  try {
    const me = await apiGet<{ id?: string; username?: string }>(cfg, '/me', { fields: 'id,username' })
    const username = typeof me.username === 'string' ? me.username : ''
    const userId = typeof me.id === 'string' ? me.id : ''
    return { ok: true, message: `Connected as @${username}`, username, userId }
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err)
    if (err instanceof ThreadsApiError && (err.status === 401 || err.code === 190)) {
      message += ' (access token looks expired or invalid — generate a new one)'
    }
    return { ok: false, message }
  }
}

// Container may need a moment before threads_publish accepts it.
// Meta often returns "does not exist" if publish runs immediately after create
// (common for replies). Wait + retry; see Threads two-step publish docs.
const isTransientPublishError = (err: unknown): boolean => {
  const m = errText(err)
  return /not ready|not found|not finished|not available|try again|temporarily|does not exist|in progress|processing/i.test(
    m
  )
}

const isMissingResourceError = (err: unknown): boolean => {
  const m = errText(err)
  return /does not exist|invalid.*id|unsupported get request/i.test(m)
}

/** True when the media id is still addressable via the Graph API. */
export async function threadsMediaExists(cfg: ThreadsCfg, mediaId: string): Promise<boolean> {
  if (!mediaId.trim()) return false
  try {
    const media = await apiGet<{ id?: string }>(cfg, `/${mediaId.trim()}`, { fields: 'id' })
    return typeof media.id === 'string' && media.id.length > 0
  } catch {
    return false
  }
}

/**
 * Two-step Threads publish against a specific user path (`me` or numeric id).
 * Waits after create before the first publish — immediate publish is a common
 * cause of "The requested resource does not exist" on replies.
 */
async function publishAgainstUser(
  cfg: ThreadsCfg,
  userPath: string,
  text: string,
  replyToId?: string,
  imageUrl?: string
): Promise<{ id: string; permalink?: string }> {
  const createParams: Record<string, string> = imageUrl
    ? { media_type: 'IMAGE', image_url: imageUrl, text }
    : { media_type: 'TEXT', text }
  if (replyToId) createParams.reply_to_id = replyToId

  let created: { id?: string }
  try {
    created = await apiPost<{ id?: string }>(cfg, `/${userPath}/threads`, createParams)
  } catch (err) {
    // Bad/expired image URLs often surface as "resource does not exist" — fall back to text.
    if (imageUrl && isMissingResourceError(err)) {
      return publishAgainstUser(cfg, userPath, text, replyToId, undefined)
    }
    throw err
  }
  if (typeof created.id !== 'string' || !created.id) {
    throw new Error('Threads API: create step returned no creation id')
  }

  // Give the container time to register before the first publish attempt.
  await delay(replyToId ? 2500 : 1200)

  let mediaId = ''
  let lastErr: unknown
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const published = await apiPost<{ id?: string }>(cfg, `/${userPath}/threads_publish`, {
        creation_id: created.id,
      })
      if (typeof published.id !== 'string' || !published.id) {
        throw new Error('Threads API: publish step returned no media id')
      }
      mediaId = published.id
      lastErr = undefined
      break
    } catch (err) {
      lastErr = err
      if (attempt >= 7 || !isTransientPublishError(err)) throw err
      // Back off: 2s, 3s, 4s… — containers sometimes need several seconds.
      await delay(2000 + attempt * 1000)
    }
  }
  if (!mediaId) {
    throw lastErr instanceof Error ? lastErr : new Error('Threads API: publish failed')
  }

  let permalink: string | undefined
  try {
    const media = await apiGet<{ permalink?: string }>(cfg, `/${mediaId}`, { fields: 'permalink' })
    if (typeof media.permalink === 'string' && media.permalink) permalink = media.permalink
  } catch {
    // best-effort: post succeeded, permalink stays undefined
  }
  return { id: mediaId, permalink }
}

async function publish(
  cfg: ThreadsCfg,
  text: string,
  replyToId?: string,
  imageUrl?: string
): Promise<{ id: string; permalink?: string }> {
  const primary = uid(cfg)
  try {
    return await publishAgainstUser(cfg, primary, text, replyToId, imageUrl)
  } catch (err) {
    // Stale/wrong User ID in settings → "resource does not exist". Retry as `me`.
    if (primary !== 'me' && isMissingResourceError(err)) {
      console.warn(
        `[threads] publish via user id ${primary} failed (${errText(err)}); retrying as me`
      )
      return publishAgainstUser(cfg, 'me', text, replyToId, imageUrl)
    }
    throw err
  }
}

export async function publishPost(
  cfg: ThreadsCfg,
  text: string,
  imageUrl?: string
): Promise<{ id: string; permalink?: string }> {
  return publish(cfg, text, undefined, imageUrl)
}

export async function publishReply(
  cfg: ThreadsCfg,
  text: string,
  replyToId: string
): Promise<{ id: string; permalink?: string }> {
  const target = replyToId.trim()
  if (!target) throw new Error('Threads API: reply target id is empty')
  // Avoid create+publish round-trips against deleted/expired media ids.
  if (!(await threadsMediaExists(cfg, target))) {
    throw new Error(
      `Threads API: reply target ${target} no longer exists (deleted or expired). Skipping this reply.`
    )
  }
  try {
    return await publish(cfg, text, target)
  } catch (err) {
    const m = errText(err)
    // Surface the target id so the activity log is actionable.
    if (isMissingResourceError(err)) {
      throw new Error(
        `Threads API: could not publish reply to ${target} — ${m}. ` +
          'Often fixed by clearing a wrong User ID in Settings (leave blank) or waiting for the container to finish.'
      )
    }
    throw err
  }
}

export async function fetchMyPosts(cfg: ThreadsCfg, limit: number): Promise<ThreadsPost[]> {
  const n = Math.max(1, Math.min(100, Math.floor(limit) || 1))
  const data = await apiGet<{ data?: Array<Partial<ThreadsPost>> }>(cfg, '/me/threads', {
    fields: 'id,text,timestamp,permalink',
    limit: String(n),
  })
  const posts: ThreadsPost[] = []
  for (const p of data.data ?? []) {
    if (typeof p.id !== 'string' || !p.id) continue
    posts.push({
      id: p.id,
      text: typeof p.text === 'string' ? p.text : '',
      timestamp: typeof p.timestamp === 'string' ? p.timestamp : '',
      permalink: typeof p.permalink === 'string' && p.permalink ? p.permalink : undefined,
    })
  }
  return posts
}

export async function scrapeRecentTexts(cfg: ThreadsCfg, count: number): Promise<string[]> {
  const n = Math.max(1, Math.floor(count) || 1)
  const posts = await fetchMyPosts(cfg, n * 2)
  return posts.map((p) => p.text).filter((t) => t.trim().length > 0).slice(0, n)
}

/** A public Threads post found via keyword search (for discovery engagement). */
export interface DiscoverPost {
  id: string
  text: string
  username: string
  timestamp: string
  permalink?: string
}

/**
 * Search public Threads posts by keyword.
 * Requires `threads_keyword_search`. Without advanced access, only the auth user's own posts return.
 */
export async function searchKeywordPosts(
  cfg: ThreadsCfg,
  keyword: string,
  limit = 15
): Promise<{ ok: boolean; posts: DiscoverPost[]; message: string }> {
  const q = keyword.trim()
  if (!q) return { ok: false, posts: [], message: 'Keyword is empty' }
  const n = Math.max(1, Math.min(50, Math.floor(limit) || 15))
  try {
    // Endpoint is app-root level: /keyword_search (not under /me).
    const data = await apiGet<{ data?: Array<Partial<DiscoverPost> & { is_reply?: boolean }> }>(
      cfg,
      '/keyword_search',
      {
        q,
        search_type: 'RECENT',
        search_mode: 'KEYWORD',
        media_type: 'TEXT',
        fields: 'id,text,username,timestamp,permalink,is_reply,has_replies',
        limit: String(n),
      }
    )
    const posts: DiscoverPost[] = []
    for (const p of data.data ?? []) {
      if (typeof p.id !== 'string' || !p.id) continue
      if (p.is_reply === true) continue // prefer root posts for discovery replies
      const text = typeof p.text === 'string' ? p.text.trim() : ''
      if (!text) continue
      posts.push({
        id: p.id,
        text,
        username: typeof p.username === 'string' && p.username ? p.username : 'someone',
        timestamp: typeof p.timestamp === 'string' ? p.timestamp : '',
        permalink: typeof p.permalink === 'string' ? p.permalink : undefined,
      })
    }
    return { ok: true, posts, message: `Found ${posts.length} post(s) for "${q}"` }
  } catch (err) {
    return {
      ok: false,
      posts: [],
      message:
        errText(err) +
        ' (needs threads_keyword_search; public results need advanced access / app review)',
    }
  }
}

interface RawReply {
  id?: string
  text?: string
  username?: string
  timestamp?: string
  has_replies?: boolean
  is_reply?: boolean
  replied_to?: { id?: string }
}

const REPLY_FIELDS = 'id,text,username,timestamp,replied_to,has_replies,is_reply'

type PagedReplies = {
  data?: RawReply[]
  paging?: { cursors?: { after?: string }; next?: string }
}

/** Fetch all pages of a replies/conversation edge (up to maxPages). */
async function fetchAllReplyPages(
  cfg: ThreadsCfg,
  path: string,
  maxPages = 5
): Promise<RawReply[]> {
  const out: RawReply[] = []
  let after: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = { fields: REPLY_FIELDS, limit: '100' }
    if (after) params.after = after
    const data = await apiGet<PagedReplies>(cfg, path, params)
    const batch = data.data ?? []
    out.push(...batch)
    after = data.paging?.cursors?.after
    if (!after || batch.length === 0) break
  }
  return out
}

/**
 * Full conversation under a post.
 * Prefer /conversation (flattened tree including nested replies). Fall back to
 * /replies and walk children so ongoing threads aren't limited to the first
 * top-level comment.
 */
async function fetchReplyMessages(
  cfg: ThreadsCfg,
  postId: string,
  expandBudget: { left: number }
): Promise<{ items: RawReply[]; source: 'conversation' | 'replies-tree' }> {
  try {
    const items = await fetchAllReplyPages(cfg, `/${postId}/conversation`, 5)
    return { items, source: 'conversation' }
  } catch {
    // /replies is top-level only — expand nested replies so later comments in a
    // thread are still discovered.
    const top = await fetchAllReplyPages(cfg, `/${postId}/replies`, 5)
    const all: RawReply[] = [...top]
    const seen = new Set(top.map((r) => r.id).filter((id): id is string => typeof id === 'string'))
    const queue = [...top]
    while (queue.length > 0 && expandBudget.left > 0) {
      const parent = queue.shift()!
      if (typeof parent.id !== 'string' || !parent.id) continue
      // Skip expand when API says there are no children (when field present).
      if (parent.has_replies === false) continue
      expandBudget.left--
      try {
        const children = await fetchAllReplyPages(cfg, `/${parent.id}/replies`, 3)
        for (const child of children) {
          if (typeof child.id !== 'string' || !child.id || seen.has(child.id)) continue
          seen.add(child.id)
          all.push(child)
          queue.push(child)
        }
      } catch {
        // Best-effort expand; keep what we have.
      }
    }
    return { items: all, source: 'replies-tree' }
  }
}

// Bounded probes so a busy account can't fan out into hundreds of answer checks.
const ANSWER_PROBE_BUDGET = 80
const REPLY_EXPAND_BUDGET = 60

/**
 * Hard stop for long Threads conversations.
 * Per root post, at most this many unanswered replies are returned (newest first).
 * Not configurable — keeps Full-Auto and the Replies page deterministic on viral threads.
 */
export const MAX_UNANSWERED_REPLIES_PER_THREAD = 20

export type ThreadReplyCapStats = {
  maxPerThread: number
  threadsTruncated: number
  dropped: number
}

const replyTimestamp = (s: string): number => {
  const t = Date.parse(s)
  return Number.isNaN(t) ? 0 : t
}

async function isAnsweredByMe(cfg: ThreadsCfg, replyId: string, myUsername: string): Promise<boolean> {
  const me = myUsername.toLowerCase()
  if (!me) return false
  try {
    const data = await apiGet<{ data?: RawReply[] }>(cfg, `/${replyId}/replies`, {
      fields: 'id,username',
      limit: '50',
    })
    return (data.data ?? []).some((r) => (r.username ?? '').toLowerCase() === me)
  } catch {
    // If we cannot tell, assume unanswered — the UI de-dupes against local reply drafts.
    return false
  }
}

/**
 * All unanswered replies under your recent posts — including nested replies in
 * ongoing threads (not just the first top-level comment on each post).
 * Long threads are capped at {@link MAX_UNANSWERED_REPLIES_PER_THREAD} (newest first).
 */
async function fetchUnansweredPostReplies(
  cfg: ThreadsCfg
): Promise<{ replies: UnansweredReply[]; threadCap: ThreadReplyCapStats }> {
  const me = await apiGet<{ username?: string }>(cfg, '/me', { fields: 'id,username' })
  const myUsername = (typeof me.username === 'string' ? me.username : '').toLowerCase()
  // More posts so busy accounts still surface newer threads.
  const posts = await fetchMyPosts(cfg, 25)
  const out: UnansweredReply[] = []
  let probeBudget = ANSWER_PROBE_BUDGET
  const expandBudget = { left: REPLY_EXPAND_BUDGET }
  let threadsTruncated = 0
  let dropped = 0
  const cap = MAX_UNANSWERED_REPLIES_PER_THREAD

  // Sequential on purpose: parallel conversation fetches trip Meta rate limits.
  for (const post of posts) {
    let items: RawReply[]
    let source: 'conversation' | 'replies-tree'
    try {
      const fetched = await fetchReplyMessages(cfg, post.id, expandBudget)
      items = fetched.items
      source = fetched.source
    } catch (err) {
      console.warn(`[threads] could not load replies for ${post.id}:`, errText(err))
      continue
    }

    // Map every message we authored → the parent we replied to (answered).
    const answeredIds = new Set<string>()
    for (const m of items) {
      const uname = (m.username ?? '').toLowerCase()
      if (uname && myUsername && uname === myUsername && typeof m.replied_to?.id === 'string') {
        answeredIds.add(m.replied_to.id)
      }
    }

    // Collect unanswered for THIS root post only, then hard-cap (deterministic).
    const forPost: UnansweredReply[] = []
    for (const m of items) {
      if (typeof m.id !== 'string' || !m.id) continue
      // Skip the root post if it appears in the conversation list.
      if (m.id === post.id) continue
      const uname = (m.username ?? '').toLowerCase()
      if (!uname || (myUsername && uname === myUsername)) continue
      if (answeredIds.has(m.id)) continue

      // IMPORTANT: include nested replies (replied_to !== root). Previously we
      // only kept top-level replies, so ongoing threads were ignored after the
      // first comment.
      const text = typeof m.text === 'string' ? m.text : ''
      if (!text.trim()) continue

      // /replies-tree may not include our own nested answers inline — probe.
      if (source === 'replies-tree' && probeBudget > 0 && myUsername) {
        probeBudget--
        if (await isAnsweredByMe(cfg, m.id, myUsername)) continue
      }

      forPost.push({
        id: m.id,
        text,
        username: m.username!,
        timestamp: typeof m.timestamp === 'string' ? m.timestamp : '',
        rootPostId: post.id,
        rootPostText: post.text,
        kind: 'reply',
      })
    }

    // Newest first within the thread, then stop at 20 — never process the rest.
    forPost.sort((a, b) => replyTimestamp(b.timestamp) - replyTimestamp(a.timestamp))
    if (forPost.length > cap) {
      threadsTruncated++
      dropped += forPost.length - cap
      out.push(...forPost.slice(0, cap))
    } else {
      out.push(...forPost)
    }
  }

  // Newest first across posts so recent threads get attention first.
  out.sort((a, b) => replyTimestamp(b.timestamp) - replyTimestamp(a.timestamp))
  console.info(
    `[threads] unanswered post-replies: ${out.length}` +
      ` (per-thread cap ${cap}; truncated ${threadsTruncated} thread(s), dropped ${dropped})`
  )
  return {
    replies: out,
    threadCap: { maxPerThread: cap, threadsTruncated, dropped },
  }
}

interface RawMention {
  id?: string
  text?: string
  username?: string
  timestamp?: string
  permalink?: string
  shortcode?: string
  is_reply?: boolean
  owner?: { id?: string; username?: string }
}

export type MentionsFetchResult = {
  items: UnansweredReply[]
  /** Set when the Mentions API call failed (e.g. missing threads_manage_mentions). */
  error?: string
}

/**
 * Public posts where another profile @mentioned you (Threads Mentions API).
 * Always queries `/me/mentions` (more reliable than a stored user id).
 * Requires `threads_manage_mentions` on the access token.
 */
export async function fetchUnansweredMentions(cfg: ThreadsCfg): Promise<MentionsFetchResult> {
  const me = await apiGet<{ id?: string; username?: string }>(cfg, '/me', { fields: 'id,username' })
  const myUsername = (typeof me.username === 'string' ? me.username : '').toLowerCase()

  // Recent window — Meta requires since >= 1688540400.
  const since = Math.max(1688540400, Math.floor(Date.now() / 1000) - 14 * 24 * 3600)
  const fields =
    'id,text,username,timestamp,permalink,shortcode,media_type,is_reply,owner{id,username}'

  let data: { data?: RawMention[] }
  try {
    // Prefer `me` — wrong numeric User ID in settings previously returned empty/errors.
    data = await apiGet(cfg, '/me/mentions', {
      fields,
      limit: '50',
      since: String(since),
    })
  } catch (err) {
    const message = errText(err)
    console.warn('[threads] /me/mentions failed:', message)
    // Fallback without since (some tokens reject the param).
    try {
      data = await apiGet(cfg, '/me/mentions', { fields, limit: '50' })
    } catch (err2) {
      const msg = errText(err2)
      console.warn('[threads] mentions fetch failed (need threads_manage_mentions?):', msg)
      return {
        items: [],
        error:
          `Mentions API failed: ${msg}. ` +
          'Regenerate your Threads token with the threads_manage_mentions permission.',
      }
    }
  }

  const raw = data.data ?? []
  console.info(`[threads] mentions API returned ${raw.length} media object(s)`)

  const out: UnansweredReply[] = []
  let probeBudget = ANSWER_PROBE_BUDGET
  for (const m of raw) {
    if (typeof m.id !== 'string' || !m.id) continue

    // username is not always present on mention media — fall back to owner.username.
    let username =
      typeof m.username === 'string' && m.username.trim()
        ? m.username.trim()
        : typeof m.owner?.username === 'string' && m.owner.username.trim()
          ? m.owner.username.trim()
          : ''
    if (!username) username = 'someone'
    if (myUsername && username.toLowerCase() === myUsername) continue

    // Media-only mentions may have empty text — still replyable.
    const text =
      typeof m.text === 'string' && m.text.trim()
        ? m.text.trim()
        : '(mentioned you in a post)'

    // Skip mentions we already answered under (best-effort).
    if (probeBudget > 0 && myUsername) {
      probeBudget--
      if (await isAnsweredByMe(cfg, m.id, myUsername)) continue
    }

    out.push({
      id: m.id,
      text,
      username,
      timestamp: typeof m.timestamp === 'string' ? m.timestamp : '',
      // For mentions the media itself is the post to reply to.
      rootPostId: m.id,
      rootPostText: text,
      kind: 'mention',
    })
  }
  return { items: out }
}

/**
 * Unanswered engagement: replies on your posts + (optional) @mentions of you.
 * Mentions require `threads_manage_mentions`; failures degrade to replies only
 * and surface `mentionError` for the UI/activity log.
 */
export async function fetchUnansweredReplies(
  cfg: ThreadsCfg,
  opts?: { includeMentions?: boolean }
): Promise<UnansweredReply[]> {
  const result = await fetchUnansweredEngagement(cfg, opts)
  return result.replies
}

export async function fetchUnansweredEngagement(
  cfg: ThreadsCfg,
  opts?: { includeMentions?: boolean }
): Promise<{
  replies: UnansweredReply[]
  mentionError?: string
  threadCap: ThreadReplyCapStats
}> {
  const includeMentions = opts?.includeMentions !== false
  const { replies, threadCap } = await fetchUnansweredPostReplies(cfg)
  let mentions: UnansweredReply[] = []
  let mentionError: string | undefined
  if (includeMentions) {
    const m = await fetchUnansweredMentions(cfg)
    mentions = m.items
    mentionError = m.error
  }
  const seen = new Set(replies.map((r) => r.id))
  const out = [...replies]
  for (const item of mentions) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  out.sort((a, b) => replyTimestamp(b.timestamp) - replyTimestamp(a.timestamp))
  // Cap inbox size but keep room for nested replies across recent posts.
  return { replies: out.slice(0, 100), mentionError, threadCap }
}
