/** Shared application types. Keep in sync with electron/types.ts (the electron
 *  tsconfig only includes electron/, so the DTO shapes are duplicated there). */

export type ThemeMode = 'light' | 'dark'
export type LanguageCode = 'en' | 'es' | 'ko' | 'zh' | 'ja' | 'fr' | 'de' | 'pt'
export type LlmProviderKind = 'claude' | 'openai' | 'gemini' | 'local' | 'other'
export type DraftKind = 'post' | 'reply'
export type DraftStatus = 'draft' | 'scheduled' | 'posting' | 'posted' | 'failed'
export type ViewId = 'drafts' | 'news' | 'replies' | 'queue' | 'autopilot' | 'settings'
export type PostLanguageMode = 'match' | 'ko' | 'en' | 'ui'

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

/** Full-Auto ("autopilot") mode: the agent decides and acts on its own. */
export interface AutopilotSettings {
  enabled: boolean
  goLive: boolean
  intervalMinutes: number
  replyIntervalMinutes: number
  goal: string
  categories: string[]
  postLanguage: PostLanguageMode
  toneNotes: string
  maxPostsPerDay: number
  maxPostsPerRun: number
  originalRatio: number
  agentName: string
  creatorName: string
  creatorHandle: string
  creatorAddress: string
  replyToAll: boolean
  replyToMentions: boolean
  autoReply: boolean
  maxRepliesPerRun: number
  maxRepliesPerDay: number
  sporadicPosts: boolean
  liveNewsInteractive: boolean
  engageDiscover: boolean
  maxDiscoverRepliesPerRun: number
  maxDiscoverRepliesPerDay: number
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

export interface ImageCandidate {
  url: string
  thumbUrl: string
  title: string
  source: string
  pageUrl: string
}

export type EngagementKind = 'reply' | 'mention'

export interface UnansweredReply {
  id: string
  text: string
  username: string
  timestamp: string
  rootPostId: string
  rootPostText: string
  /** 'reply' = comment on your post; 'mention' = someone @mentioned you. */
  kind?: EngagementKind
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

export interface Toast {
  id: number
  kind: 'ok' | 'err'
  text: string
}

/** The IPC bridge exposed by electron/preload.ts as window.api. */
export interface BridgeApi {
  settingsGet(): Promise<AppSettings>
  settingsSet(settings: AppSettings): Promise<void>
  llmTest(llm: LlmSettings): Promise<TestResult>
  threadsOAuthStart(cfg: Pick<ThreadsSettings, 'appId' | 'appSecret' | 'redirectUri' | 'scopes'>): Promise<ThreadsOAuthResult>
  threadsTest(cfg: { accessToken: string; userId: string }): Promise<TestResult & { username?: string; userId?: string }>
  threadsScrapeStyle(count: number): Promise<{ ok: boolean; samples: string[]; message: string }>
  newsFetch(input: string | { query: string; mode?: 'news' | 'blogs'; sources?: NewsSourceSettings }): Promise<NewsItem[]>
  generatePost(input: {
    topic: string
    newsTitle?: string
    newsSource?: string
    newsUrl?: string
  }): Promise<GenerateResult>
  generateReply(input: {
    replyText: string
    replyUsername: string
    rootPostText: string
    kind?: EngagementKind
  }): Promise<GenerateResult>
  imageKeywords(input: { topic?: string; title?: string; text: string }): Promise<GenerateResult>
  imageSearch(query: string): Promise<{ ok: boolean; images: ImageCandidate[]; message: string }>
  unansweredReplies(): Promise<{
    ok: boolean
    replies: UnansweredReply[]
    message: string
    mentionError?: string | null
    /** Present when long conversations were cut at maxPerThread unanswered each. */
    threadCap?: {
      maxPerThread: number
      threadsTruncated: number
      dropped: number
    } | null
  }>
  draftsAll(): Promise<Draft[]>
  draftUpsert(draft: Draft): Promise<Draft[]>
  draftDelete(id: string): Promise<Draft[]>
  draftPostNow(id: string): Promise<{ ok: boolean; message: string; drafts: Draft[] }>
  autopilotStatus(): Promise<AutopilotStatus>
  autopilotSetRunning(running: boolean): Promise<AutopilotStatus>
  autopilotRunNow(): Promise<AutopilotStatus>
  openExternal(url: string): Promise<void>
  onDraftsChanged(cb: (drafts: Draft[]) => void): void
  onAutopilotStatus(cb: (status: AutopilotStatus) => void): void
}

export const DEFAULT_TOPICS = ['artificial intelligence', 'technology', 'startups']

/** Niche categories the autopilot can post about.
 *  `popular` marks niches that currently perform well on Threads (AI, tech, creator economy…). */
export const AUTOPILOT_CATEGORIES: { id: string; en: string; ko: string; popular?: boolean }[] = [
  // Popular on Threads first — these are the default Full-Auto picks.
  { id: 'ai', en: 'AI', ko: 'AI', popular: true },
  { id: 'technology', en: 'Technology', ko: '기술', popular: true },
  { id: 'development', en: 'Dev / Coding', ko: '개발', popular: true },
  { id: 'startups', en: 'Startups', ko: '스타트업', popular: true },
  { id: 'productivity', en: 'Productivity', ko: '생산성', popular: true },
  { id: 'sidehustle', en: 'Side hustle', ko: '부업', popular: true },
  { id: 'creator', en: 'Creator economy', ko: '크리에이터', popular: true },
  { id: 'career', en: 'Career', ko: '커리어', popular: true },
  { id: 'crypto', en: 'Crypto', ko: '암호화폐', popular: true },
  { id: 'finance', en: 'Finance', ko: '금융', popular: true },
  { id: 'marketing', en: 'Marketing', ko: '마케팅', popular: true },
  { id: 'humor', en: 'Humor & Memes', ko: '유머·밈', popular: true },
  { id: 'gaming', en: 'Gaming', ko: '게임', popular: true },
  { id: 'fitness', en: 'Fitness', ko: '피트니스', popular: true },
  // More niches
  { id: 'business', en: 'Business', ko: '비즈니스' },
  { id: 'science', en: 'Science', ko: '과학' },
  { id: 'health', en: 'Health', ko: '건강' },
  { id: 'fashion', en: 'Fashion', ko: '패션' },
  { id: 'beauty', en: 'Beauty', ko: '뷰티' },
  { id: 'lifestyle', en: 'Lifestyle', ko: '라이프스타일' },
  { id: 'food', en: 'Food', ko: '음식' },
  { id: 'travel', en: 'Travel', ko: '여행' },
  { id: 'sports', en: 'Sports', ko: '스포츠' },
  { id: 'entertainment', en: 'Entertainment', ko: '엔터테인먼트' },
  { id: 'music', en: 'Music', ko: '음악' },
  { id: 'movies', en: 'Movies & TV', ko: '영화·드라마' },
  { id: 'books', en: 'Books', ko: '책' },
  { id: 'design', en: 'Design', ko: '디자인' },
  { id: 'environment', en: 'Environment', ko: '환경' },
  { id: 'education', en: 'Education', ko: '교육' },
]

/** Default Full-Auto niches — popular Threads categories, AI-first. */
export const AUTOPILOT_POPULAR_CATEGORY_IDS: string[] = AUTOPILOT_CATEGORIES.filter((c) => c.popular).map(
  (c) => c.id
)
export const AUTOPILOT_DEFAULT_CATEGORIES = ['ai', 'technology', 'startups', 'productivity', 'humor']

export const LLM_DEFAULTS = {
  claudeModel: 'claude-sonnet-5',
  openaiModel: 'gpt-4o-mini',
  geminiModel: 'gemini-3.5-flash',
  localBaseUrl: 'http://127.0.0.1:8080/v1/chat/completions',
  localModel: 'gemma4-v2',
  otherBaseUrl: 'https://openrouter.ai/api/v1',
  otherModel: '',
} as const
