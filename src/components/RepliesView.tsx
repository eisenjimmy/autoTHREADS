import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/appStore'
import { shellText } from '../i18n'
import type { Draft, UnansweredReply } from '../types'
import { snippet, timeAgo } from '../util/format'

type Filter = 'all' | 'replies' | 'mentions'

export default function RepliesView() {
  const drafts = useApp((s) => s.drafts)
  const settings = useApp((s) => s.settings)
  const setView = useApp((s) => s.setView)
  const selectDraft = useApp((s) => s.selectDraft)
  const upsertDraft = useApp((s) => s.upsertDraft)
  const toast = useApp((s) => s.toast)
  const text = shellText(settings?.language)
  const ko = settings?.language === 'ko'
  const t = (en: string, kr: string) => (ko ? kr : en)

  const [replies, setReplies] = useState<UnansweredReply[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mentionWarning, setMentionWarning] = useState<string | null>(null)
  const [threadCapNote, setThreadCapNote] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setMentionWarning(null)
    setThreadCapNote(null)
    try {
      const res = await window.api.unansweredReplies()
      if (res.ok) {
        setReplies(res.replies)
        if (res.mentionError) setMentionWarning(res.mentionError)
        const cap = res.threadCap
        if (cap && cap.threadsTruncated > 0) {
          setThreadCapNote(
            ko
              ? `긴 스레드는 게시물당 미답변 ${cap.maxPerThread}개(최신 우선)로 제한됩니다. ` +
                  `${cap.threadsTruncated}개 스레드가 한도에 걸려 이전 답글 ${cap.dropped}개가 숨겨졌습니다.`
              : `Long threads are capped at ${cap.maxPerThread} unanswered replies each (newest first). ` +
                  `${cap.threadsTruncated} thread(s) hit the limit — ${cap.dropped} older reply(ies) hidden.`
          )
        }
      } else {
        setReplies(null)
        setError(res.message)
      }
    } catch (err) {
      setReplies(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [ko])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const list = replies ?? []
    const mentions = list.filter((r) => r.kind === 'mention').length
    return { all: list.length, replies: list.length - mentions, mentions }
  }, [replies])

  const visible = useMemo(() => {
    const list = replies ?? []
    if (filter === 'mentions') return list.filter((r) => r.kind === 'mention')
    if (filter === 'replies') return list.filter((r) => r.kind !== 'mention')
    return list
  }, [replies, filter])

  const draftFor = (r: UnansweredReply): Draft | undefined =>
    drafts.find((d) => d.kind === 'reply' && d.replyToId === r.id)

  const generate = async (r: UnansweredReply) => {
    setBusyId(r.id)
    try {
      const res = await window.api.generateReply({
        replyText: r.text,
        replyUsername: r.username,
        rootPostText: r.rootPostText,
        kind: r.kind === 'mention' ? 'mention' : 'reply',
        imageUrls: r.imageUrls,
      })
      if (!res.ok) {
        toast('err', res.message)
        return
      }
      const now = Date.now()
      const draft: Draft = {
        id: crypto.randomUUID(),
        kind: 'reply',
        text: res.text,
        replyToId: r.id,
        replyToText: r.text,
        replyToUsername: r.username,
        topic: r.kind === 'mention' ? 'mention' : undefined,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      }
      await upsertDraft(draft)
      selectDraft(draft.id)
      toast('ok', text.draftReply)
    } catch (err) {
      toast('err', err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  // Drafts view only lists 'draft'/'failed'; scheduled/posting/posted live in Queue.
  const inDrafts = (d: Draft): boolean => d.status === 'draft' || d.status === 'failed'
  const goToDraft = (existing: Draft) => {
    selectDraft(existing.id)
    setView(inDrafts(existing) ? 'drafts' : 'queue')
  }
  const existingLabel = (d: Draft): string =>
    d.status === 'posted' ? text.posted : inDrafts(d) ? text.drafts : text.queue

  return (
    <div className="view">
      <div className="view-header">
        <span className="view-title">{text.replies}</span>
        <span className="view-sub">{text.repliesSubtitle}</span>
        <div className="view-actions">
          <button className="btn" disabled={loading} onClick={() => void load()}>
            {loading ? text.refreshing : text.refresh}
          </button>
        </div>
      </div>
      <div className="view-body no-pad stack-list">
        <div className="reply-filters">
          {(
            [
              { id: 'all' as const, label: t(`All (${counts.all})`, `전체 (${counts.all})`) },
              { id: 'replies' as const, label: t(`Replies (${counts.replies})`, `답글 (${counts.replies})`) },
              { id: 'mentions' as const, label: t(`@Mentions (${counts.mentions})`, `@멘션 (${counts.mentions})`) },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              className={`chip selectable${filter === f.id ? ' on' : ''}`}
              onClick={() => setFilter(f.id)}
              type="button"
            >
              {f.label}
            </button>
          ))}
        </div>

        {mentionWarning && (
          <div className="ap-warn" style={{ margin: '0 14px 10px' }}>
            <div>{mentionWarning}</div>
            <button className="btn small" onClick={() => setView('settings')}>
              {text.openSettings}
            </button>
          </div>
        )}

        {threadCapNote && (
          <div className="hint" style={{ margin: '0 14px 10px' }}>
            {threadCapNote}
          </div>
        )}

        {loading ? (
          <div className="empty">{text.checkingThreads}</div>
        ) : error ? (
          <div className="empty">
            {error}
            {/configur/i.test(error) && (
              <div>
                <button className="btn" onClick={() => setView('settings')}>
                  {text.openSettings}
                </button>
              </div>
            )}
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            {filter === 'mentions'
              ? t(
                  'No @mentions right now. If you expect some, check that your token has threads_manage_mentions.',
                  '지금 @멘션이 없습니다. 있어야 한다면 토큰에 threads_manage_mentions 권한이 있는지 확인하세요.'
                )
              : text.allCaughtUp}
          </div>
        ) : (
          visible.map((r) => {
            const existing = draftFor(r)
            const isMention = r.kind === 'mention'
            return (
              <div className={`list-item${isMention ? ' is-mention' : ''}`} key={r.id}>
                <div className="item-title">
                  <span>@{r.username}</span>
                  {isMention ? (
                    <span className="badge badge-mention">@mention</span>
                  ) : (
                    <span className="badge">{t('reply', '답글')}</span>
                  )}
                  {(r.imageUrls?.length ?? 0) > 0 && (
                    <span className="badge" title={r.imageUrls!.join('\n')}>
                      {t(`image ×${r.imageUrls!.length}`, `이미지 ×${r.imageUrls!.length}`)}
                    </span>
                  )}
                  <span className="item-meta">
                    {r.timestamp ? timeAgo(Date.parse(r.timestamp)) : ''}
                  </span>
                </div>
                <div className="item-snippet">{r.text}</div>
                <div className="item-meta">
                  {isMention
                    ? t('mentioned you — reply will post under their thread', '나를 멘션함 — 상대 글에 답글로 게시')
                    : `on: ${snippet(r.rootPostText, 90)}`}
                  {(r.imageUrls?.length ?? 0) > 0 &&
                    ` · ${t('includes image (local vision)', '이미지 포함 (로컬 비전)')}`}
                </div>
                <div className="item-meta">
                  {existing ? (
                    <>
                      <span className="badge">{existingLabel(existing)}</span>
                      <button className="link" onClick={() => goToDraft(existing)}>
                        {inDrafts(existing) ? text.viewDraft : text.viewQueue}
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn small"
                      disabled={busyId === r.id}
                      onClick={() => void generate(r)}
                    >
                      {busyId === r.id
                        ? text.generating
                        : isMention
                          ? t('Draft mention reply', '멘션 답글 초안')
                          : text.draftReply}
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
