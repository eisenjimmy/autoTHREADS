import { db } from './localdb'
import type { Draft, DraftKind, DraftStatus } from './types'

/**
 * Draft store, owned by the main process so the renderer and the scheduler
 * never race writes to the same file. All mutations flow through here; the
 * registered listener fans changes back out to the renderer.
 */

let cache: Draft[] | null = null
let onChanged: ((drafts: Draft[]) => void) | null = null

const KINDS: DraftKind[] = ['post', 'reply']
const STATUSES: DraftStatus[] = ['draft', 'scheduled', 'posting', 'posted', 'failed']

const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const optNum = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/** Coerce untrusted renderer/IPC input into a well-typed Draft. Bad fields fall
 *  back to safe defaults so a malformed draft can never crash the scheduler. */
function sanitizeDraft(input: unknown): Draft {
  const o = (input ?? {}) as Record<string, unknown>
  const now = Date.now()
  const kind: DraftKind = KINDS.includes(o.kind as DraftKind) ? (o.kind as DraftKind) : 'post'
  const status: DraftStatus = STATUSES.includes(o.status as DraftStatus)
    ? (o.status as DraftStatus)
    : 'draft'
  return {
    id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
    kind,
    text: typeof o.text === 'string' ? o.text : '',
    topic: optStr(o.topic),
    sourceTitle: optStr(o.sourceTitle),
    sourceUrl: optStr(o.sourceUrl),
    imageUrl: optStr(o.imageUrl),
    imageThumbUrl: optStr(o.imageThumbUrl),
    imageTitle: optStr(o.imageTitle),
    imagePageUrl: optStr(o.imagePageUrl),
    replyToId: optStr(o.replyToId),
    replyToText: optStr(o.replyToText),
    replyToUsername: optStr(o.replyToUsername),
    status,
    scheduledAt: optNum(o.scheduledAt),
    postedAt: optNum(o.postedAt),
    threadsMediaId: optStr(o.threadsMediaId),
    threadRootId: optStr(o.threadRootId),
    threadPartsPosted: optNum(o.threadPartsPosted),
    permalink: optStr(o.permalink),
    error: optStr(o.error),
    createdAt: optNum(o.createdAt) ?? now,
    updatedAt: now,
  }
}

export function setDraftsChangedListener(cb: (drafts: Draft[]) => void): void {
  onChanged = cb
}

export function allDrafts(): Draft[] {
  if (!cache) cache = db.get<Draft[]>('drafts') ?? []
  return cache
}

async function persist(): Promise<Draft[]> {
  const list = allDrafts()
  await db.set('drafts', list)
  onChanged?.(list)
  return list
}

export async function upsertDraft(input: unknown): Promise<Draft[]> {
  const draft = sanitizeDraft(input)
  const list = allDrafts()
  const i = list.findIndex((d) => d.id === draft.id)
  // The scheduler owns 'posting'/'posted' transitions; a racing renderer upsert
  // must not roll a draft back mid-publish (which would defeat the post guard).
  if (i >= 0 && (list[i].status === 'posting' || list[i].status === 'posted')) {
    return list
  }
  if (i >= 0) list[i] = draft
  else list.unshift(draft)
  return persist()
}

export async function deleteDraft(id: string): Promise<Draft[]> {
  cache = allDrafts().filter((d) => d.id !== id)
  return persist()
}

/** Patch a draft in place; returns the updated draft or null if missing. */
export async function updateDraft(id: string, patch: Partial<Draft>): Promise<Draft | null> {
  const list = allDrafts()
  const i = list.findIndex((d) => d.id === id)
  if (i < 0) return null
  list[i] = { ...list[i], ...patch, updatedAt: Date.now() }
  await persist()
  return list[i]
}
