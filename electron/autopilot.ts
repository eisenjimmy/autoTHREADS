import { db } from './localdb'
import { getSettings } from './settings'
import { fetchTopicNews } from './news'
import {
  fetchUnansweredEngagement,
  MAX_UNANSWERED_REPLIES_PER_THREAD,
  searchKeywordPosts,
} from './threadsApi'
import { isLocalVisionDisabled, localVisionDisabledMessage } from './llm'
import { allDrafts, upsertDraft } from './drafts'
import { isPartialThreadDraft, postDraftNow } from './scheduler'
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
/** When set, last scheduled post tick was a sporadic skip — next tick must post. */
const AP_SPORADIC_SKIPPED = 'autopilotSporadicSkipped'
const LOG_LIMIT = 80
/** Chance to skip a scheduled post tick when sporadicPosts is on (never consecutive). */
const SPORADIC_SKIP_CHANCE = 0.18

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

/** Activity-log copy follows app language (Settings → Language). */
function tLog(en: string, ko: string): string {
  return getSettings().language === 'ko' ? ko : en
}

/** Korean wrappers for known LLM-config error strings (English detail kept if unknown). */
function localizeUnconfigured(en: string): string {
  if (en.includes('Claude')) return 'Claude API 키가 없습니다 — 설정에서 구성하세요.'
  if (en.includes('OpenAI')) return 'OpenAI API 키가 없습니다 — 설정에서 구성하세요.'
  if (en.includes('Gemini')) return 'Gemini API 키가 없습니다 — 설정에서 구성하세요.'
  if (en.includes('Local LLM')) return '로컬 LLM 기본 URL이 없습니다 — 설정에서 구성하세요.'
  if (en.includes('Other provider')) return '기타 제공자 기본 URL이 없습니다 — 설정에서 구성하세요.'
  return en
}

/** Mentions API failure (threadsApi) → Korean for the activity log. */
function localizeMentionError(en: string): string {
  if (/Mentions API failed/i.test(en) || /returned 0 items/i.test(en) || /Advanced Access/i.test(en)) {
    return (
      '멘션 API 문제: Meta Advanced Access(threads_manage_mentions)가 없으면 테스터 멘션만 보입니다. ' +
      '권한을 켠 뒤 액세스 토큰을 다시 발급하세요. ' +
      en.replace(/^Mentions API failed:\s*/i, '').slice(0, 180)
    )
  }
  return en
}

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
  log(
    'info',
    kind === 'post'
      ? tLog('Post failure — will retry in ~1 minute.', '게시 실패 — 약 1분 후 다시 시도합니다.')
      : tLog('Reply failure — will retry in ~1 minute.', '답글 실패 — 약 1분 후 다시 시도합니다.')
  )
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

async function runPostPhase(
  postsToday: number,
  reason: 'scheduled' | 'manual' = 'scheduled'
): Promise<number> {
  const settings = getSettings()
  const ap = settings.autopilot

  // Mid-thread failures must resume the SAME draft (remaining 2/n… only).
  // Never plan a new post while a partial thread is waiting.
  let resumed = 0
  const partials = allDrafts().filter(
    (d) => d.kind === 'post' && d.status === 'failed' && isPartialThreadDraft(d)
  )
  for (const d of partials) {
    if (postsToday + resumed >= ap.maxPostsPerDay) break
    log(
      'info',
      tLog(
        `Resuming multi-part thread (${d.threadPartsPosted ?? '?'} part(s) already live)…`,
        `이어쓰기: 멀티 파트 스레드 재개 (이미 ${d.threadPartsPosted ?? '?'}단 게시됨)…`
      )
    )
    const res = await postDraftNow(d.id)
    if (res.ok) {
      resumed++
      void db.set(AP_POSTS, postsToday + resumed)
      log(
        'post',
        tLog(
          `Finished remaining thread parts: ${res.message}`,
          `남은 스레드 파트 게시 완료: ${res.message}`
        ),
        allDrafts().find((x) => x.id === d.id)?.permalink
      )
    } else {
      log(
        'error',
        tLog(
          `Thread resume failed: ${res.message}`,
          `스레드 이어쓰기 실패: ${res.message}`
        )
      )
      await scheduleRetry('post')
      // Do not generate a new post this tick — would risk another 1/n duplicate.
      return resumed
    }
  }
  if (resumed > 0) {
    // Prefer finishing threads over starting new ones in the same pass.
    return resumed
  }

  const remainingDay = ap.maxPostsPerDay - postsToday
  const budget = Math.min(ap.maxPostsPerRun, remainingDay)
  if (budget <= 0) {
    log(
      'skip',
      tLog(
        `Daily post budget reached (${postsToday}/${ap.maxPostsPerDay}).`,
        `오늘 게시 한도에 도달했습니다 (${postsToday}/${ap.maxPostsPerDay}).`
      )
    )
    return 0
  }

  // "Here and there" — occasionally skip a scheduled tick so cadence isn't a metronome.
  // Never skip: manual Run once, or two ticks in a row (was ~45% and starved posts).
  if (ap.sporadicPosts && reason === 'scheduled') {
    const lastWasSkip = db.get<boolean>(AP_SPORADIC_SKIPPED) === true
    if (!lastWasSkip && Math.random() < SPORADIC_SKIP_CHANCE) {
      void db.set(AP_SPORADIC_SKIPPED, true)
      log(
        'skip',
        tLog(
          'Sporadic posts: sitting this one out (looks more human). Next post tick will run.',
          '간헐 게시: 이번 회차는 건너뜁니다 (더 자연스럽게). 다음 게시 틱은 실행됩니다.'
        )
      )
      return 0
    }
    void db.set(AP_SPORADIC_SKIPPED, false)
  }

  // Know what she already posted — avoid repeating the same topic/angle.
  const memoryN = Math.max(1, Math.min(20, Math.round(ap.recentPostMemory) || 5))
  if (!ap.goLive) {
    log(
      'info',
      tLog(
        'Publish live is OFF — this post tick will draft only (review in Drafts).',
        '실시간 게시가 꺼져 있습니다 — 이번 게시 틱은 초안만 작성합니다 (초안 탭에서 검토).'
      )
    )
  }
  const recent = await collectRecentPostMemory(memoryN)
  if (recent.texts.length > 0) {
    log(
      'info',
      tLog(
        `Loaded ${recent.texts.length}/${memoryN} recent post(s) for anti-repeat memory.`,
        `반복 방지 메모리: 최근 게시 ${recent.texts.length}/${memoryN}개 로드.`
      )
    )
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
  let plan = await decideAutopilotPlan({
    candidates: slim,
    maxPosts: budget,
    postsToday,
    recent,
  })
  if (plan.reasoning) {
    const fallback = plan.usedFallback
      ? tLog(' (fallback)', ' (대체 계획)')
      : ''
    log('info', tLog(`Plan: ${plan.reasoning}${fallback}`, `계획: ${plan.reasoning}${fallback}`))
  }
  // Never leave a scheduled post tick with nothing when we still have budget —
  // empty LLM plans previously caused multi-hour gaps between sporadic skips.
  if (plan.items.length === 0 && budget > 0) {
    const niches =
      ap.categories.length > 0
        ? ap.categories
        : ['ai', 'technology', 'startups', 'productivity', 'humor']
    const forced =
      rich.length > 0
        ? {
            kind: 'news' as const,
            index: rich[0].index,
            category: rich[0].category,
            angle: 'forced news take — planner returned empty',
          }
        : {
            kind: 'original' as const,
            category: niches[Math.floor(Math.random() * niches.length)],
            angle: 'forced original — no fresh headlines this tick',
          }
    plan = { ...plan, items: [forced], usedFallback: true }
    log(
      'info',
      tLog(
        'Planner returned no posts — forcing one item so the feed stays active.',
        '계획이 비어 있어 피드를 유지하도록 게시 1건을 강제합니다.'
      )
    )
  }
  if (plan.items.length === 0) {
    log(
      'skip',
      tLog(
        'Decided not to post this round (or nothing fresh vs recent posts).',
        '이번 회차는 게시하지 않기로 했습니다 (또는 최근 글과 겹치는 내용 없음).'
      )
    )
    return 0
  }

  if (ap.liveNewsInteractive) {
    log(
      'info',
      tLog(
        'Live-news interactive on: prefer current headlines; occasional feelings posts.',
        '실시간 뉴스·인터랙티브 켜짐: 최신 헤드라인 우선, 가끔 감성·소통 글.'
      )
    )
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
      log(
        'info',
        tLog(
          'Planning a feelings / interactive follower post from recent posts + replies.',
          '최근 게시·답글을 바탕으로 감성·팔로워 소통 글을 준비합니다.'
        )
      )
    }
    const gen = await generateAutopilotPost({
      kind: genKind,
      category: item.category ?? cand?.category,
      angle: item.angle,
      newsTitle: cand?.title,
      newsSource: cand?.source,
      newsUrl: cand?.link,
      interactive: ap.liveNewsInteractive,
      recent: {
        ...recent,
        texts: sessionTexts,
        promptBlock: recent.promptBlock,
      },
    })
    if (!gen.ok) {
      log(
        'error',
        tLog(`Post generation failed: ${gen.message}`, `게시 생성 실패: ${gen.message}`)
      )
      continue
    }
    if (sessionTexts.some((t) => postsTooSimilar(t, gen.text))) {
      log(
        'skip',
        tLog('Skipped a near-duplicate of a recent post.', '최근 게시와 비슷한 글을 건너뛰었습니다.')
      )
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
    const longNote =
      gen.text.length > 500
        ? tLog(
            ` (${Math.ceil(gen.text.length / 500)}-part thread if live)`,
            ` (실시간 시 약 ${Math.ceil(gen.text.length / 500)}단 스레드)`
          )
        : ''
    if (!ap.goLive) {
      created++
      sessionTexts.unshift(gen.text)
      void db.set(AP_POSTS, postsToday + created)
      log(
        'post',
        tLog(`Drafted (review): ${preview}${longNote}`, `초안 작성 (검토): ${preview}${longNote}`)
      )
    } else if (res.ok) {
      created++
      sessionTexts.unshift(gen.text)
      void db.set(AP_POSTS, postsToday + created)
      log(
        'post',
        tLog(`Posted: ${preview}${longNote}`, `게시됨: ${preview}${longNote}`),
        res.permalink
      )
    } else {
      const failed = allDrafts().find((d) => d.id === draft.id)
      const partial = failed ? isPartialThreadDraft(failed) : false
      log(
        'error',
        tLog(
          partial
            ? `Publish failed mid-thread (will resume remaining parts, not re-post 1/n): ${res.message}`
            : `Publish failed: ${res.message}`,
          partial
            ? `게시 실패 — 스레드 중간 (1/n 재게시 없이 이어서 재시도): ${res.message}`
            : `게시 실패: ${res.message}`
        )
      )
      await scheduleRetry('post')
      // Stop this planning loop so we don't stack another long post while one is incomplete.
      if (partial) break
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
    log(
      'skip',
      tLog(
        'Reply scanning is off (enable replies, @mentions, and/or discover).',
        '답글 스캔이 꺼져 있습니다 (답글, @멘션, 디스커버 중 하나 이상 켜세요).'
      )
    )
    return 0
  }
  const remainingDay = ap.maxRepliesPerDay - repliesToday
  if (remainingDay <= 0) {
    log(
      'skip',
      tLog(
        `Daily reply budget reached (${repliesToday}/${ap.maxRepliesPerDay}).`,
        `오늘 답글 한도에 도달했습니다 (${repliesToday}/${ap.maxRepliesPerDay}).`
      )
    )
    return 0
  }

  let sent = 0
  let failures = 0
  let replies: Awaited<ReturnType<typeof fetchUnansweredEngagement>>['replies'] = []

  if (ap.replyToAll || ap.replyToMentions) {
    try {
      log(
        'info',
        ap.replyToMentions
          ? tLog('Scanning replies + @mentions…', '답글 + @멘션 확인 중…')
          : tLog('Scanning replies…', '답글 확인 중…')
      )
      // Local answered set so mentions don't re-probe Graph for done work.
      const priorAnswered = new Set(
        (db.get<string[]>(AP_ANSWERED) ?? []).filter((x) => typeof x === 'string')
      )
      // Also treat successfully posted reply drafts as answered targets.
      for (const d of allDrafts()) {
        if (d.kind === 'reply' && d.replyToId && d.status === 'posted') priorAnswered.add(d.replyToId)
      }
      const fetched = await fetchUnansweredEngagement(settings.threads, {
        includeMentions: ap.replyToMentions,
        alreadyAnsweredIds: priorAnswered,
      })
      if (fetched.mentionError) {
        // Soft hint when API returned 0 (Advanced Access) — info, not a hard crash.
        const softEmpty =
          /returned 0 items|Advanced Access/i.test(fetched.mentionError) &&
          (fetched.mentionRawCount ?? 0) === 0
        log(
          softEmpty ? 'info' : 'error',
          tLog(
            fetched.mentionError,
            softEmpty
              ? '멘션 API가 0건을 반환했습니다. Meta Advanced Access(threads_manage_mentions) 미승인 시 테스터 멘션만 보입니다. 권한 켠 뒤 토큰을 다시 발급하세요.'
              : localizeMentionError(fetched.mentionError)
          )
        )
      } else if (ap.replyToMentions) {
        log(
          'info',
          tLog(
            `Mentions API: ${fetched.mentionRawCount ?? 0} raw, ` +
              `${(fetched.replies ?? []).filter((r) => r.kind === 'mention').length} unanswered` +
              (fetched.mentionSkippedAnswered
                ? ` (${fetched.mentionSkippedAnswered} already answered)`
                : '') +
              '.',
            `멘션 API: 원본 ${fetched.mentionRawCount ?? 0}건, ` +
              `미답변 ${(fetched.replies ?? []).filter((r) => r.kind === 'mention').length}건` +
              (fetched.mentionSkippedAnswered
                ? ` (이미 답함 ${fetched.mentionSkippedAnswered})`
                : '') +
              '.'
          )
        )
      }
      if (fetched.threadCap.threadsTruncated > 0) {
        const { maxPerThread, threadsTruncated, dropped } = fetched.threadCap
        log(
          'info',
          tLog(
            `Long-thread cap: stopped after ${maxPerThread} unanswered per post ` +
              `(${threadsTruncated} thread(s), ${dropped} older reply(ies) skipped).`,
            `긴 스레드 한도: 게시물당 미답변 ${maxPerThread}개 이후 중단 ` +
              `(${threadsTruncated}개 스레드, 이전 답글 ${dropped}개 건너뜀).`
          )
        )
      }
      replies = fetched.replies
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      log(
        'error',
        tLog(
          `Could not fetch replies/mentions: ${detail}`,
          `답글/멘션을 가져오지 못했습니다: ${detail}`
        )
      )
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
    log(
      'info',
      tLog(
        `Inbox: ${replyN} unanswered reply(ies), ${mentionN} @mention(s).`,
        `받은편지함: 미답변 답글 ${replyN}개, @멘션 ${mentionN}개.`
      )
    )
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

  // Mentions first (API already orders them first; re-sort to be safe).
  replies = [
    ...replies.filter((r) => r.kind === 'mention'),
    ...replies.filter((r) => r.kind !== 'mention'),
  ]

  const mentionCandidates = replies.filter((r) => r.kind === 'mention').length
  log(
    'info',
    tLog(
      `Found ${replies.length} candidate(s) (${mentionCandidates} @mention(s), ${replies.length - mentionCandidates} reply(ies)).`,
      `후보 ${replies.length}개 (@멘션 ${mentionCandidates}, 답글 ${replies.length - mentionCandidates}).`
    )
  )

  // Deterministic per-thread stop (same hard cap as fetch). Mentions are not capped by root.
  const repliedThisRunByRoot = new Map<string, number>()

  for (const r of replies) {
    if (sent >= budget) break
    if (answered.has(r.id) || blockedIds.has(r.id)) continue
    const kind = r.kind === 'mention' ? 'mention' : 'reply'
    const isMention = kind === 'mention'
    if (!isMention && r.rootPostId) {
      const n = repliedThisRunByRoot.get(r.rootPostId) ?? 0
      if (n >= MAX_UNANSWERED_REPLIES_PER_THREAD) continue
    }

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
        if (!isMention && r.rootPostId) {
          repliedThisRunByRoot.set(r.rootPostId, (repliedThisRunByRoot.get(r.rootPostId) ?? 0) + 1)
        }
        const fresh = allDrafts().find((d) => d.id === failedExisting.id)
        log(
          'reply',
          isMention
            ? tLog(`Retried mention to @${r.username}.`, `@${r.username} 멘션 재시도 성공.`)
            : tLog(`Retried reply to @${r.username}.`, `@${r.username} 답글 재시도 성공.`),
          fresh?.permalink
        )
      } else {
        failures++
        log(
          'error',
          isMention
            ? tLog(
                `mention retry failed (@${r.username}): ${res.message}`,
                `멘션 재시도 실패 (@${r.username}): ${res.message}`
              )
            : tLog(
                `reply retry failed (@${r.username}): ${res.message}`,
                `답글 재시도 실패 (@${r.username}): ${res.message}`
              )
        )
      }
      await delay(800)
      continue
    }

    const isCreator = handle !== '' && r.username.trim().toLowerCase() === handle
    const contextText = await fetchReplyContext(r.text, r.rootPostText)
    const imageUrls = Array.isArray(r.imageUrls) ? r.imageUrls : undefined
    const hadImages = (imageUrls?.length ?? 0) > 0
    if (hadImages) {
      const local = settings.llm.provider === 'local'
      const visionOff = local && isLocalVisionDisabled()
      log(
        'info',
        tLog(
          `Image: ${imageUrls!.length} on @${r.username}'s ${isMention ? 'mention' : 'reply'}` +
            (visionOff
              ? ` — vision off this session (${localVisionDisabledMessage() ?? 'unsupported'}), text-only.`
              : local
                ? ' — sending to local vision model.'
                : ' — cloud provider is text-only (no vision).'),
          `이미지: @${r.username} ${isMention ? '멘션' : '답글'} ${imageUrls!.length}개` +
            (visionOff
              ? ` — 이 세션 비전 꺼짐 (${localVisionDisabledMessage() ?? 'unsupported'}), 텍스트만.`
              : local
                ? ' — 로컬 비전 모델로 전송.'
                : ' — 클라우드 제공자는 텍스트만 (비전 없음).')
        )
      )
    }
    const gen = await generateAutopilotReply({
      replyText: r.text,
      replyUsername: r.username,
      rootPostText: r.rootPostText,
      contextText,
      isCreator,
      kind,
      imageUrls,
    })
    if (!gen.ok) {
      failures++
      log(
        'error',
        isMention
          ? tLog(
              `Mention generation failed (@${r.username}): ${gen.message}`,
              `멘션 생성 실패 (@${r.username}): ${gen.message}`
            )
          : tLog(
              `Reply generation failed (@${r.username}): ${gen.message}`,
              `답글 생성 실패 (@${r.username}): ${gen.message}`
            )
      )
      continue
    }
    if (hadImages && settings.llm.provider === 'local') {
      const usedVision = !isLocalVisionDisabled()
      log(
        'info',
        tLog(
          usedVision
            ? `Reply draft ready for @${r.username} (vision path available).`
            : `Reply draft ready for @${r.username} (text-only; vision fell back this session).`,
          usedVision
            ? `@${r.username} 답글 초안 완료 (비전 경로 사용 가능).`
            : `@${r.username} 답글 초안 완료 (텍스트 폴백; 비전 미사용).`
        )
      )
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
      if (!isMention && r.rootPostId) {
        repliedThisRunByRoot.set(r.rootPostId, (repliedThisRunByRoot.get(r.rootPostId) ?? 0) + 1)
      }
      log(
        'reply',
        isMention
          ? tLog(`Drafted mention to @${r.username} (review).`, `@${r.username} 멘션 초안 작성 (검토).`)
          : tLog(`Drafted reply to @${r.username} (review).`, `@${r.username} 답글 초안 작성 (검토).`)
      )
    } else if (res.ok) {
      answered.add(r.id)
      void db.set(AP_ANSWERED, [...answered].slice(-1000))
      sent++
      void db.set(AP_REPLIES, repliesToday + sent)
      if (!isMention && r.rootPostId) {
        repliedThisRunByRoot.set(r.rootPostId, (repliedThisRunByRoot.get(r.rootPostId) ?? 0) + 1)
      }
      log(
        'reply',
        isMention
          ? tLog(`Replied to mention from @${r.username}.`, `@${r.username} 멘션에 답글함.`)
          : tLog(`Replied to reply from @${r.username}.`, `@${r.username} 답글에 응답함.`),
        res.permalink
      )
    } else {
      // Keep target eligible for retry — do NOT add to answered.
      failures++
      log(
        'error',
        isMention
          ? tLog(
              `mention publish failed (@${r.username}): ${res.message}`,
              `멘션 게시 실패 (@${r.username}): ${res.message}`
            )
          : tLog(
              `reply publish failed (@${r.username}): ${res.message}`,
              `답글 게시 실패 (@${r.username}): ${res.message}`
            )
      )
    }
    await delay(800)
  }
  if (sent === 0 && failures === 0) {
    log(
      'info',
      tLog('No new replies or mentions to answer.', '답할 새 답글이나 멘션이 없습니다.')
    )
  }
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
    log(
      'skip',
      tLog('Discover reply budget reached for today.', '오늘 디스커버 답글 한도에 도달했습니다.')
    )
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
      log(
        'error',
        tLog(
          `Discover search "${keyword}": ${res.message}`,
          `디스커버 검색 "${keyword}": ${res.message}`
        )
      )
      continue
    }
    for (const p of res.posts) {
      if (usedDiscover.has(p.id)) continue
      if (myHandle && p.username.toLowerCase() === myHandle) continue
      candidates.push({ id: p.id, text: p.text, username: p.username })
    }
  }

  if (candidates.length === 0) {
    log(
      'info',
      tLog(
        'Discover: no fresh public posts found for this tick.',
        '디스커버: 이번 회차에 새 공개 글을 찾지 못했습니다.'
      )
    )
    return 0
  }

  // Random sample.
  const picks = [...candidates].sort(() => Math.random() - 0.5).slice(0, budget)
  log(
    'info',
    tLog(
      `Discover: engaging ${picks.length} public post(s) in niches [${shuffled.join(', ')}].`,
      `디스커버: 분야 [${shuffled.join(', ')}]에서 공개 글 ${picks.length}개에 참여합니다.`
    )
  )

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
      log(
        'error',
        tLog(
          `Discover reply gen failed (@${p.username}): ${gen.message}`,
          `디스커버 답글 생성 실패 (@${p.username}): ${gen.message}`
        )
      )
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
      log(
        'reply',
        tLog(
          `Drafted discover reply to @${p.username}.`,
          `@${p.username} 디스커버 답글 초안 작성.`
        )
      )
    } else if (res.ok) {
      sent++
      log(
        'reply',
        tLog(`Discover replied to @${p.username}.`, `@${p.username} 디스커버 답글 게시.`),
        res.permalink
      )
    } else {
      failures++
      log(
        'error',
        tLog(
          `Discover publish failed (@${p.username}): ${res.message}`,
          `디스커버 게시 실패 (@${p.username}): ${res.message}`
        )
      )
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
      log('error', tLog(missing, localizeUnconfigured(missing)))
      return
    }
    if (!settings.threads.accessToken) {
      log(
        'error',
        tLog(
          'Threads API is not configured — add an access token in Settings.',
          'Threads API가 설정되지 않았습니다 — 설정에서 액세스 토큰을 추가하세요.'
        )
      )
      return
    }
    const { posts, replies } = rolloverDaily()
    const partsEn: string[] = []
    const partsKo: string[] = []
    if (phases.posts) {
      partsEn.push('posts')
      partsKo.push('게시')
    }
    if (phases.replies) {
      partsEn.push('replies/mentions')
      partsKo.push('답글/멘션')
    }
    const reasonEn = reason === 'manual' ? 'manual' : 'scheduled'
    const reasonKo = reason === 'manual' ? '수동' : '예약'
    log(
      'info',
      tLog(
        `${partsEn.join(' + ')} (${reasonEn}) — ${posts}/${settings.autopilot.maxPostsPerDay} posts, ${replies}/${settings.autopilot.maxRepliesPerDay} replies today.`,
        `${partsKo.join(' + ')} (${reasonKo}) — 오늘 게시 ${posts}/${settings.autopilot.maxPostsPerDay}, 답글 ${replies}/${settings.autopilot.maxRepliesPerDay}.`
      )
    )
    const now = Date.now()
    // Run phases SEQUENTIALLY. Local llama-server is typically --parallel 1;
    // concurrent post+vision reply was the main "works once then ECONNREFUSED" bug.
    if (phases.posts) {
      await db.set(AP_LAST_RUN, now)
      await runPostPhase(posts, reason)
    }
    if (phases.replies) {
      await db.set(AP_LAST_REPLY_RUN, now)
      await runReplyPhase(getInt(AP_REPLIES))
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    log(
      'error',
      tLog(`Autopilot pass failed: ${detail}`, `자동 실행 실패: ${detail}`)
    )
    if (phases.replies) await scheduleRetry('reply')
    if (phases.posts) await scheduleRetry('post')
  } finally {
    if (phases.posts) postBusy = false
    if (phases.replies) replyBusy = false
    broadcastStatus()
  }
}
