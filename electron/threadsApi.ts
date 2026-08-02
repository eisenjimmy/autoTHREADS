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
  // Do not preflight the target with GET /{id}. The supported Threads reply
  // flow validates the target when POST /me/threads receives reply_to_id.
  // A separate media lookup can be denied even when the token can publish
  // replies, which makes valid replies fail before the create step.
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
  media_type?: string
  media_url?: string
  thumbnail_url?: string
  children?: { data?: { id?: string; media_type?: string; media_url?: string; thumbnail_url?: string }[] }
}

/** Fields for conversation/replies edges — include media so vision models can see images. */
const REPLY_FIELDS =
  'id,text,username,timestamp,replied_to,has_replies,is_reply,media_type,media_url,thumbnail_url,children{id,media_type,media_url,thumbnail_url}'

/** Collect public image/video-thumbnail URLs from a Threads media object. */
function extractMediaImageUrls(m: {
  media_type?: string
  media_url?: string
  thumbnail_url?: string
  children?: { data?: { media_type?: string; media_url?: string; thumbnail_url?: string }[] }
}): string[] {
  const urls: string[] = []
  const push = (u?: string) => {
    const s = typeof u === 'string' ? u.trim() : ''
    if (s && /^https?:\/\//i.test(s) && !urls.includes(s)) urls.push(s)
  }
  // Prefer thumbnail / smaller CDN variants first. Full-size media_url often
  // produces multi‑MB base64 POSTs that crash text-only local LLM servers
  // (ECONNREFUSED) when AutoThreads tries vision.
  push(m.thumbnail_url)
  push(m.media_url)
  const kids = m.children?.data
  if (Array.isArray(kids)) {
    for (const c of kids) {
      push(c.thumbnail_url)
      push(c.media_url)
    }
  }
  // Cap so we don't flood the vision context.
  return urls.slice(0, 3)
}

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
      const imageUrls = extractMediaImageUrls(m)
      const text =
        typeof m.text === 'string' && m.text.trim()
          ? m.text.trim()
          : imageUrls.length > 0
            ? '(image reply)'
            : ''
      // Skip empty text-only noise; keep image-only replies for vision.
      if (!text) continue

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
        ...(imageUrls.length > 0 ? { imageUrls } : {}),
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
  media_type?: string
  media_url?: string
  thumbnail_url?: string
  children?: { data?: { id?: string; media_type?: string; media_url?: string; thumbnail_url?: string }[] }
  owner?: { id?: string; username?: string }
}

export type MentionsFetchResult = {
  items: UnansweredReply[]
  /** Set when the Mentions API call failed (e.g. missing threads_manage_mentions). */
  error?: string
  /** Raw media objects returned by the API before local filters. */
  rawCount?: number
  /** How many were dropped as already answered (local or Graph probe). */
  skippedAnswered?: number
}

/**
 * Public posts where another profile @mentioned you (Threads Mentions API).
 * Tries `/me/mentions` then numeric user id. Paginates. Requires
 * `threads_manage_mentions` on the access token.
 *
 * Note (Meta): without Advanced Access for threads_manage_mentions, only
 * mentions from app Testers are returned — everyone else yields an empty list.
 */
export async function fetchUnansweredMentions(
  cfg: ThreadsCfg,
  alreadyAnsweredIds?: Set<string>
): Promise<MentionsFetchResult> {
  const me = await apiGet<{ id?: string; username?: string }>(cfg, '/me', { fields: 'id,username' })
  const myUsername = (typeof me.username === 'string' ? me.username : '').toLowerCase()
  const myId = typeof me.id === 'string' && /^\d+$/.test(me.id) ? me.id : ''

  // Recent window — Meta requires since >= 1688540400.
  const since = Math.max(1688540400, Math.floor(Date.now() / 1000) - 14 * 24 * 3600)
  const until = Math.floor(Date.now() / 1000)
  const fields =
    'id,text,username,timestamp,permalink,shortcode,media_type,media_url,thumbnail_url,is_reply,owner{id,username},children{id,media_type,media_url,thumbnail_url}'

  type MentionsPage = {
    data?: RawMention[]
    paging?: { cursors?: { after?: string }; next?: string }
  }

  async function fetchPath(path: string): Promise<{ pages: RawMention[]; error?: string }> {
    const collected: RawMention[] = []
    let after: string | undefined
    try {
      for (let page = 0; page < 5; page++) {
        const params: Record<string, string> = {
          fields,
          limit: '50',
          since: String(since),
          until: String(until),
        }
        if (after) params.after = after
        const data = await apiGet<MentionsPage>(cfg, path, params)
        const batch = data.data ?? []
        collected.push(...batch)
        after = data.paging?.cursors?.after
        if (!after || batch.length === 0) break
      }
      return { pages: collected }
    } catch (err) {
      const message = errText(err)
      // Fallback without since/until (some tokens reject the params).
      try {
        const data = await apiGet<MentionsPage>(cfg, path, { fields, limit: '50' })
        return { pages: data.data ?? [] }
      } catch (err2) {
        return { pages: [], error: errText(err2) || message }
      }
    }
  }

  // Prefer `me`; also try numeric id when present (some tokens behave differently).
  let raw: RawMention[] = []
  let lastError: string | undefined
  const paths = ['/me/mentions', ...(myId ? [`/${myId}/mentions`] : [])]
  for (const path of paths) {
    const res = await fetchPath(path)
    if (res.pages.length > 0) {
      raw = res.pages
      lastError = undefined
      break
    }
    if (res.error) lastError = res.error
  }

  if (raw.length === 0 && lastError) {
    console.warn('[threads] mentions fetch failed (need threads_manage_mentions?):', lastError)
    return {
      items: [],
      rawCount: 0,
      skippedAnswered: 0,
      error:
        `Mentions API failed: ${lastError}. ` +
        'Regenerate your Threads token with the threads_manage_mentions permission. ' +
        'Without Advanced Access, only mentions from Meta app Testers appear.',
    }
  }

  console.info(`[threads] mentions API returned ${raw.length} media object(s)`)

  // De-dupe by media id across pages / path retries.
  const seenMedia = new Set<string>()
  const out: UnansweredReply[] = []
  let skippedAnswered = 0
  let probeBudget = ANSWER_PROBE_BUDGET
  for (const m of raw) {
    if (typeof m.id !== 'string' || !m.id) continue
    if (seenMedia.has(m.id)) continue
    seenMedia.add(m.id)

    // username is not always present on mention media — fall back to owner.username.
    let username =
      typeof m.username === 'string' && m.username.trim()
        ? m.username.trim()
        : typeof m.owner?.username === 'string' && m.owner.username.trim()
          ? m.owner.username.trim()
          : ''
    if (!username) username = 'someone'
    if (myUsername && username.toLowerCase() === myUsername) continue

    // Already handled locally (posted/drafted) — don't re-probe Graph.
    if (alreadyAnsweredIds?.has(m.id)) {
      skippedAnswered++
      continue
    }

    const imageUrls = extractMediaImageUrls(m)
    // Media-only mentions may have empty text — still replyable.
    const text =
      typeof m.text === 'string' && m.text.trim()
        ? m.text.trim()
        : imageUrls.length > 0
          ? '(mentioned you with an image)'
          : '(mentioned you in a post)'

    // Skip mentions we already answered under (best-effort Graph probe).
    if (probeBudget > 0 && myUsername) {
      probeBudget--
      if (await isAnsweredByMe(cfg, m.id, myUsername)) {
        skippedAnswered++
        continue
      }
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
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
    })
  }

  if (raw.length === 0) {
    // Empty is often Advanced Access, not a hard error — surface a clear hint.
    return {
      items: [],
      rawCount: 0,
      skippedAnswered: 0,
      error:
        'Mentions API returned 0 items. If people @mention you but nothing shows: ' +
        'Meta only returns non-tester mentions after Advanced Access for threads_manage_mentions. ' +
        'Also confirm the token was regenerated after enabling that permission.',
    }
  }

  return { items: out, rawCount: raw.length, skippedAnswered }
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
  opts?: { includeMentions?: boolean; alreadyAnsweredIds?: Set<string> }
): Promise<{
  replies: UnansweredReply[]
  mentionError?: string
  mentionRawCount?: number
  mentionSkippedAnswered?: number
  threadCap: ThreadReplyCapStats
}> {
  const includeMentions = opts?.includeMentions !== false
  const { replies, threadCap } = await fetchUnansweredPostReplies(cfg)
  let mentions: UnansweredReply[] = []
  let mentionError: string | undefined
  let mentionRawCount = 0
  let mentionSkippedAnswered = 0
  if (includeMentions) {
    const m = await fetchUnansweredMentions(cfg, opts?.alreadyAnsweredIds)
    mentions = m.items
    mentionError = m.error
    mentionRawCount = m.rawCount ?? 0
    mentionSkippedAnswered = m.skippedAnswered ?? 0
  }
  // Mentions first (higher priority), then post replies; de-dupe by id.
  const seen = new Set<string>()
  const out: UnansweredReply[] = []
  for (const item of [...mentions, ...replies]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  // Cap inbox size but keep room for nested replies across recent posts.
  // Keep mention priority when trimming: mentions already lead the list.
  return {
    replies: out.slice(0, 100),
    mentionError,
    mentionRawCount,
    mentionSkippedAnswered,
    threadCap,
  }
}
