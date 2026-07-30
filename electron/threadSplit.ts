/**
 * Split long post text into Threads-sized parts with 1/n … n/n labels.
 * Threads hard-caps each post at MAX_CHARS; multi-part posts become a reply thread.
 */

export const THREADS_MAX_CHARS = 500
/** Max posts in one numbered thread (1/n … n/n). */
export const THREADS_MAX_PARTS = 5
/** Max continuous draft length before we hard-cap generation (~5 × 500). */
export const THREADS_MAX_THREAD_CHARS = THREADS_MAX_CHARS * THREADS_MAX_PARTS

const LABEL = (i: number, n: number) => `${i}/${n} `

/**
 * Split `text` into at most THREADS_MAX_PARTS parts that each fit under THREADS_MAX_CHARS
 * including the "k/n " prefix. Prefer paragraph, then sentence, then word boundaries.
 */
export function splitIntoThreadParts(text: string): string[] {
  const raw = text.replace(/\n{3,}/g, '\n\n').trim()
  if (!raw) return []

  // Already short enough for a single post (no label needed).
  if (raw.length <= THREADS_MAX_CHARS) return [raw]

  // Estimate part count from length (labels use a few chars each).
  // Use worst-case label "5/5 " = 4 chars; leave margin for safety.
  const labelReserve = 6
  const bodyBudget = THREADS_MAX_CHARS - labelReserve
  let n = Math.min(THREADS_MAX_PARTS, Math.max(2, Math.ceil(raw.length / bodyBudget)))

  // Grow n if greedy packing still overflows.
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = packParts(raw, n, bodyBudget)
    if (parts && parts.every((p) => p.length <= THREADS_MAX_CHARS)) return parts
    n = Math.min(THREADS_MAX_PARTS, n + 1)
  }

  // Last resort: hard slice with ellipsis on overflow of final part.
  return hardSlice(raw, Math.min(THREADS_MAX_PARTS, n), bodyBudget)
}

function packParts(raw: string, n: number, bodyBudget: number): string[] | null {
  const chunks: string[] = []
  let rest = raw
  for (let i = 1; i <= n; i++) {
    const isLast = i === n
    if (!rest) break
    if (isLast) {
      let body = rest.trim()
      if (body.length > bodyBudget) {
        body = body.slice(0, bodyBudget - 1).replace(/\s+\S*$/, '').trimEnd() + '…'
      }
      chunks.push(LABEL(i, n) + body)
      rest = ''
      break
    }
    const remainingParts = n - i + 1
    // Ideal take: leave proportional room for remaining parts.
    const ideal = Math.min(bodyBudget, Math.ceil(rest.length / remainingParts))
    const take = takeChunk(rest, Math.min(bodyBudget, Math.max(ideal, Math.floor(bodyBudget * 0.55))))
    if (!take) return null
    chunks.push(LABEL(i, n) + take.chunk)
    rest = take.rest
  }
  if (rest.trim()) {
    // Leftover that didn't fit — fail pack so caller increases n.
    return null
  }
  return chunks
}

function takeChunk(text: string, maxBody: number): { chunk: string; rest: string } | null {
  if (text.length <= maxBody) return { chunk: text.trim(), rest: '' }
  const window = text.slice(0, maxBody)

  // Prefer double newline (paragraph).
  let cut = window.lastIndexOf('\n\n')
  if (cut >= Math.floor(maxBody * 0.4)) {
    return { chunk: text.slice(0, cut).trim(), rest: text.slice(cut).trim() }
  }
  // Single newline.
  cut = window.lastIndexOf('\n')
  if (cut >= Math.floor(maxBody * 0.45)) {
    return { chunk: text.slice(0, cut).trim(), rest: text.slice(cut).trim() }
  }
  // Sentence end.
  const sentence = window.match(/^[\s\S]*?[.!?…](?:\s|$)/)
  if (sentence && sentence[0].length >= Math.floor(maxBody * 0.4)) {
    const len = sentence[0].trimEnd().length
    return { chunk: text.slice(0, len).trim(), rest: text.slice(len).trim() }
  }
  // Word boundary.
  cut = window.lastIndexOf(' ')
  if (cut >= Math.floor(maxBody * 0.35)) {
    return { chunk: text.slice(0, cut).trim(), rest: text.slice(cut).trim() }
  }
  // Hard cut.
  return { chunk: window.trim(), rest: text.slice(maxBody).trim() }
}

function hardSlice(raw: string, n: number, bodyBudget: number): string[] {
  const out: string[] = []
  let rest = raw
  for (let i = 1; i <= n; i++) {
    const isLast = i === n
    if (!rest) break
    if (isLast || rest.length <= bodyBudget) {
      let body = rest.trim()
      if (body.length > bodyBudget) body = body.slice(0, bodyBudget - 1) + '…'
      out.push(LABEL(i, n) + body)
      break
    }
    const { chunk, rest: next } = takeChunk(rest, bodyBudget)!
    out.push(LABEL(i, n) + chunk)
    rest = next
  }
  return out
}

/** True when a post draft should be published as a multi-post thread. */
export function needsThreadSplit(text: string): boolean {
  return text.trim().length > THREADS_MAX_CHARS
}
