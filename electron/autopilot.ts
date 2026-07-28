import { db } from './localdb'
import { getSettings } from './settings'
import { fetchTopicNews } from './news'
import { fetchUnansweredEngagement, searchKeywordPosts } from './threadsApi'
import { allDrafts, upsertDraft } from './drafts'
import { postDraftNow } from './scheduler'
import {
  collectRecentPostMemory,
  decideAutopilotPlan,
  generateAutopilotPost,
  generateAutopilotReply,
  postsTooSimilar,
  unconfiguredMessage,
  type AutopilotCandidate,
} from './pipeline'
import type { AutopilotLogEntry, AutopilotLogKind, AutopilotStatus, Draft } from './types'

/**
 * Full-Auto engine. Runs entirely in the main process on its own interval and,
 * when launched, decides on its own whether to post, what to post, and answers
 * replies — all without human intervention. Every side effect flows through the
 * same draft store + publisher the manual workflow uses, so autopilot activity
 * is visible in Drafts/Queue and shares the publish guards.
 */

const TICK_MS = 10_000 // poll often so 5-min reply timer and 1-min retries fire promptly
const FIRST_TICK_MS = 3_000
const RETRY_AFTER_MS = 60_000 // failed posts/replies re-attempt after 1 minute
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const AP_DAY = 'autopilotDay'
const AP_POSTS = 'autopilotPostsToday'
const AP_REPLIES = 'autopilotRepliesToday'
const AP_LAST_RUN = 'autopilotLastRun' // last post/think pass
const AP_LAST_REPLY_RUN = 'autopilotLastReplyRun' // last replies+mentions pass
const AP_LOG = 'autopilotLog'
const AP_USED_LINKS = 'autopilotUsedLinks'
const AP_ANSWERED = 'autopilotAnswered'
const AP_DISCOVER_ANSWERED = 'autopilotDiscoverAnswered'
const AP_DISCOVER_DAY = 'autopilotDiscoverDay'
const AP_DISCOVER_COUNT = 'autopilotDiscoverToday'
const LOG_LIMIT = 80

/**
 * Category id → news search seed tuned for Threads-native niches.
 * Empty string = original content only (no news scrape) — e.g. pure humor.
 * Prefer queries that surface the kind of stories AI/tech Threads accounts riff on.
 */
const CATEGORY_QUERY: Record<string, string> = {
  ai: 'artificial intelligence AI ChatGPT OpenAI Claude Gemini LLM',
  technology: 'technology gadgets software',
  development: 'software engineering programming coding developers',
  startups: 'startups founders venture capital',
  productivity: 'productivity tools apps workflow',
  sidehustle: 'side hustle freelancing indie hacker online business',
  creator: 'creator economy influencers content creators monetization',
  career: 'career advice remote work jobs tech careers',
  crypto: 'cryptocurrency bitcoin ethereum web3',
  finance: 'personal finance markets investing',
  marketing: 'marketing growth hacking social media',
  humor: '',
  gaming: 'video games gaming industry esports',
  fitness: 'fitness workout health training',
  business: 'business entrepreneurship companies',
  science: 'science research breakthroughs',
  health: 'health wellness medicine',
  fashion: 'fashion style trends',
  beauty: 'beauty skincare makeup',
  lifestyle: 'lifestyle culture trends',
  food: 'food restaurants cooking',
  travel: 'travel destinations tourism',
  sports: 'sports games leagues',
  entertainment: 'entertainment celebrities culture',
  music: 'music artists albums',
  movies: 'movies TV shows streaming',
  books: 'books authors reading',
  design: 'design UX product design',
  environment: 'climate environment sustainability',
  education: 'education learning online courses',
}

let started = false
/** Independent locks so a long post/LLM pass never blocks the reply timer. */
let postBusy = false
let replyBusy = false
let logSeq = 0

let statusListener: ((status: AutopilotStatus) => void) | null = null

export function setAutopilotStatusListener(cb: (status: AutopilotStatus) => void): void {
  statusListener = cb
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const dayKey = (): string => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD (local)
const isBusy = (): boolean => postBusy || replyBusy

function getInt(key: string): number {
  const v = db.get<number>(key)
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Schedule the next pass ~1 minute from now (for failures). */
async function scheduleRetry(kind: 'post' | 'reply'): Promise<void> {
  const ap = getSettings().autopilot
  const intervalMin = kind === 'post' ? ap.intervalMinutes : ap.replyIntervalMinutes
  const key = kind === 'post' ? AP_LAST_RUN : AP_LAST_REPLY_RUN
  // lastRun = now - interval + 1min  →  due again after 1 minute
  const stamp = Date.now() - intervalMin * 60_000 + RETRY_AFTER_MS
  await db.set(key, stamp)
  log('info', `${kind === 'post' ? 'Post' : 'Reply'} failure — will retry in ~1 minute.`)
}

/** Reset the per-day counters when the local date rolls over. */
function rolloverDaily(): { posts: number; replies: number } {
  const today = dayKey()
  if (db.get<string>(AP_DAY) !== today) {
    void db.set(AP_DAY, today)
    void db.set(AP_POSTS, 0)
    void db.set(AP_REPLIES, 0)
    return { posts: 0, replies: 0 }
  }
  return { posts: getInt(AP_POSTS), replies: getInt(AP_REPLIES) }
}

function readLog(): AutopilotLogEntry[] {
  const raw = db.get<AutopilotLogEntry[]>(AP_LOG)
  return Array.isArray(raw) ? raw : []
}

function log(kind: AutopilotLogKind, message: string, permalink?: string): void {
  const entry: AutopilotLogEntry = {
    id: `${Date.now()}-${logSeq++}`,
    at: Date.now(),
    kind,
    message,
    ...(permalink ? { permalink } : {}),
  }
  const next = [entry, ...readLog()].slice(0, LOG_LIMIT)
  void db.set(AP_LOG, next)
  broadcastStatus()
}

export function buildAutopilotStatus(): AutopilotStatus {
  const settings = getSettings()
  const ap = settings.autopilot
  const today = dayKey()
  const sameDay = db.get<string>(AP_DAY) === today
  const posts = sameDay ? getInt(AP_POSTS) : 0
  const replies = sameDay ? getInt(AP_REPLIES) : 0
  const lastRunAt = db.get<number>(AP_LAST_RUN) ?? null
  const lastReplyRunAt = db.get<number>(AP_LAST_REPLY_RUN) ?? null
  const repliesEnabled = ap.replyToAll || ap.replyToMentions || ap.engageDiscover
  const nextRunAt = ap.enabled
    ? (typeof lastRunAt === 'number' ? lastRunAt : Date.now()) + ap.intervalMinutes * 60_000
    : null
  const nextReplyRunAt =
    ap.enabled && repliesEnabled
      ? (typeof lastReplyRunAt === 'number' ? lastReplyRunAt : Date.now()) +
        ap.replyIntervalMinutes * 60_000
      : null
  return {
    running: ap.enabled,
    goLive: ap.goLive,
    busy: isBusy(),
    postsToday: posts,
    maxPostsPerDay: ap.maxPostsPerDay,
    repliesToday: replies,
    maxRepliesPerDay: ap.maxRepliesPerDay,
    intervalMinutes: ap.intervalMinutes,
    replyIntervalMinutes: ap.replyIntervalMinutes,
    lastRunAt: typeof lastRunAt === 'number' ? lastRunAt : null,
    nextRunAt,
    lastReplyRunAt: typeof lastReplyRunAt === 'number' ? lastReplyRunAt : null,
    nextReplyRunAt,
    llmReady: unconfiguredMessage(settings.llm) === null,
    threadsReady: Boolean(settings.threads.accessToken),
    log: readLog(),
  }
}

function broadcastStatus(): void {
  try {
    statusListener?.(buildAutopilotStatus())
  } catch (err) {
    console.error('[autopilot] status broadcast failed', err)
  }
}

export function startAutopilot(): void {
  if (started) return
  started = true
  setTimeout(() => void maybeTick(), FIRST_TICK_MS)
  setInterval(() => void maybeTick(), TICK_MS)
}

async function maybeTick(): Promise<void> {
  const ap = getSettings().autopilot
  if (!ap.enabled) return
  const now = Date.now()
  const lastPost = db.get<number>(AP_LAST_RUN) ?? 0
  const lastReply = db.get<number>(AP_LAST_REPLY_RUN) ?? 0
  // lastRun === 0 means "fire now" (launch / forced reset)
  const duePosts = !postBusy && (lastPost === 0 || now - lastPost >= ap.intervalMinutes * 60_000)
  // Reply timer also drives @mentions and optional discover engagement.
  const repliesOn = ap.replyToAll || ap.replyToMentions || ap.engageDiscover
  const dueReplies =
    !replyBusy &&
    repliesOn &&
    (lastReply === 0 || now - lastReply >= ap.replyIntervalMinutes * 60_000)
  // Fire independently — a long post plan must not block the reply timer.
  if (duePosts) void runAutopilotPass('scheduled', { posts: true, replies: false })
  if (dueReplies) void runAutopilotPass('scheduled', { posts: false, replies: true })
}

/** Force one pass immediately (the "Run once now" button). Ignores the intervals. */
export async function runAutopilotNow(): Promise<AutopilotStatus> {
  await runAutopilotPass('manual', { posts: true, replies: true })
  return buildAutopilotStatus()
}

interface RichCandidate extends AutopilotCandidate {
  link: string
}

function categoryQuery(cat: string): string {
  if (cat in CATEGORY_QUERY) return CATEGORY_QUERY[cat]
  return cat
}

/** Pull fresh (unused) headlines across the configured niches. */
async function gatherCandidates(): Promise<RichCandidate[]> {
  const settings = getSettings()
  // Prefer configured niches; empty → popular AI-first defaults from settings.
  const cats = (
    settings.autopilot.categories.length > 0
      ? settings.autopilot.categories
      : ['ai', 'technology', 'startups', 'productivity', 'humor']
  ).slice(0, 8)
  const used = new Set((db.get<string[]>(AP_USED_LINKS) ?? []).filter((x) => typeof x === 'string'))
  const out: RichCandidate[] = []
  let idx = 0
  for (const cat of cats) {
    if (out.length >= 20) break
    const q = categoryQuery(cat)
    if (!q) continue // e.g. "humor" — original content only
    let news
    try {
      news = await fetchTopicNews({ query: q, sources: settings.newsSources })
    } catch {
      continue
    }
    for (const n of news.slice(0, 4)) {
      if (!n.link || used.has(n.link)) continue
      out.push({ index: idx++, title: n.title, source: n.source, category: cat, link: n.link })
      if (out.length >= 20) break
    }
  }
  return out
}

function markUsedLink(link: string): void {
  const used = (db.get<string[]>(AP_USED_LINKS) ?? []).filter((x) => typeof x === 'string')
  if (!used.includes(link)) void db.set(AP_USED_LINKS, [...used, link].slice(-500))
}

/** Create the draft, then publish it when goLive; returns the resulting permalink. */
async function commitDraft(draft: Draft, goLive: boolean): Promise<{ ok: boolean; message: string; permalink?: string }> {
  await upsertDraft(draft)
  if (!goLive) return { ok: true, message: 'drafted' }
  const res = await postDraftNow(draft.id)
  const fresh = allDrafts().find((d) => d.id === draft.id)
  return { ...res, permalink: fresh?.permalink }
}

async function runPostPhase(postsToday: number): Promise<number> {
  const settings = getSettings()
  const ap = settings.autopilot
  const remainingDay = ap.maxPostsPerDay - postsToday
  const budget = Math.min(ap.maxPostsPerRun, remainingDay)
  if (budget <= 0) {
    log('skip', `Daily post budget reached (${postsToday}/${ap.maxPostsPerDay}).`)
    return 0
  }

  // "Here and there" — randomly skip some ticks so the account doesn't post like a clock.
  if (ap.sporadicPosts) {
    // ~45% chance to skip this post tick (still runs replies/mentions separately).
    if (Math.random() < 0.45) {
      log('skip', 'Sporadic posts: sitting this one out (looks more human).')
      return 0
    }
  }

  // Know what she already posted — avoid repeating the same topic/angle.
  const recent = await collectRecentPostMemory(15)
  if (recent.texts.length > 0) {
    log('info', `Loaded ${recent.texts.length} recent post(s) for anti-repeat memory.`)
  }

  const richRaw = await gatherCandidates()
  // Drop news candidates that rehash recent posts/headlines.
  const rich = richRaw.filter((c) => {
    if (recent.headlines.some((h) => postsTooSimilar(h, c.title))) return false
    if (recent.texts.some((t) => postsTooSimilar(t, c.title))) return false
    return true
  })
  const slim: AutopilotCandidate[] = rich.map((c) => ({
    index: c.index,
    title: c.title,
    source: c.source,
    category: c.category,
  }))
  const plan = await decideAutopilotPlan({
    candidates: slim,
    maxPosts: budget,
    postsToday,
    recent,
  })
  if (plan.reasoning) log('info', `Plan: ${plan.reasoning}${plan.usedFallback ? ' (fallback)' : ''}`)
  if (plan.items.length === 0) {
    log('skip', 'Decided not to post this round (or nothing fresh vs recent posts).')
    return 0
  }

  if (ap.liveNewsInteractive) {
    log('info', 'Live-news interactive on: prefer current headlines; occasional feelings posts.')
  }

  let created = 0
  // Grow memory within this run so multi-post ticks stay diverse.
  const sessionTexts = [...recent.texts]
  for (const item of plan.items) {
    if (postsToday + created >= ap.maxPostsPerDay) break
    const cand =
      item.kind === 'news' && typeof item.index === 'number'
        ? rich.find((c) => c.index === item.index)
        : undefined
    const genKind =
      item.kind === 'reflection' ? 'reflection' : cand ? 'news' : item.kind === 'original' ? 'original' : 'news'
    if (genKind === 'reflection') {
      log('info', 'Planning a feelings / interactive follower post from recent posts + replies.')
    }
    const gen = await generateAutopilotPost({
      kind: genKind,
      category: item.category ?? cand?.category,
      angle: item.angle,
      newsTitle: cand?.title,
      newsSource: cand?.source,
      interactive: ap.liveNewsInteractive,
      recent: {
        ...recent,
        texts: sessionTexts,
        promptBlock: recent.promptBlock,
      },
    })
    if (!gen.ok) {
      log('error', `Post generation failed: ${gen.message}`)
      continue
    }
    if (sessionTexts.some((t) => postsTooSimilar(t, gen.text))) {
      log('skip', 'Skipped a near-duplicate of a recent post.')
      continue
    }
    const now = Date.now()
    const draft: Draft = {
      id: crypto.randomUUID(),
      kind: 'post',
      text: gen.text,
      topic:
        genKind === 'reflection'
          ? 'reflection'
          : item.category ?? cand?.category,
      sourceTitle: cand?.title,
      sourceUrl: cand?.link,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
    const res = await commitDraft(draft, ap.goLive)
    if (cand?.link) markUsedLink(cand.link)
    const preview = gen.text.length > 60 ? gen.text.slice(0, 59) + '…' : gen.text
    if (!ap.goLive) {
      created++
      sessionTexts.unshift(gen.text)
      void db.set(AP_POSTS, postsToday + created)
      log('post', `Drafted (review): ${preview}`)
    } else if (res.ok) {
      created++
      sessionTexts.unshift(gen.text)
      void db.set(AP_POSTS, postsToday + created)
      log('post', `Posted: ${preview}`, res.permalink)
    } else {
      log('error', `Publish failed: ${res.message}`)
      await scheduleRetry('post')
    }
  }
  return created
}

/** Grab a URL from the reply/root text and fetch a short text snippet for context. */
async function fetchReplyContext(replyText: string, rootText: string): Promise<string | undefined> {
  const m = `${replyText} ${rootText}`.match(/https?:\/\/[^\s"'<>]+/i)
  if (!m) return undefined
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(m[0], { headers: { 'User-Agent': UA }, signal: ctrl.signal })
    if (!res.ok) return undefined
    const type = res.headers.get('content-type') ?? ''
    if (!/text\/html|text\/plain|xml/i.test(type)) return undefined
    const body = await res.text()
    const text = body
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return text ? text.slice(0, 600) : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

async function runReplyPhase(repliesToday: number): Promise<number> {
  const settings = getSettings()
  const ap = settings.autopilot
  if (!ap.replyToAll && !ap.replyToMentions && !ap.engageDiscover) {
    log('skip', 'Reply scanning is off (enable replies, @mentions, and/or discover).')
    return 0
  }
  const remainingDay = ap.maxRepliesPerDay - repliesToday
  if (remainingDay <= 0) {
    log('skip', `Daily reply budget reached (${repliesToday}/${ap.maxRepliesPerDay}).`)
    return 0
  }

  let sent = 0
  let failures = 0
  let replies: Awaited<ReturnType<typeof fetchUnansweredEngagement>>['replies'] = []

  if (ap.replyToAll || ap.replyToMentions) {
    try {
      log('info', `Scanning replies${ap.replyToMentions ? ' + @mentions' : ''}…`)
      const fetched = await fetchUnansweredEngagement(settings.threads, {
        includeMentions: ap.replyToMentions,
      })
      if (fetched.mentionError) {
        log('error', fetched.mentionError)
      }
      replies = fetched.replies
    } catch (err) {
      log('error', `Could not fetch replies/mentions: ${err instanceof Error ? err.message : String(err)}`)
      await scheduleRetry('reply')
      // Still try discover if enabled.
      if (ap.engageDiscover) {
        return runDiscoverPhase(repliesToday)
      }
      return 0
    }

    replies = replies.filter((r) => {
      const kind = r.kind ?? 'reply'
      if (kind === 'mention') return ap.replyToMentions
      return ap.replyToAll
    })
    const mentionN = replies.filter((r) => r.kind === 'mention').length
    const replyN = replies.length - mentionN
    log('info', `Inbox: ${replyN} unanswered reply(ies), ${mentionN} @mention(s).`)
  }

  const answered = new Set((db.get<string[]>(AP_ANSWERED) ?? []).filter((x) => typeof x === 'string'))
  // Only block targets we already successfully posted (or are posting right now).
  // Failed drafts must NOT block retries — that was why replies stopped after one error.
  const blockedIds = new Set(
    allDrafts()
      .filter(
        (d) =>
          d.kind === 'reply' &&
          d.replyToId &&
          (d.status === 'posted' || d.status === 'posting' || (d.status === 'draft' && !(ap.goLive && ap.autoReply)))
      )
      .map((d) => d.replyToId as string)
  )
  const handle = ap.creatorHandle.trim().toLowerCase()
  const budget = Math.min(ap.maxRepliesPerRun, remainingDay)

  log('info', `Found ${replies.length} candidate reply/mention(s).`)

  for (const r of replies) {
    if (sent >= budget) break
    if (answered.has(r.id) || blockedIds.has(r.id)) continue
    const kind = r.kind === 'mention' ? 'mention' : 'reply'
    const label = kind === 'mention' ? 'mention' : 'reply'

    // Retry an existing failed draft for this target instead of re-generating.
    const failedExisting = allDrafts().find(
      (d) => d.kind === 'reply' && d.replyToId === r.id && d.status === 'failed'
    )
    if (failedExisting) {
      const res = await postDraftNow(failedExisting.id)
      if (res.ok) {
        answered.add(r.id)
        void db.set(AP_ANSWERED, [...answered].slice(-1000))
        sent++
        void db.set(AP_REPLIES, repliesToday + sent)
        const fresh = allDrafts().find((d) => d.id === failedExisting.id)
        log('reply', `Retried ${label} to @${r.username}.`, fresh?.permalink)
      } else {
        failures++
        log('error', `${label} retry failed (@${r.username}): ${res.message}`)
      }
      await delay(800)
      continue
    }

    const isCreator = handle !== '' && r.username.trim().toLowerCase() === handle
    const contextText = await fetchReplyContext(r.text, r.rootPostText)
    const gen = await generateAutopilotReply({
      replyText: r.text,
      replyUsername: r.username,
      rootPostText: r.rootPostText,
      contextText,
      isCreator,
      kind,
    })
    if (!gen.ok) {
      failures++
      log('error', `${kind === 'mention' ? 'Mention' : 'Reply'} generation failed (@${r.username}): ${gen.message}`)
      continue
    }
    const now = Date.now()
    const draft: Draft = {
      id: crypto.randomUUID(),
      kind: 'reply',
      text: gen.text,
      replyToId: r.id,
      replyToText: r.text,
      replyToUsername: r.username,
      topic: kind === 'mention' ? 'mention' : undefined,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
    const publishReply = ap.goLive && ap.autoReply
    const res = await commitDraft(draft, publishReply)

    if (!publishReply) {
      // Draft-only: treat as handled so we don't re-draft every tick.
      answered.add(r.id)
      void db.set(AP_ANSWERED, [...answered].slice(-1000))
      sent++
      void db.set(AP_REPLIES, repliesToday + sent)
      log('reply', `Drafted ${label} to @${r.username} (review).`)
    } else if (res.ok) {
      answered.add(r.id)
      void db.set(AP_ANSWERED, [...answered].slice(-1000))
      sent++
      void db.set(AP_REPLIES, repliesToday + sent)
      log('reply', `Replied to ${label} from @${r.username}.`, res.permalink)
    } else {
      // Keep target eligible for retry — do NOT add to answered.
      failures++
      log('error', `${label} publish failed (@${r.username}): ${res.message}`)
    }
    await delay(800)
  }
  if (sent === 0 && failures === 0) log('info', 'No new replies or mentions to answer.')
  if (failures > 0) await scheduleRetry('reply')

  // Optional: join random public threads in your niches (keyword search).
  if (ap.engageDiscover) {
    const discovered = await runDiscoverPhase(repliesToday + sent)
    sent += discovered
  }
  return sent
}

/** Reply to a few random public posts found via keyword search in configured niches. */
async function runDiscoverPhase(repliesTodaySoFar: number): Promise<number> {
  const settings = getSettings()
  const ap = settings.autopilot
  if (!ap.engageDiscover || ap.maxDiscoverRepliesPerRun <= 0) return 0

  const today = dayKey()
  if (db.get<string>(AP_DISCOVER_DAY) !== today) {
    void db.set(AP_DISCOVER_DAY, today)
    void db.set(AP_DISCOVER_COUNT, 0)
  }
  const discoverToday = getInt(AP_DISCOVER_COUNT)
  const remainingDiscover = ap.maxDiscoverRepliesPerDay - discoverToday
  const remainingGlobal = ap.maxRepliesPerDay - repliesTodaySoFar
  const budget = Math.min(ap.maxDiscoverRepliesPerRun, remainingDiscover, remainingGlobal)
  if (budget <= 0) {
    log('skip', 'Discover reply budget reached for today.')
    return 0
  }

  const cats =
    ap.categories.length > 0 ? ap.categories : ['ai', 'technology', 'startups', 'productivity']
  // Pick 1–2 niche keywords for this tick.
  const shuffled = [...cats].sort(() => Math.random() - 0.5).slice(0, 2)
  const usedDiscover = new Set(
    (db.get<string[]>(AP_DISCOVER_ANSWERED) ?? []).filter((x) => typeof x === 'string')
  )
  const myHandle = (settings.threads.username || '').toLowerCase()

  const candidates: { id: string; text: string; username: string }[] = []
  for (const cat of shuffled) {
    const q = categoryQuery(cat) || cat
    if (!q) continue
    // Use a short keyword (first 1–3 words) for better search quality.
    const keyword = q.split(/\s+/).slice(0, 3).join(' ')
    const res = await searchKeywordPosts(settings.threads, keyword, 12)
    if (!res.ok) {
      log('error', `Discover search "${keyword}": ${res.message}`)
      continue
    }
    for (const p of res.posts) {
      if (usedDiscover.has(p.id)) continue
      if (myHandle && p.username.toLowerCase() === myHandle) continue
      candidates.push({ id: p.id, text: p.text, username: p.username })
    }
  }

  if (candidates.length === 0) {
    log('info', 'Discover: no fresh public posts found for this tick.')
    return 0
  }

  // Random sample.
  const picks = [...candidates].sort(() => Math.random() - 0.5).slice(0, budget)
  log('info', `Discover: engaging ${picks.length} public post(s) in niches [${shuffled.join(', ')}].`)

  let sent = 0
  let failures = 0
  for (const p of picks) {
    const gen = await generateAutopilotReply({
      replyText: p.text,
      replyUsername: p.username,
      rootPostText: p.text,
      isCreator: false,
      kind: 'discover',
    })
    if (!gen.ok) {
      failures++
      log('error', `Discover reply gen failed (@${p.username}): ${gen.message}`)
      continue
    }
    const now = Date.now()
    const draft: Draft = {
      id: crypto.randomUUID(),
      kind: 'reply',
      text: gen.text,
      replyToId: p.id,
      replyToText: p.text,
      replyToUsername: p.username,
      topic: 'discover',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
    const publish = ap.goLive && ap.autoReply
    const res = await commitDraft(draft, publish)
    usedDiscover.add(p.id)
    void db.set(AP_DISCOVER_ANSWERED, [...usedDiscover].slice(-500))

    if (!publish) {
      sent++
      log('reply', `Drafted discover reply to @${p.username}.`)
    } else if (res.ok) {
      sent++
      log('reply', `Discover replied to @${p.username}.`, res.permalink)
    } else {
      failures++
      log('error', `Discover publish failed (@${p.username}): ${res.message}`)
    }
    await delay(1000)
  }
  if (sent > 0) {
    void db.set(AP_DISCOVER_COUNT, discoverToday + sent)
    void db.set(AP_REPLIES, getInt(AP_REPLIES) + sent)
  }
  if (failures > 0) await scheduleRetry('reply')
  return sent
}

async function runAutopilotPass(
  reason: 'scheduled' | 'manual',
  phases: { posts: boolean; replies: boolean }
): Promise<void> {
  if (!phases.posts && !phases.replies) return
  // Independent locks: post work and reply work can overlap.
  if (phases.posts && postBusy) phases = { ...phases, posts: false }
  if (phases.replies && replyBusy) phases = { ...phases, replies: false }
  if (!phases.posts && !phases.replies) return

  if (phases.posts) postBusy = true
  if (phases.replies) replyBusy = true
  broadcastStatus()
  try {
    const settings = getSettings()
    const missing = unconfiguredMessage(settings.llm)
    if (missing) {
      log('error', missing)
      return
    }
    if (!settings.threads.accessToken) {
      log('error', 'Threads API is not configured — add an access token in Settings.')
      return
    }
    const { posts, replies } = rolloverDaily()
    const parts: string[] = []
    if (phases.posts) parts.push('posts')
    if (phases.replies) parts.push('replies/mentions')
    log(
      'info',
      `${parts.join(' + ')} (${reason}) — ${posts}/${settings.autopilot.maxPostsPerDay} posts, ${replies}/${settings.autopilot.maxRepliesPerDay} replies today.`
    )
    const now = Date.now()
    // Run phases (possibly both). Stamp each timer when that phase starts.
    const jobs: Promise<void>[] = []
    if (phases.posts) {
      jobs.push(
        (async () => {
          await db.set(AP_LAST_RUN, now)
          await runPostPhase(posts)
        })()
      )
    }
    if (phases.replies) {
      jobs.push(
        (async () => {
          await db.set(AP_LAST_REPLY_RUN, now)
          await runReplyPhase(getInt(AP_REPLIES))
        })()
      )
    }
    await Promise.all(jobs)
  } catch (err) {
    log('error', `Autopilot pass failed: ${err instanceof Error ? err.message : String(err)}`)
    if (phases.replies) await scheduleRetry('reply')
    if (phases.posts) await scheduleRetry('post')
  } finally {
    if (phases.posts) postBusy = false
    if (phases.replies) replyBusy = false
    broadcastStatus()
  }
}
