/** Shared DTO types for the electron layer. Keep in sync with src/types.ts
 *  (the app tsconfig only includes src/, so the shapes are duplicated here). */

export type ThemeMode = 'light' | 'dark'
export type LanguageCode = 'en' | 'es' | 'ko' | 'zh' | 'ja' | 'fr' | 'de' | 'pt'
export type LlmProviderKind = 'claude' | 'openai' | 'gemini' | 'local' | 'other'
export type DraftKind = 'post' | 'reply'
export type DraftStatus = 'draft' | 'scheduled' | 'posting' | 'posted' | 'failed'

/** Threads text post character limit — default for LLM max_tokens as well. */
export const THREADS_POST_MAX_CHARS = 500

export interface LlmSettings {
  provider: LlmProviderKind
  /**
   * Max completion tokens sent to the model.
   * Defaults to {@link THREADS_POST_MAX_CHARS} (500) so output stays in post-sized range.
   */
  maxTokens: number
  claude: { apiKey: string; model: string }
  openai: { apiKey: string; model: string }
  gemini: { apiKey: string; model: string }
  local: { baseUrl: string; model: string; apiKey: string }
  other: { baseUrl: string; model: string; apiKey: string; headersJson: string; bodyJson: string }
}

export interface ImageCandidate {
  url: string
  thumbUrl: string
  title: string
  source: string
  pageUrl: string
}

export interface ThreadsSettings {
  accessToken: string
  userId: string
  username: string
  appId: string
  appSecret: string
  redirectUri: string
  scopes: string
  tokenExpiresAt: number | null
}

export interface StyleSettings {
  notes: string
  samples: string[]
}

export interface AutoDraftSettings {
  enabled: boolean
  intervalMinutes: number
  maxPerRun: number
}

export type PostLanguageMode = 'match' | 'ko' | 'en' | 'ui'

/** Full-Auto ("autopilot") mode: the agent decides and acts on its own. */
export interface AutopilotSettings {
  enabled: boolean            // Full-Auto is launched and running
  goLive: boolean             // publish for real; when false, decisions become drafts only
  intervalMinutes: number     // how often the agent thinks about new posts
  replyIntervalMinutes: number // how often it scans replies + @mentions (separate, usually faster)
  goal: string                // what the agent is trying to achieve
  /**
   * Temporary secondary objective (e.g. soft-promote an app). Empty = off.
   * Woven in lightly alongside the main goal — not every post.
   */
  sideMission: string
  categories: string[]        // niches the agent posts about
  postLanguage: PostLanguageMode
  toneNotes: string           // optional extra personality guidance
  maxPostsPerDay: number
  maxPostsPerRun: number
  originalRatio: number       // 0-100: how often to post original/funny vs news reactions
  agentName: string           // the agent's persona name
  creatorName: string         // "an AI agent created by ___"
  creatorHandle: string       // the creator's Threads @handle (without @)
  creatorAddress: string      // how to address the creator, e.g. "Master"
  replyToAll: boolean         // scan and answer unanswered replies on your posts
  replyToReplies: boolean      // scan replies to your replies anywhere
  replyToMentions: boolean    // also answer @mentions of your account on others' posts
  autoReply: boolean          // publish replies for real vs draft them
  maxRepliesPerRun: number
  maxRepliesPerDay: number
  /** Skip some post ticks at random so the feed feels less robotic ("here and there"). */
  sporadicPosts: boolean
  /**
   * Prefer fresh scraped news for most posts; occasionally share feelings based on
   * the last few posts + replies and talk to followers about prior remarks.
   */
  liveNewsInteractive: boolean
  /**
   * Reply to random public posts found via keyword search in your niches.
   * Needs threads_keyword_search on the token (public results need advanced access).
   */
  engageDiscover: boolean
  maxDiscoverRepliesPerRun: number
  maxDiscoverRepliesPerDay: number
  /**
   * How many recent posts to load for anti-repeat + planning context (saves tokens).
   * Default 5; was hard-coded 15.
   */
  recentPostMemory: number
}

export type AutopilotLogKind = 'post' | 'reply' | 'skip' | 'error' | 'info'

export interface AutopilotLogEntry {
  id: string
  at: number
  kind: AutopilotLogKind
  message: string
  permalink?: string
}

export interface AutopilotStatus {
  running: boolean
  goLive: boolean
  busy: boolean
  postsToday: number
  maxPostsPerDay: number
  repliesToday: number
  maxRepliesPerDay: number
  intervalMinutes: number
  replyIntervalMinutes: number
  lastRunAt: number | null
  nextRunAt: number | null
  lastReplyRunAt: number | null
  nextReplyRunAt: number | null
  llmReady: boolean
  threadsReady: boolean
  log: AutopilotLogEntry[]
}

export interface CustomNewsSource {
  id: string
  name: string
  url: string
  enabled: boolean
}

export interface NewsSourceSettings {
  google: boolean
  yahoo: boolean
  hackerNews: boolean
  naver: boolean
  custom: CustomNewsSource[]
}

export interface AppSettings {
  theme: ThemeMode
  language: LanguageCode
  onboarded: boolean
  topics: string[]
  newsSources: NewsSourceSettings
  llm: LlmSettings
  threads: ThreadsSettings
  style: StyleSettings
  autoDraft: AutoDraftSettings
  autopilot: AutopilotSettings
}

export interface Draft {
  id: string
  kind: DraftKind
  text: string
  topic?: string
  sourceTitle?: string
  sourceUrl?: string
  imageUrl?: string
  imageThumbUrl?: string
  imageTitle?: string
  imagePageUrl?: string
  replyToId?: string
  replyToText?: string
  replyToUsername?: string
  status: DraftStatus
  scheduledAt?: number
  postedAt?: number
  threadsMediaId?: string
  /** Root media id after part 1 of a multi-part thread publishes (resume support). */
  threadRootId?: string
  /** How many numbered parts are already live (1 after root). Retry continues from here. */
  threadPartsPosted?: number
  permalink?: string
  error?: string
  createdAt: number
  updatedAt: number
}

export interface NewsItem {
  title: string
  link: string
  source: string
  publishedAt: number | null
  topic: string
}

export interface ThreadsPost {
  id: string
  text: string
  timestamp: string
  permalink?: string
}

/** Where the inbound message came from. */
export type EngagementKind = 'reply' | 'mention'

export interface UnansweredReply {
  id: string
  text: string
  username: string
  timestamp: string
  rootPostId: string
  rootPostText: string
  /** 'reply' = comment on your post; 'mention' = someone @mentioned you. Defaults to reply. */
  kind?: EngagementKind
  /**
   * Image (or video thumbnail) URLs from Threads media, if any.
   * Used for local vision models only.
   */
  imageUrls?: string[]
}

export interface TestResult {
  ok: boolean
  message: string
}

export interface ThreadsOAuthResult extends TestResult {
  accessToken?: string
  userId?: string
  username?: string
  tokenExpiresAt?: number | null
}

export interface GenerateResult {
  ok: boolean
  text: string
  message: string
}
