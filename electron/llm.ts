import type { LlmSettings, TestResult } from './types'
import { THREADS_POST_MAX_CHARS } from './types'

/** Resolve configured max completion tokens (default = Threads post max chars). */
function resolveMaxTokens(llm: LlmSettings): number {
  const n = Math.round(Number(llm.maxTokens))
  if (!Number.isFinite(n)) return THREADS_POST_MAX_CHARS
  return Math.min(8192, Math.max(64, n))
}

/** LLM provider adapters: Anthropic Claude, OpenAI, Gemini, and
 *  OpenAI-compatible custom/local servers. */

const ANTHROPIC_VERSION = '2023-06-01'
const TEST_TIMEOUT_MS = 15_000
// Local models can be slow to load/generate, so generation gets a long leash.
const GEN_TIMEOUT_MS = 120_000
const GEMINI_OPENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai'

type Json = Record<string, unknown>
const asObj = (v: unknown): Json => (v !== null && typeof v === 'object' ? (v as Json) : {})
const snippet = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 200)
const stripTrailingSlashes = (u: string): string => u.trim().replace(/\/+$/, '')
const stripChatCompletionsPath = (u: string): string =>
  stripTrailingSlashes(u).replace(/\/chat\/completions$/i, '')

function localChatUrl(input: string): string {
  const base = stripTrailingSlashes(input)
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`
}

function localModelsUrl(input: string): string {
  return `${stripChatCompletionsPath(input)}/models`
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  if (err.message !== 'fetch failed') return err.message
  // Node's fetch buries the useful bit (e.g. ECONNREFUSED) in err.cause.
  const cause = asObj((err as Error & { cause?: unknown }).cause)
  if (typeof cause.code === 'string' && cause.code) return cause.code
  if (Array.isArray(cause.errors)) {
    for (const e of cause.errors) {
      const code = asObj(e).code
      if (typeof code === 'string' && code) return code
    }
  }
  if (typeof cause.message === 'string' && cause.message) return cause.message
  return err.message
}

interface HttpReply {
  ok: boolean
  status: number
  body: string
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<HttpReply> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    // Body is consumed inside the same timeout window so a stalled stream cannot hang.
    const body = await res.text()
    return { ok: res.ok, status: res.status, body }
  } catch (err) {
    if (ctrl.signal.aborted) {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s (${url})`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function validateHttpBase(base: string): string | null {
  try {
    const u = new URL(base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Base URL must use http or https'
    return null
  } catch {
    return 'Base URL is not a valid URL'
  }
}

function httpMessage(label: string, status: number, body: string): string {
  const detail = snippet(body)
  if (status === 401 || status === 403) {
    return `${label}: invalid API key (HTTP ${status})${detail ? ` — ${detail}` : ''}`
  }
  return `${label}: request failed (HTTP ${status})${detail ? ` — ${detail}` : ''}`
}

function parseJson(label: string, status: number, body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`${label}: unexpected non-JSON response (HTTP ${status}) — ${snippet(body)}`)
  }
}

/** Both Anthropic and OpenAI-style /models responses list models under data[]. */
function modelIds(data: unknown): string[] {
  const list = asObj(data).data
  if (!Array.isArray(list)) return []
  return list.map((m) => asObj(m).id).filter((id): id is string => typeof id === 'string')
}

function parseJsonObject(label: string, raw: string): Json {
  const text = raw.trim()
  if (!text) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} must be a JSON object`)
  }
  return parsed as Json
}

function parseHeadersJson(raw: string): Record<string, string> {
  const parsed = parseJsonObject('Headers JSON', raw)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') throw new Error(`Header "${key}" must be a string`)
    out[key] = value
  }
  return out
}

async function testHosted(
  label: string,
  url: string,
  apiKey: string,
  headers: Record<string, string>
): Promise<TestResult> {
  if (!apiKey.trim()) return { ok: false, message: 'API key is required' }
  const res = await request(url, { headers }, TEST_TIMEOUT_MS)
  if (!res.ok) return { ok: false, message: httpMessage(label, res.status, res.body) }
  const count = modelIds(parseJson(label, res.status, res.body)).length
  return { ok: true, message: `Connected to ${label} — ${count} models available.` }
}

async function testLocal(local: LlmSettings['local']): Promise<TestResult> {
  const base = stripTrailingSlashes(local.baseUrl)
  if (!base) return { ok: false, message: 'Base URL is required' }
  const invalid = validateHttpBase(base)
  if (invalid) return { ok: false, message: invalid }
  const apiKey = local.apiKey.trim()
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {}
  let res: HttpReply
  try {
    res = await request(localModelsUrl(base), { headers }, TEST_TIMEOUT_MS)
  } catch (err) {
    return {
      ok: false,
      message: `Could not reach ${base} — is the local LLM server running? (${describeError(err)})`,
    }
  }
  if (!res.ok) return { ok: false, message: httpMessage('Local LLM', res.status, res.body) }
  const ids = modelIds(parseJson('Local LLM', res.status, res.body))
  const model = local.model.trim()
  // Ollama lists models with a ":tag" suffix, so "llama3.1" matches "llama3.1:latest".
  const found = model !== '' && ids.some((id) => id === model || id.startsWith(`${model}:`))
  if (found) return { ok: true, message: `Connected to ${base} — model "${model}" is available.` }
  const listed =
    ids.length === 0
      ? 'no models listed'
      : `available: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ', …' : ''}`
  return {
    ok: true,
    message: `Connected to ${base} — model "${model}" not found on server — ${listed}.`,
  }
}

async function testOpenAiCompatible(
  label: string,
  cfg: { baseUrl: string; model: string; apiKey: string; headersJson?: string },
  apiKeyRequired: boolean
): Promise<TestResult> {
  const base = stripTrailingSlashes(cfg.baseUrl)
  if (!base) return { ok: false, message: 'Base URL is required' }
  const invalid = validateHttpBase(base)
  if (invalid) return { ok: false, message: invalid }
  if (apiKeyRequired && !cfg.apiKey.trim()) return { ok: false, message: 'API key is required' }
  let extraHeaders: Record<string, string> = {}
  try {
    extraHeaders = cfg.headersJson ? parseHeadersJson(cfg.headersJson) : {}
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
  const headers = {
    ...extraHeaders,
    ...(cfg.apiKey.trim() ? { authorization: `Bearer ${cfg.apiKey.trim()}` } : {}),
  }
  try {
    const res = await request(localModelsUrl(base), { headers }, TEST_TIMEOUT_MS)
    if (!res.ok) return { ok: false, message: httpMessage(label, res.status, res.body) }
    const ids = modelIds(parseJson(label, res.status, res.body))
    const model = cfg.model.trim()
    const found = model !== '' && ids.some((id) => id === model || id.startsWith(`${model}:`))
    if (found) return { ok: true, message: `Connected to ${label} — model "${model}" is available.` }
    const listed =
      ids.length === 0
        ? 'no models listed'
        : `available: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ', …' : ''}`
    return { ok: true, message: `Connected to ${label} — model "${model}" not found — ${listed}.` }
  } catch (err) {
    return { ok: false, message: `Could not reach ${base} (${describeError(err)})` }
  }
}

export async function testLlm(llm: LlmSettings): Promise<TestResult> {
  try {
    switch (llm.provider) {
      case 'claude':
        return await testHosted('Anthropic', 'https://api.anthropic.com/v1/models', llm.claude.apiKey, {
          'x-api-key': llm.claude.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        })
      case 'openai':
        return await testHosted('OpenAI', 'https://api.openai.com/v1/models', llm.openai.apiKey, {
          authorization: `Bearer ${llm.openai.apiKey}`,
        })
      case 'gemini':
        return await testOpenAiCompatible(
          'Gemini',
          { baseUrl: GEMINI_OPENAI_BASE, model: llm.gemini.model, apiKey: llm.gemini.apiKey },
          true
        )
      case 'local':
        return await testLocal(llm.local)
      case 'other':
        return await testOpenAiCompatible('Other provider', llm.other, false)
    }
  } catch (err) {
    return { ok: false, message: describeError(err) }
  }
}

async function generateClaude(
  cfg: LlmSettings['claude'],
  system: string,
  user: string,
  maxTokens: number
): Promise<string> {
  if (!cfg.apiKey.trim()) throw new Error('Anthropic API key is required')
  let res: HttpReply
  try {
    res = await request(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': cfg.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        // No temperature: current Anthropic models reject non-default sampling params.
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      },
      GEN_TIMEOUT_MS
    )
  } catch (err) {
    throw new Error(`Anthropic: ${describeError(err)}`)
  }
  if (!res.ok) throw new Error(httpMessage('Anthropic', res.status, res.body))
  const blocks = asObj(parseJson('Anthropic', res.status, res.body)).content
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      const b = asObj(block)
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) return b.text.trim()
    }
  }
  throw new Error(`Anthropic: response had no text content — ${snippet(res.body)}`)
}

/** OpenAI-compatible multimodal content parts (text + image_url). */
type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

const IMAGE_FETCH_TIMEOUT_MS = 20_000
const MAX_VISION_IMAGES = 1
/** Keep payloads small — multi‑MB base64 + system prompt blows 4k ctx / crashes slots. */
const MAX_IMAGE_BYTES = 900 * 1024 // ~900KB
/** Vision + long system prompts routinely take 20–50s on a single GPU slot. */
const VISION_TIMEOUT_MS = 180_000

/**
 * Permanent kill-switch only for true "no mmproj / image not supported".
 * Transient ECONNREFUSED after a vision POST must NOT set this forever.
 */
let localVisionDisabledReason: string | null = null

/**
 * Serialize every local completion. Jarvis llama-server uses --parallel 1;
 * concurrent post + vision reply races cause "works once then ECONNREFUSED".
 */
let localLlmChain: Promise<unknown> = Promise.resolve()

function withLocalLlmLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = localLlmChain.then(fn, fn)
  localLlmChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** Clean model ids like "gemma4-v2." that some UIs leave with trailing junk. */
function cleanModelId(model: string): string {
  return model.trim().replace(/[.\s]+$/g, '').trim()
}

/**
 * Download a remote image and return a data: URL for local vision models.
 * Returns null on failure so callers can fall back to text-only.
 */
async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  const u = url.trim()
  if (!u || !/^https?:\/\//i.test(u)) return null
  if (u.startsWith('data:image/')) return u
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(u, {
      signal: controller.signal,
      headers: {
        // Threads/CDN often want a browser-like UA.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    })
    if (!res.ok) {
      console.warn(`[llm] image fetch HTTP ${res.status} for ${u.slice(0, 80)}`)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) {
      console.warn(`[llm] image skip size=${buf.byteLength} for ${u.slice(0, 80)}`)
      return null
    }
    const ctHeader = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    let mime = ctHeader.startsWith('image/') ? ctHeader : ''
    if (!mime) {
      if (buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg'
      else if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png'
      else if (buf[0] === 0x47 && buf[1] === 0x49) mime = 'image/gif'
      else if (buf[0] === 0x52 && buf[1] === 0x49) mime = 'image/webp'
      else if (/\.jpe?g(\?|$)/i.test(u)) mime = 'image/jpeg'
      else if (/\.png(\?|$)/i.test(u)) mime = 'image/png'
      else if (/\.webp(\?|$)/i.test(u)) mime = 'image/webp'
      else mime = 'image/jpeg'
    }
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (err) {
    console.warn(`[llm] image fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function buildUserContent(
  user: string,
  imageUrls?: string[]
): Promise<{ content: string | ChatContentPart[]; imageCount: number }> {
  const urls = (imageUrls ?? []).filter((u) => typeof u === 'string' && u.trim()).slice(0, MAX_VISION_IMAGES)
  if (urls.length === 0) return { content: user, imageCount: 0 }
  if (localVisionDisabledReason) {
    console.warn(
      `[llm] vision skip: session disabled (${localVisionDisabledReason}). ${urls.length} URL(s) ignored.`
    )
    return { content: user, imageCount: 0 }
  }
  // Images first, then text — some multimodal stacks prefer that order.
  const parts: ChatContentPart[] = []
  let imageCount = 0
  let failed = 0
  for (const url of urls) {
    const dataUrl = await fetchImageAsDataUrl(url)
    if (dataUrl) {
      parts.push({ type: 'image_url', image_url: { url: dataUrl } })
      imageCount++
    } else {
      failed++
    }
  }
  if (imageCount === 0) {
    console.warn(
      `[llm] vision: 0/${urls.length} image(s) downloaded (failed=${failed}). Falling back to text-only.`
    )
    return {
      content:
        user +
        '\n\n(Note: an image was present on their post but AutoThreads could not download it for vision. Reply from the text only.)',
      imageCount: 0,
    }
  }
  if (failed > 0) {
    console.warn(`[llm] vision: attached ${imageCount}/${urls.length} image(s); ${failed} failed to download.`)
  } else {
    console.info(`[llm] vision: attached ${imageCount} image(s) for multimodal completion.`)
  }
  parts.push({ type: 'text', text: user })
  return { content: parts, imageCount }
}

/** llama.cpp without --mmproj rejects multimodal payloads. */
function isVisionUnsupportedError(status: number, body: string): boolean {
  const hay = `${status} ${body}`.toLowerCase()
  if (hay.includes('mmproj')) return true
  if (hay.includes('image input is not supported')) return true
  if (hay.includes('image input') && hay.includes('not supported')) return true
  if (hay.includes('multimodal') && hay.includes('not supported')) return true
  if (hay.includes('vision') && (hay.includes('not supported') || hay.includes('unsupported'))) return true
  // Generic 4xx/5xx that clearly point at images
  if ((status === 400 || status === 415 || status === 500) && hay.includes('image') && hay.includes('support'))
    return true
  return false
}

function extractAssistantText(label: string, status: number, body: string): string {
  const choices = asObj(parseJson(label, status, body)).choices
  const first = Array.isArray(choices) && choices.length > 0 ? asObj(choices[0]) : {}
  const content = asObj(first.message).content
  if (typeof content === 'string' && content.trim()) return content.trim()
  if (Array.isArray(content)) {
    const text = content
      .map((p) => {
        const o = asObj(p)
        if (typeof o.text === 'string') return o.text
        return ''
      })
      .join('')
      .trim()
    if (text) return text
  }
  throw new Error(`${label}: response had no message content — ${snippet(body)}`)
}


/** Network / crash codes seen when a local server dies on multimodal POSTs. */
function isTransientVisionTransportError(message: string): boolean {
  const hay = message.toLowerCase()
  return (
    hay.includes('econnrefused') ||
    hay.includes('econnreset') ||
    hay.includes('econnaborted') ||
    hay.includes('epipe') ||
    hay.includes('socket hang up') ||
    hay.includes('fetch failed') ||
    hay.includes('network') ||
    hay.includes('timed out') ||
    hay.includes('timeout') ||
    hay.includes('und_err') ||
    hay.includes('other side closed')
  )
}

function textOnlyFallbackUser(user: string): string {
  return (
    user +
    '\n\n(An image was attached but this local server could not use vision for this reply. Answer from the text only — do not invent image details.)'
  )
}

/** Models URL next to a chat/completions endpoint (OpenAI-compatible). */
function modelsProbeUrl(chatUrl: string): string {
  try {
    const u = new URL(chatUrl)
    u.pathname = u.pathname.replace(/\/chat\/completions\/?$/i, '/models')
    if (!/\/models$/i.test(u.pathname)) {
      u.pathname = `${stripTrailingSlashes(u.pathname)}/models`
    }
    return u.toString()
  } catch {
    return `${stripChatCompletionsPath(chatUrl)}/models`
  }
}

async function waitForLocalServer(
  chatUrl: string,
  attempts = 12,
  delayMs = 750
): Promise<boolean> {
  const probe = modelsProbeUrl(chatUrl)
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await request(probe, { method: 'GET' }, 4_000)
      if (res.ok || res.status === 401 || res.status === 403) return true
    } catch {
      /* still down */
    }
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return false
}

/**
 * After a multimodal attempt fails, disable vision for this process and retry text-only.
 * Vision can crash undersized llama-server (ubatch < image tokens) → ECONNREFUSED for all
 * subsequent calls; wait briefly for a restart, then text-only if the server is alive.
 */
async function retryTextOnlyAfterVisionFailure(
  label: string,
  url: string,
  headers: Record<string, string>,
  modelId: string,
  system: string,
  user: string,
  sampling: Json,
  reason: string,
  /** Permanent disable only for true "no mmproj" — not transient crashes. */
  permanentDisable: boolean
): Promise<string> {
  if (permanentDisable) {
    localVisionDisabledReason = reason
  }
  console.warn(
    `[llm] local vision failed — text-only retry. Detail: ${reason}. ` +
      (permanentDisable
        ? 'Vision disabled for this process (server rejected images / no mmproj).'
        : 'Vision will be tried again next time if the server is healthy.')
  )
  const up = await waitForLocalServer(url)
  if (!up) {
    throw new Error(
      `${label}: ECONNREFUSED — local server is down (often crashed on a vision/image request). ` +
        `Start Jarvis primary LLM (port 8080) and ensure --ubatch-size >= --image-max-tokens when using mmproj.`
    )
  }
  return chatCompletion(label, url, headers, modelId, system, textOnlyFallbackUser(user), sampling, undefined)
}

async function chatCompletion(
  label: string,
  url: string,
  headers: Record<string, string>,
  model: string,
  system: string,
  user: string,
  // OpenAI reasoning models reject max_tokens and non-default temperature, while
  // local OpenAI-compatible servers expect max_tokens — so the caller picks.
  sampling: Json,
  /** When set, user message becomes multimodal (vision). Local path only for now. */
  imageUrls?: string[]
): Promise<string> {
  const modelId = cleanModelId(model)
  const urls = (imageUrls ?? []).filter((u) => typeof u === 'string' && u.trim())
  const built = await buildUserContent(user, urls)
  const sentImages = built.imageCount > 0
  if (sentImages) {
    console.info(`[llm] vision: sending ${built.imageCount} image(s) to ${label}`)
  }
  const body = {
    ...sampling,
    model: modelId,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: built.content },
    ],
  }
  const timeoutMs = sentImages ? VISION_TIMEOUT_MS : GEN_TIMEOUT_MS
  let res: HttpReply
  try {
    res = await request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      timeoutMs
    )
  } catch (err) {
    const detail = describeError(err)
    // Any transport failure after we attached images → text-only (server may
    // still be up for text, or recover after a brief crash).
    if (sentImages && isTransientVisionTransportError(detail)) {
      return retryTextOnlyAfterVisionFailure(
        label,
        url,
        headers,
        modelId,
        system,
        user,
        sampling,
        detail || 'connection failed on vision request',
        false
      )
    }
    // Non-vision ECONNREFUSED: wait once then retry plain text (busy slot / blip).
    if (!sentImages && isTransientVisionTransportError(detail)) {
      const up = await waitForLocalServer(url, 8, 500)
      if (up) {
        console.warn(`[llm] ${label} transient ${detail} — retrying text once`)
        return chatCompletion(label, url, headers, modelId, system, user, sampling, undefined)
      }
    }
    throw new Error(`${label}: ${detail}`)
  }
  if (!res.ok && sentImages) {
    if (isVisionUnsupportedError(res.status, res.body) || res.status >= 400) {
      const detail = snippet(res.body) || `HTTP ${res.status}`
      const permanent = isVisionUnsupportedError(res.status, res.body)
      return retryTextOnlyAfterVisionFailure(
        label,
        url,
        headers,
        modelId,
        system,
        user,
        sampling,
        detail,
        permanent
      )
    }
  }
  if (!res.ok) throw new Error(httpMessage(label, res.status, res.body))
  if (sentImages) {
    console.info(`[llm] vision: ${label} accepted multimodal request`)
  }
  return extractAssistantText(label, res.status, res.body)
}

export type GenerateTextOptions = {
  /** Image URLs (https or data:) — only used when provider is `local`. */
  imageUrls?: string[]
}

/** True when this process already learned the local server cannot do vision. */
export function isLocalVisionDisabled(): boolean {
  return Boolean(localVisionDisabledReason)
}

export function localVisionDisabledMessage(): string | null {
  return localVisionDisabledReason
}

/** Clear the session vision kill-switch (e.g. after user restarts llama with --mmproj and saves settings). */
export function clearLocalVisionDisabled(): void {
  if (localVisionDisabledReason) {
    console.info(`[llm] vision re-enabled (was disabled: ${localVisionDisabledReason})`)
  }
  localVisionDisabledReason = null
}

export async function generateText(
  llm: LlmSettings,
  system: string,
  user: string,
  opts?: GenerateTextOptions
): Promise<string> {
  const maxTokens = resolveMaxTokens(llm)
  // Vision is intentionally local-only for now (user's OpenAI-compatible vision model).
  let visionUrls = llm.provider === 'local' ? opts?.imageUrls : undefined
  // Only skip vision for permanent "no mmproj" disables — not after transient crashes.
  if (visionUrls?.length && localVisionDisabledReason) {
    console.warn(`[llm] skipping images (vision disabled this session: ${localVisionDisabledReason})`)
    visionUrls = undefined
  }

  const run = async (): Promise<string> => {
    switch (llm.provider) {
      case 'claude':
        return generateClaude(llm.claude, system, user, maxTokens)
      case 'openai': {
        if (!llm.openai.apiKey.trim()) throw new Error('OpenAI API key is required')
        return chatCompletion(
          'OpenAI',
          'https://api.openai.com/v1/chat/completions',
          { authorization: `Bearer ${llm.openai.apiKey}` },
          cleanModelId(llm.openai.model),
          system,
          user,
          { max_completion_tokens: maxTokens }
        )
      }
      case 'gemini': {
        if (!llm.gemini.apiKey.trim()) throw new Error('Gemini API key is required')
        return chatCompletion(
          'Gemini',
          `${GEMINI_OPENAI_BASE}/chat/completions`,
          { authorization: `Bearer ${llm.gemini.apiKey}` },
          cleanModelId(llm.gemini.model),
          system,
          user,
          { max_tokens: maxTokens, temperature: 0.8 }
        )
      }
      case 'local': {
        const base = stripTrailingSlashes(llm.local.baseUrl)
        if (!base) throw new Error('Local LLM base URL is required')
        const invalid = validateHttpBase(base)
        if (invalid) throw new Error(`Local LLM: ${invalid}`)
        const chatUrl = localChatUrl(base)
        // Fail fast with a clear message when Jarvis/llama-server is not listening.
        const up = await waitForLocalServer(chatUrl, 3, 300)
        if (!up) {
          throw new Error(
            'Local LLM: ECONNREFUSED — nothing is listening on the configured base URL ' +
              `(${base}). Start the Jarvis primary llama-server (default http://127.0.0.1:8080).`
          )
        }
        const apiKey = llm.local.apiKey.trim()
        return chatCompletion(
          'Local LLM',
          chatUrl,
          apiKey ? { authorization: `Bearer ${apiKey}` } : {},
          cleanModelId(llm.local.model),
          system,
          user,
          { max_tokens: maxTokens, temperature: 0.8 },
          visionUrls
        )
      }
      case 'other': {
        const base = stripTrailingSlashes(llm.other.baseUrl)
        if (!base) throw new Error('Other provider base URL is required')
        const invalid = validateHttpBase(base)
        if (invalid) throw new Error(`Other provider: ${invalid}`)
        const extraHeaders = parseHeadersJson(llm.other.headersJson)
        const bodyOverrides = parseJsonObject('Request JSON', llm.other.bodyJson)
        // Inject max_tokens unless Request JSON already sets a completion limit.
        const hasCap =
          Object.prototype.hasOwnProperty.call(bodyOverrides, 'max_tokens') ||
          Object.prototype.hasOwnProperty.call(bodyOverrides, 'max_completion_tokens')
        const sampling: Json = hasCap ? bodyOverrides : { max_tokens: maxTokens, ...bodyOverrides }
        const apiKey = llm.other.apiKey.trim()
        return chatCompletion(
          'Other provider',
          localChatUrl(base),
          { ...extraHeaders, ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          llm.other.model,
          system,
          user,
          sampling
        )
      }
    }
  }

  // Local / localhost "other" must never run concurrent completions against a
  // single-slot llama-server (post phase + reply vision phase used to race).
  const usesLocalSlot =
    llm.provider === 'local' ||
    (llm.provider === 'other' &&
      /localhost|127\.0\.0\.1/i.test(stripTrailingSlashes(llm.other.baseUrl)))
  return usesLocalSlot ? withLocalLlmLock(run) : run()
}
