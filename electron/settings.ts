import { safeStorage } from 'electron'
import { db } from './localdb'
import type { AppSettings, AutopilotSettings, PostLanguageMode } from './types'
import { THREADS_POST_MAX_CHARS } from './types'

/**
 * Settings store. Secrets (API keys, Threads access token) are encrypted at
 * rest with Electron safeStorage (DPAPI on Windows, Keychain on macOS) and
 * returned decrypted to callers. If decryption fails (e.g. the OS profile
 * changed), the secret degrades to '' so the user just re-enters it.
 */

const ENC_PREFIX = 'enc:v1:'
const DEFAULT_THREADS_SCOPES =
  'threads_basic,threads_content_publish,threads_read_replies,threads_manage_replies,threads_manage_mentions,threads_keyword_search'

export function defaultSettings(): AppSettings {
  return {
    theme: 'dark',
    language: 'en',
    onboarded: false,
    topics: ['artificial intelligence', 'technology', 'startups'],
    newsSources: { google: true, yahoo: false, hackerNews: true, naver: false, custom: [] },
    llm: {
      provider: 'local',
      // Match Threads post length so completions stay post-sized by default.
      maxTokens: THREADS_POST_MAX_CHARS,
      claude: { apiKey: '', model: 'claude-sonnet-5' },
      openai: { apiKey: '', model: 'gpt-4o-mini' },
      gemini: { apiKey: '', model: 'gemini-3.5-flash' },
      local: { baseUrl: 'http://127.0.0.1:8080/v1/chat/completions', model: 'gemma4-v2', apiKey: '' },
      other: {
        baseUrl: '',
        model: '',
        apiKey: '',
        headersJson: '{}',
        bodyJson: `{\n  "max_tokens": ${THREADS_POST_MAX_CHARS},\n  "temperature": 0.8\n}`,
      },
    },
    threads: {
      accessToken: '',
      userId: '',
      username: '',
      appId: '',
      appSecret: '',
      redirectUri: 'http://127.0.0.1:31242/threads/oauth/callback',
      scopes: DEFAULT_THREADS_SCOPES,
      tokenExpiresAt: null,
    },
    style: { notes: '', samples: [] },
    autoDraft: { enabled: false, intervalMinutes: 120, maxPerRun: 2 },
    autopilot: defaultAutopilot(),
  }
}

/** Popular Threads niches used when Full-Auto has no categories selected. AI-first. */
export const AUTOPILOT_DEFAULT_CATEGORIES = ['ai', 'technology', 'startups', 'productivity', 'humor']

export function defaultAutopilot(): AutopilotSettings {
  return {
    enabled: false,
    goLive: true,
    intervalMinutes: 60, // how often to plan/post
    replyIntervalMinutes: 5, // replies + @mentions run on a separate, faster timer
    goal:
      'Grow an engaged Threads following with posts that feel native to popular Threads niches — especially AI, tech, builders, and hot takes people actually reply to.',
    categories: [...AUTOPILOT_DEFAULT_CATEGORIES],
    postLanguage: 'match',
    toneNotes: '',
    maxPostsPerDay: 6,
    maxPostsPerRun: 1,
    originalRatio: 25, // default lean news-first; liveNewsInteractive lowers this further
    agentName: '',
    creatorName: '',
    creatorHandle: '',
    creatorAddress: 'Master',
    replyToAll: true,
    replyToMentions: true,
    autoReply: true,
    maxRepliesPerRun: 15, // allow multiple replies in an ongoing thread per tick
    maxRepliesPerDay: 100,
    sporadicPosts: true, // post "here and there" instead of every single tick
    liveNewsInteractive: true, // scrape news + occasional feelings / follower callbacks
    engageDiscover: false, // opt-in: reply to random public posts in niches
    maxDiscoverRepliesPerRun: 2,
    maxDiscoverRepliesPerDay: 20,
  }
}

/** Ensure newer scopes are present when the user still has an older default string. */
function ensureMentionScope(scopes: string): string {
  const parts = scopes
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.includes('threads_manage_mentions')) parts.push('threads_manage_mentions')
  if (!parts.includes('threads_keyword_search')) parts.push('threads_keyword_search')
  return parts.join(',')
}

function encryptSecret(value: string): string {
  if (!value || value.startsWith(ENC_PREFIX)) return value
  try {
    if (!safeStorage.isEncryptionAvailable()) return value
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
  } catch {
    return value
  }
}

function decryptSecret(value: string): string {
  if (!value || !value.startsWith(ENC_PREFIX)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

function mapSecrets(s: AppSettings, fn: (v: string) => string): AppSettings {
  return {
    ...s,
    llm: {
      ...s.llm,
      claude: { ...s.llm.claude, apiKey: fn(s.llm.claude.apiKey) },
      openai: { ...s.llm.openai, apiKey: fn(s.llm.openai.apiKey) },
      gemini: { ...s.llm.gemini, apiKey: fn(s.llm.gemini.apiKey) },
      local: { ...s.llm.local, apiKey: fn(s.llm.local.apiKey) },
      other: { ...s.llm.other, apiKey: fn(s.llm.other.apiKey) },
    },
    threads: {
      ...s.threads,
      accessToken: fn(s.threads.accessToken),
      appSecret: fn(s.threads.appSecret),
    },
  }
}

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)
const language = (v: unknown): AppSettings['language'] =>
  v === 'es' || v === 'ko' || v === 'zh' || v === 'ja' || v === 'fr' || v === 'de' || v === 'pt'
    ? v
    : 'en'
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

function customNewsSources(v: unknown): AppSettings['newsSources']['custom'] {
  if (!Array.isArray(v)) return []
  return v
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null
      const row = item as { id?: unknown; name?: unknown; url?: unknown; enabled?: unknown }
      const url = str(row.url, '').trim()
      if (!url) return null
      const name = str(row.name, '').trim() || `Custom ${i + 1}`
      return {
        id: str(row.id, '').trim() || `custom-${i + 1}`,
        name,
        url,
        enabled: bool(row.enabled, true),
      }
    })
    .filter((x): x is AppSettings['newsSources']['custom'][number] => x !== null)
}

/** Merge stored (possibly older-shaped) settings over defaults, field by field. */
function normalize(raw: Partial<AppSettings> | null): AppSettings {
  const d = defaultSettings()
  if (!raw || typeof raw !== 'object') return d
  // Only fall back to the seed topics when the key is absent (first run); an
  // explicitly-emptied list must persist so auto-draft stops on removed topics.
  const topics = strArr(raw.topics).map((t) => t.trim()).filter(Boolean)
  return {
    theme: raw.theme === 'light' ? 'light' : raw.theme === 'dark' ? 'dark' : d.theme,
    language: language(raw.language),
    onboarded: raw.onboarded === true,
    topics: Array.isArray(raw.topics) ? topics : d.topics,
    newsSources: {
      google: bool(raw.newsSources?.google, d.newsSources.google),
      yahoo: bool(raw.newsSources?.yahoo, d.newsSources.yahoo),
      hackerNews: bool(raw.newsSources?.hackerNews, d.newsSources.hackerNews),
      naver: bool(raw.newsSources?.naver, d.newsSources.naver),
      custom: customNewsSources(raw.newsSources?.custom),
    },
    llm: {
      provider:
        raw.llm?.provider === 'claude' ||
        raw.llm?.provider === 'openai' ||
        raw.llm?.provider === 'gemini' ||
        raw.llm?.provider === 'local' ||
        raw.llm?.provider === 'other'
          ? raw.llm.provider
          : d.llm.provider,
      maxTokens: clampInt(raw.llm?.maxTokens, 64, 8192, d.llm.maxTokens),
      claude: {
        apiKey: str(raw.llm?.claude?.apiKey, ''),
        model: str(raw.llm?.claude?.model, d.llm.claude.model) || d.llm.claude.model,
      },
      openai: {
        apiKey: str(raw.llm?.openai?.apiKey, ''),
        model: str(raw.llm?.openai?.model, d.llm.openai.model) || d.llm.openai.model,
      },
      gemini: {
        apiKey: str(raw.llm?.gemini?.apiKey, ''),
        model: str(raw.llm?.gemini?.model, d.llm.gemini.model) || d.llm.gemini.model,
      },
      local: {
        baseUrl: str(raw.llm?.local?.baseUrl, d.llm.local.baseUrl) || d.llm.local.baseUrl,
        model: str(raw.llm?.local?.model, d.llm.local.model) || d.llm.local.model,
        apiKey: str(raw.llm?.local?.apiKey, ''),
      },
      other: {
        baseUrl: str(raw.llm?.other?.baseUrl, d.llm.other.baseUrl),
        model: str(raw.llm?.other?.model, d.llm.other.model),
        apiKey: str(raw.llm?.other?.apiKey, ''),
        headersJson: str(raw.llm?.other?.headersJson, d.llm.other.headersJson) || '{}',
        bodyJson: str(raw.llm?.other?.bodyJson, d.llm.other.bodyJson) || '{}',
      },
    },
    threads: {
      accessToken: str(raw.threads?.accessToken, ''),
      userId: str(raw.threads?.userId, '').trim(),
      username: str(raw.threads?.username, ''),
      appId: str(raw.threads?.appId, '').trim(),
      appSecret: str(raw.threads?.appSecret, ''),
      redirectUri: str(raw.threads?.redirectUri, d.threads.redirectUri).trim() || d.threads.redirectUri,
      scopes: ensureMentionScope(str(raw.threads?.scopes, d.threads.scopes).trim() || d.threads.scopes),
      tokenExpiresAt:
        typeof raw.threads?.tokenExpiresAt === 'number' && Number.isFinite(raw.threads.tokenExpiresAt)
          ? raw.threads.tokenExpiresAt
          : null,
    },
    style: { notes: str(raw.style?.notes, ''), samples: strArr(raw.style?.samples) },
    autoDraft: {
      enabled: raw.autoDraft?.enabled === true,
      intervalMinutes: Math.max(15, Number(raw.autoDraft?.intervalMinutes) || d.autoDraft.intervalMinutes),
      maxPerRun: Math.min(10, Math.max(1, Number(raw.autoDraft?.maxPerRun) || d.autoDraft.maxPerRun)),
    },
    autopilot: normalizeAutopilot(raw.autopilot, d.autopilot),
  }
}

function postLanguageMode(v: unknown, fallback: PostLanguageMode): PostLanguageMode {
  return v === 'match' || v === 'ko' || v === 'en' || v === 'ui' ? v : fallback
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeAutopilot(
  raw: Partial<AutopilotSettings> | undefined,
  d: AutopilotSettings
): AutopilotSettings {
  const r = (raw ?? {}) as Partial<AutopilotSettings>
  const categories = strArr(r.categories)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
  return {
    enabled: r.enabled === true,
    goLive: typeof r.goLive === 'boolean' ? r.goLive : d.goLive,
    intervalMinutes: clampInt(r.intervalMinutes, 1, 1440, d.intervalMinutes),
    replyIntervalMinutes: clampInt(r.replyIntervalMinutes, 1, 1440, d.replyIntervalMinutes),
    goal: str(r.goal, d.goal),
    // Empty list falls back to popular Threads niches (AI-first defaults).
    categories: Array.isArray(r.categories)
      ? categories.length > 0
        ? categories
        : [...AUTOPILOT_DEFAULT_CATEGORIES]
      : d.categories,
    postLanguage: postLanguageMode(r.postLanguage, d.postLanguage),
    toneNotes: str(r.toneNotes, ''),
    maxPostsPerDay: clampInt(r.maxPostsPerDay, 1, 96, d.maxPostsPerDay),
    maxPostsPerRun: clampInt(r.maxPostsPerRun, 1, 10, d.maxPostsPerRun),
    originalRatio: clampInt(r.originalRatio, 0, 100, d.originalRatio),
    agentName: str(r.agentName, '').slice(0, 80),
    creatorName: str(r.creatorName, '').slice(0, 120),
    creatorHandle: str(r.creatorHandle, '').trim().replace(/^@+/, '').slice(0, 80),
    creatorAddress: str(r.creatorAddress, d.creatorAddress).slice(0, 60),
    replyToAll: typeof r.replyToAll === 'boolean' ? r.replyToAll : d.replyToAll,
    replyToMentions: typeof r.replyToMentions === 'boolean' ? r.replyToMentions : d.replyToMentions,
    autoReply: typeof r.autoReply === 'boolean' ? r.autoReply : d.autoReply,
    // Hard upper bound 20 — matches MAX_UNANSWERED_REPLIES_PER_THREAD per conversation.
    maxRepliesPerRun: clampInt(r.maxRepliesPerRun, 1, 20, d.maxRepliesPerRun),
    maxRepliesPerDay: clampInt(r.maxRepliesPerDay, 1, 300, d.maxRepliesPerDay),
    sporadicPosts: typeof r.sporadicPosts === 'boolean' ? r.sporadicPosts : d.sporadicPosts,
    liveNewsInteractive:
      typeof r.liveNewsInteractive === 'boolean' ? r.liveNewsInteractive : d.liveNewsInteractive,
    engageDiscover: typeof r.engageDiscover === 'boolean' ? r.engageDiscover : d.engageDiscover,
    maxDiscoverRepliesPerRun: clampInt(r.maxDiscoverRepliesPerRun, 0, 10, d.maxDiscoverRepliesPerRun),
    maxDiscoverRepliesPerDay: clampInt(r.maxDiscoverRepliesPerDay, 0, 100, d.maxDiscoverRepliesPerDay),
  }
}

export function getSettings(): AppSettings {
  const stored = normalize(db.get<Partial<AppSettings>>('settings'))
  return mapSecrets(stored, decryptSecret)
}

export async function setSettings(settings: AppSettings): Promise<void> {
  const clean = normalize(settings)
  await db.set('settings', mapSecrets(clean, encryptSecret))
}
