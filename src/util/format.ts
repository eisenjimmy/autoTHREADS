/** Tiny date/text helpers shared by the views. */

/** Relative time; pass `ko` for Korean UI (Settings language). */
export function timeAgo(ts: number | null | undefined, lang?: string): string {
  if (!ts) return ''
  const ko = lang === 'ko'
  const diff = Date.now() - ts
  if (diff < 60_000) return ko ? '방금' : 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return ko ? `${mins}분 전` : `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return ko ? `${hours}시간 전` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return ko ? `${days}일 전` : `${days}d ago`
  return new Date(ts).toLocaleDateString(ko ? 'ko-KR' : undefined)
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** epoch ms -> value for <input type="datetime-local"> in local time */
export function toDatetimeLocal(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function snippet(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
