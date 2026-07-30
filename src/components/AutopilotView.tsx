import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import { AUTOPILOT_CATEGORIES, AUTOPILOT_DEFAULT_CATEGORIES, AUTOPILOT_POPULAR_CATEGORY_IDS } from '../types'
import type { AppSettings, AutopilotSettings, PostLanguageMode } from '../types'
import { timeAgo } from '../util/format'

/**
 * Full-Auto ("autopilot") control room. Configure the agent's goal, niches,
 * persona, cadence, and safety caps, then Launch it to run autonomously.
 * All copy is bilingual EN/KO (falls back to EN for other UI languages).
 */
export default function AutopilotView() {
  const settings = useApp((s) => s.settings) as AppSettings
  const status = useApp((s) => s.autopilot)
  const saveSettings = useApp((s) => s.saveSettings)
  const setRunning = useApp((s) => s.setAutopilotRunning)
  const runNow = useApp((s) => s.runAutopilotNow)
  const setView = useApp((s) => s.setView)
  const toast = useApp((s) => s.toast)

  const ko = settings.language === 'ko'
  const t = (en: string, kr: string) => (ko ? kr : en)

  const withReplyDefaults = (ap: AutopilotSettings): AutopilotSettings => ({
    ...ap,
    replyIntervalMinutes:
      typeof ap.replyIntervalMinutes === 'number' && Number.isFinite(ap.replyIntervalMinutes)
        ? ap.replyIntervalMinutes
        : 5,
    replyToMentions: typeof ap.replyToMentions === 'boolean' ? ap.replyToMentions : true,
    sporadicPosts: typeof ap.sporadicPosts === 'boolean' ? ap.sporadicPosts : true,
    liveNewsInteractive:
      typeof ap.liveNewsInteractive === 'boolean' ? ap.liveNewsInteractive : true,
    engageDiscover: typeof ap.engageDiscover === 'boolean' ? ap.engageDiscover : false,
    maxDiscoverRepliesPerRun:
      typeof ap.maxDiscoverRepliesPerRun === 'number' && Number.isFinite(ap.maxDiscoverRepliesPerRun)
        ? ap.maxDiscoverRepliesPerRun
        : 2,
    maxDiscoverRepliesPerDay:
      typeof ap.maxDiscoverRepliesPerDay === 'number' && Number.isFinite(ap.maxDiscoverRepliesPerDay)
        ? ap.maxDiscoverRepliesPerDay
        : 20,
    recentPostMemory:
      typeof ap.recentPostMemory === 'number' && Number.isFinite(ap.recentPostMemory)
        ? ap.recentPostMemory
        : 5,
    sideMission: typeof ap.sideMission === 'string' ? ap.sideMission : '',
  })

  const [form, setForm] = useState<AutopilotSettings>(() => withReplyDefaults(settings.autopilot))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [customCat, setCustomCat] = useState('')
  const [topicInputFocused, setTopicInputFocused] = useState(false)
  const [now, setNow] = useState(Date.now())

  // Follow external config changes only while the form has no local edits.
  useEffect(() => {
    if (!dirty) setForm(withReplyDefaults(settings.autopilot))
  }, [settings.autopilot, dirty])

  // Live clock for the "next run" countdown.
  const timerRef = useRef<number | null>(null)
  useEffect(() => {
    timerRef.current = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  const running = status?.running ?? false
  const busy = status?.busy ?? false

  const edit = (patch: Partial<AutopilotSettings>) => {
    setForm((f) => ({ ...f, ...patch }))
    setDirty(true)
  }

  const num = (v: number, min: number, max: number, fallback: number) => {
    if (!Number.isFinite(v)) return fallback
    return Math.min(max, Math.max(min, Math.round(v)))
  }

  // Persist config, keeping the run-state under the exclusive control of the
  // Launch/Stop button (never toggled by a config save).
  const persist = async (): Promise<boolean> => {
    setSaving(true)
    const enabled = status?.running ?? form.enabled
    const ok = await saveSettings({ ...settings, autopilot: { ...form, enabled } })
    setSaving(false)
    if (ok) setDirty(false)
    return ok
  }

  const save = async () => {
    if (await persist()) toast('ok', t('Autopilot settings saved', '자동 설정을 저장했습니다'))
  }

  const launch = async () => {
    setLaunching(true)
    try {
      if (dirty && !(await persist())) return
      await setRunning(true)
      toast('ok', t('Full-Auto launched', '완전 자동을 시작했습니다'))
    } finally {
      setLaunching(false)
    }
  }

  const stop = async () => {
    setLaunching(true)
    try {
      await setRunning(false)
      toast('ok', t('Full-Auto stopped', '완전 자동을 중지했습니다'))
    } finally {
      setLaunching(false)
    }
  }

  const runOnce = async () => {
    if (dirty && !(await persist())) return
    toast('ok', t('Running one pass now…', '지금 한 번 실행합니다…'))
    await runNow()
  }

  const removeCategory = (id: string) =>
    edit({ categories: form.categories.filter((c) => c !== id) })

  const addCategory = (id: string) => {
    const key = id.trim().toLowerCase()
    if (!key) return
    if (!form.categories.includes(key)) edit({ categories: [...form.categories, key] })
  }

  const toggleCategory = (id: string) => {
    if (form.categories.includes(id)) removeCategory(id)
    else addCategory(id)
  }

  const selectPopular = () => edit({ categories: [...AUTOPILOT_DEFAULT_CATEGORIES] })
  const selectAllPopular = () => edit({ categories: [...AUTOPILOT_POPULAR_CATEGORY_IDS] })
  const clearCategories = () => edit({ categories: [] })

  /** Resolve typed text to a catalog id (en/ko label or raw id) or a custom slug. */
  const resolveCatalogId = (raw: string): string | null => {
    const q = raw.trim()
    if (!q) return null
    const lower = q.toLowerCase()
    const byId = AUTOPILOT_CATEGORIES.find((c) => c.id === lower)
    if (byId) return byId.id
    const byLabel = AUTOPILOT_CATEGORIES.find(
      (c) => c.en.toLowerCase() === lower || c.ko.toLowerCase() === lower
    )
    if (byLabel) return byLabel.id
    // fuzzy: starts-with match for autocomplete commit
    const starts = AUTOPILOT_CATEGORIES.filter(
      (c) =>
        c.id.startsWith(lower) ||
        c.en.toLowerCase().startsWith(lower) ||
        c.ko.startsWith(q)
    )
    if (starts.length === 1) return starts[0].id
    return lower.replace(/\s+/g, ' ')
  }

  const addFromInput = () => {
    const id = resolveCatalogId(customCat)
    if (!id) return
    addCategory(id)
    setCustomCat('')
  }

  const labelForCategory = (id: string): string => {
    const cat = AUTOPILOT_CATEGORIES.find((c) => c.id === id)
    if (!cat) return id
    return ko ? cat.ko : cat.en
  }

  const popularCats = AUTOPILOT_CATEGORIES.filter((c) => c.popular)
  const moreCats = AUTOPILOT_CATEGORIES.filter((c) => !c.popular)
  const selectedSet = new Set(form.categories)
  // Autocomplete suggestions: popular first, then rest, only not-yet-selected, filter by query
  const query = customCat.trim().toLowerCase()
  const autocompletePool = [
    ...popularCats,
    ...moreCats,
  ].filter((c) => {
    if (selectedSet.has(c.id)) return false
    if (!query) return c.popular // empty field: show popular handles only
    return (
      c.id.includes(query) ||
      c.en.toLowerCase().includes(query) ||
      c.ko.includes(customCat.trim())
    )
  })

  const formatCountdown = (at: number | null | undefined): string => {
    if (!running) return t('Paused', '일시정지')
    if (!at) return '—'
    const ms = at - now
    if (ms <= 0) return t('Any moment…', '곧 실행')
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  const nextPostLabel = (): string => {
    if (busy) return t('Working…', '작동 중…')
    return formatCountdown(status?.nextRunAt)
  }

  const nextReplyLabel = (): string => {
    if (!form.replyToAll && !form.replyToMentions) return t('Off', '끔')
    if (busy) return t('Working…', '작동 중…')
    return formatCountdown(status?.nextReplyRunAt)
  }

  const langOptions: { id: PostLanguageMode; label: string }[] = [
    { id: 'match', label: t('Match source', '원문 언어') },
    { id: 'ko', label: t('Korean', '한국어') },
    { id: 'en', label: t('English', '영어') },
    { id: 'ui', label: t('App language', '앱 언어') },
  ]

  const logKindLabel = (k: string): string =>
    k === 'post'
      ? t('POST', '게시')
      : k === 'reply'
        ? t('REPLY', '답글')
        : k === 'skip'
          ? t('SKIP', '건너뜀')
          : k === 'error'
            ? t('ERROR', '오류')
            : t('INFO', '정보')

  return (
    <div className="view">
      <div className="view-header">
        <span className="view-title">{t('Full-Auto', '완전 자동')}</span>
        <span className="view-sub">
          {t(
            'The agent decides and acts on its own — posting and replying without you.',
            '에이전트가 스스로 판단하고 게시·답글을 자동으로 수행합니다.',
          )}
        </span>
        <div className="view-actions">
          <button className="btn ghost" disabled={saving || launching} onClick={() => void save()}>
            {saving ? t('Saving…', '저장 중…') : t('Save', '저장')}
          </button>
          <button className="btn" disabled={launching || busy} onClick={() => void runOnce()}>
            {t('Run once now', '지금 한 번 실행')}
          </button>
          {running ? (
            <button className="btn danger" disabled={launching} onClick={() => void stop()}>
              {launching ? '…' : t('Stop', '중지')}
            </button>
          ) : (
            <button className="btn primary" disabled={launching} onClick={() => void launch()}>
              {launching ? t('Launching…', '시작 중…') : t('Launch Full-Auto', '완전 자동 시작')}
            </button>
          )}
        </div>
      </div>

      <div className="view-body">
        <div className="settings-wrap">
          {/* live status */}
          <div className={`ap-status ${running ? 'live' : ''}`}>
            <div className="ap-stat">
              <span className="ap-stat-k">{t('Status', '상태')}</span>
              <span className="ap-stat-v">
                {running ? (
                  <>
                    <span className="side-live inline" /> {busy ? t('Working', '작동 중') : t('Running', '실행 중')}
                  </>
                ) : (
                  t('Paused', '일시정지')
                )}
              </span>
            </div>
            <div className="ap-stat">
              <span className="ap-stat-k">{t('Posts today', '오늘 게시')}</span>
              <span className="ap-stat-v">
                {status?.postsToday ?? 0} / {status?.maxPostsPerDay ?? form.maxPostsPerDay}
              </span>
            </div>
            <div className="ap-stat">
              <span className="ap-stat-k">{t('Replies today', '오늘 답글')}</span>
              <span className="ap-stat-v">
                {status?.repliesToday ?? 0} / {status?.maxRepliesPerDay ?? form.maxRepliesPerDay}
              </span>
            </div>
            <div className="ap-stat ap-stat-wide">
              <span className="ap-stat-k">{t('Post timer', '게시 타이머')}</span>
              <span className="ap-stat-v">{nextPostLabel()}</span>
              <span className="ap-stat-sub">
                {t('every', '매')} {status?.intervalMinutes ?? form.intervalMinutes}
                {t(' min', '분')}
              </span>
            </div>
            <div className="ap-stat ap-stat-wide">
              <span className="ap-stat-k">{t('Reply / mention timer', '답글·멘션 타이머')}</span>
              <span className="ap-stat-v">{nextReplyLabel()}</span>
              <span className="ap-stat-sub">
                {t('every', '매')} {status?.replyIntervalMinutes ?? form.replyIntervalMinutes}
                {t(' min', '분')} · {t('failures retry in 1 min', '실패 시 1분 후 재시도')}
              </span>
            </div>
            <div className="ap-stat">
              <span className="ap-stat-k">{t('Mode', '모드')}</span>
              <span className="ap-stat-v">
                {form.goLive ? t('Live', '실시간 게시') : t('Draft only', '초안만')}
              </span>
            </div>
          </div>

          {(status && (!status.llmReady || !status.threadsReady)) && (
            <div className="ap-warn">
              {!status.llmReady && <div>{t('AI provider is not configured.', 'AI 제공자가 설정되지 않았습니다.')}</div>}
              {!status.threadsReady && <div>{t('Threads access token is missing.', 'Threads 액세스 토큰이 없습니다.')}</div>}
              <button className="btn small" onClick={() => setView('settings')}>
                {t('Open Settings', '설정 열기')}
              </button>
            </div>
          )}

          {/* goal + side mission */}
          <div className="section">
            <div className="section-title">{t('Goal', '목표')}</div>
            <div className="section-desc">
              {t(
                'Primary objective — drives planning, posts, and replies.',
                '주 목표입니다. 계획·게시·답글 판단의 기준이 됩니다.'
              )}
            </div>
            <textarea
              className="textarea"
              value={form.goal}
              onChange={(e) => edit({ goal: e.target.value })}
              placeholder={t(
                'e.g. Grow an engaged following with relatable, funny takes.',
                '예: 공감되고 재미있는 글로 팔로워와 참여를 늘리기'
              )}
            />
            <div className="field" style={{ marginTop: 14 }}>
              <span className="field-label">{t('Side mission (optional)', '사이드 미션 (선택)')}</span>
              <div className="section-desc" style={{ marginBottom: 6 }}>
                {t(
                  'Temporary secondary objective — e.g. soft-promote an app or campaign. Leave empty to turn off. The agent weaves it in lightly when natural (not every post), never hard-sells.',
                  '임시 부목표 — 예: 앱/캠페인 자연스럽게 알리기. 비우면 끔. 자연스러울 때만 가볍게 녹여 넣고(매 글 강제 아님), 노골적 광고는 하지 않습니다.'
                )}
              </div>
              <textarea
                className="textarea"
                value={form.sideMission ?? ''}
                onChange={(e) => edit({ sideMission: e.target.value })}
                placeholder={t(
                  'e.g. Soft-promote QuantFox (my quant/trading app) when it fits AI/finance chat — mention the name once, no hard sell, link only if natural.',
                  '예: AI·금융 대화에 어울릴 때 QuantFox(내 퀀트/트레이딩 앱)를 자연스럽게 한 번 언급. 강매 금지, 링크는 자연스러울 때만.'
                )}
              />
            </div>
          </div>

          {/* categories */}
          <div className="section">
            <div className="section-title">{t('Topics / niches', '주제 / 분야')}</div>
            <div className="section-desc">
              {t(
                'Selected niches drive news scrapes and post voice. Remove any pill with × — re-add from suggestions or type to search popular topics.',
                '선택한 분야가 뉴스 수집과 글 톤을 결정합니다. 알약의 ×로 제거한 뒤, 추천에서 다시 고르거나 인기 주제를 검색해 추가하세요.'
              )}
            </div>
            <div className="row" style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={selectPopular} type="button">
                {t('Use popular defaults (AI-first)', '인기 기본값 (AI 우선)')}
              </button>
              <button className="btn" onClick={selectAllPopular} type="button">
                {t('Select all popular', '인기 분야 전체 선택')}
              </button>
              <button
                className="btn ghost"
                onClick={clearCategories}
                type="button"
                disabled={form.categories.length === 0}
              >
                {t('Clear all', '모두 지우기')}
              </button>
            </div>

            <div className="ap-cat-group-label">{t('Selected', '선택됨')}</div>
            <div className="row ap-chips ap-selected-chips">
              {form.categories.length === 0 && (
                <span className="hint">
                  {t(
                    'No niches selected. Add popular ones below or type a custom topic.',
                    '선택된 분야가 없습니다. 아래에서 인기 주제를 추가하거나 직접 입력하세요.'
                  )}
                </span>
              )}
              {form.categories.map((id) => {
                const isPopular = AUTOPILOT_CATEGORIES.some((c) => c.id === id && c.popular)
                const isCatalog = AUTOPILOT_CATEGORIES.some((c) => c.id === id)
                return (
                  <span
                    key={id}
                    className={`chip on removable${isPopular ? ' popular' : ''}${!isCatalog ? ' custom' : ''}`}
                  >
                    <span className="chip-label">{labelForCategory(id)}</span>
                    <button
                      type="button"
                      className="chip-x"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeCategory(id)
                      }}
                      aria-label={t(`Remove ${labelForCategory(id)}`, `${labelForCategory(id)} 제거`)}
                      title={t('Remove', '제거')}
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>

            <div className="ap-cat-group-label" style={{ marginTop: 14 }}>
              {t('Add popular topics', '인기 주제 추가')}
            </div>
            <div className="row ap-chips">
              {popularCats
                .filter((c) => !selectedSet.has(c.id))
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="chip selectable popular"
                    onClick={() => addCategory(c.id)}
                    title={t('Click to add', '클릭하여 추가')}
                  >
                    + {ko ? c.ko : c.en}
                  </button>
                ))}
              {popularCats.every((c) => selectedSet.has(c.id)) && (
                <span className="hint">{t('All popular niches are selected.', '인기 분야가 모두 선택되었습니다.')}</span>
              )}
            </div>

            <div className="ap-cat-group-label" style={{ marginTop: 12 }}>
              {t('More niches', '기타 분야')}
            </div>
            <div className="row ap-chips">
              {moreCats
                .filter((c) => !selectedSet.has(c.id))
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="chip selectable"
                    onClick={() => addCategory(c.id)}
                    title={t('Click to add', '클릭하여 추가')}
                  >
                    + {ko ? c.ko : c.en}
                  </button>
                ))}
            </div>

            <div className="ap-cat-group-label" style={{ marginTop: 12 }}>
              {t('Search or custom topic', '검색 · 직접 입력')}
            </div>
            <div className="ap-autocomplete">
              <div className="row">
                <input
                  className="input grow"
                  list="ap-topic-suggestions"
                  placeholder={t(
                    'Type to search popular topics or add custom…',
                    '인기 주제 검색 또는 직접 추가…'
                  )}
                  value={customCat}
                  onChange={(e) => setCustomCat(e.target.value)}
                  onFocus={() => setTopicInputFocused(true)}
                  onBlur={() => {
                    // delay so click on a suggestion still registers
                    window.setTimeout(() => setTopicInputFocused(false), 150)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addFromInput()
                    }
                    if (e.key === 'Escape') {
                      setCustomCat('')
                      ;(e.target as HTMLInputElement).blur()
                    }
                  }}
                  autoComplete="off"
                />
                <datalist id="ap-topic-suggestions">
                  {AUTOPILOT_CATEGORIES.filter((c) => !selectedSet.has(c.id)).map((c) => (
                    <option key={c.id} value={ko ? c.ko : c.en} />
                  ))}
                </datalist>
                <button className="btn" type="button" onClick={addFromInput} disabled={!customCat.trim()}>
                  {t('Add', '추가')}
                </button>
              </div>
              {/* Autopopulate: focus empty field → popular handles; typing filters full catalog */}
              {topicInputFocused && autocompletePool.length > 0 && (
                <div className="ap-suggest-list" role="listbox">
                  {autocompletePool.slice(0, query ? 8 : 10).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`ap-suggest-item${c.popular ? ' popular' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        addCategory(c.id)
                        setCustomCat('')
                      }}
                    >
                      <span>{ko ? c.ko : c.en}</span>
                      {c.popular && (
                        <span className="ap-suggest-badge">{t('popular', '인기')}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* language */}
          <div className="section">
            <div className="section-title">{t('Post language', '게시 언어')}</div>
            <div className="section-desc">
              {t('What language the agent writes posts and replies in.', '게시물과 답글을 작성할 언어입니다.')}
            </div>
            <div className="seg">
              {langOptions.map((o) => (
                <button
                  key={o.id}
                  className={form.postLanguage === o.id ? 'on' : ''}
                  onClick={() => edit({ postLanguage: o.id })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* persona */}
          <div className="section">
            <div className="section-title">{t('Personality', '페르소나')}</div>
            <div className="section-desc">
              {t('Who the agent is, who made it, and how it treats its creator.', '에이전트의 정체성, 제작자, 제작자를 대하는 방식입니다.')}
            </div>
            <div className="row">
              <div className="field grow">
                <span className="field-label">{t('Agent name', '에이전트 이름')}</span>
                <input
                  className="input"
                  value={form.agentName}
                  onChange={(e) => edit({ agentName: e.target.value })}
                  placeholder={t('optional persona name', '선택: 페르소나 이름')}
                />
              </div>
              <div className="field grow">
                <span className="field-label">{t('Created by', '제작자')}</span>
                <input
                  className="input"
                  value={form.creatorName}
                  onChange={(e) => edit({ creatorName: e.target.value })}
                  placeholder={t('your name / brand', '이름 / 브랜드')}
                />
              </div>
            </div>
            <div className="row">
              <div className="field grow">
                <span className="field-label">{t('Creator @handle', '제작자 @핸들')}</span>
                <input
                  className="input mono"
                  value={form.creatorHandle}
                  onChange={(e) => edit({ creatorHandle: e.target.value })}
                  placeholder="masteruser"
                />
                <span className="hint">
                  {t('Replies from this handle get special treatment.', '이 핸들의 답글은 특별하게 응대합니다.')}
                </span>
              </div>
              <div className="field grow">
                <span className="field-label">{t('Address creator as', '제작자 호칭')}</span>
                <input
                  className="input"
                  value={form.creatorAddress}
                  onChange={(e) => edit({ creatorAddress: e.target.value })}
                  placeholder="Master"
                />
              </div>
            </div>
            <div className="field">
              <span className="field-label">{t('Tone notes', '톤 메모')}</span>
              <textarea
                className="textarea"
                value={form.toneNotes}
                onChange={(e) => edit({ toneNotes: e.target.value })}
                placeholder={t('extra personality guidance (optional)', '추가 성격 가이드 (선택)')}
              />
            </div>
          </div>

          {/* cadence & caps */}
          <div className="section">
            <div className="section-title">{t('Cadence & limits', '주기 & 한도')}</div>
            <div className="section-desc">
              {t(
                'Post planning and reply/mention checks run on separate timers so replies can be faster without posting more often. The activity log often shows only reply ticks (every few min); post ticks run on the longer post timer — that is not a skip.',
                '게시 판단과 답글·멘션 확인은 서로 다른 주기로 동작합니다. 활동 로그에 답글 틱만 자주 보이는 것은 정상입니다(답글 주기가 더 짧음). 게시 틱은 게시 주기에 맞춰 돌며, 그게 건너뛰기가 아닙니다.'
              )}
            </div>
            <div className="row">
              <div className="field grow">
                <span className="field-label">{t('Post / think every (min)', '게시 판단 주기(분)')}</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={form.intervalMinutes}
                  onChange={(e) => edit({ intervalMinutes: e.target.valueAsNumber })}
                  onBlur={() => edit({ intervalMinutes: num(form.intervalMinutes, 1, 1440, 60) })}
                />
                <span className="hint">{t('Plans and creates posts.', '게시물을 계획·작성합니다.')}</span>
              </div>
              <div className="field grow">
                <span className="field-label">{t('Max posts / run', '실행당 최대 게시')}</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10}
                  value={form.maxPostsPerRun}
                  onChange={(e) => edit({ maxPostsPerRun: e.target.valueAsNumber })}
                  onBlur={() => edit({ maxPostsPerRun: num(form.maxPostsPerRun, 1, 10, 1) })}
                />
              </div>
              <div className="field grow">
                <span className="field-label">{t('Recent posts memory', '최근 게시 기억')}</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={20}
                  value={form.recentPostMemory}
                  onChange={(e) => edit({ recentPostMemory: e.target.valueAsNumber })}
                  onBlur={() => edit({ recentPostMemory: num(form.recentPostMemory, 1, 20, 5) })}
                />
                <span className="hint">
                  {t(
                    'How many past posts to load for anti-repeat (scraped + drafts). Lower uses fewer LLM tokens. Default 5.',
                    '반복 방지용으로 불러올 최근 게시 수(스크랩+초안). 낮을수록 LLM 토큰 절약. 기본 5.'
                  )}
                </span>
              </div>
              <div className="field grow">
                <span className="field-label">{t('Max posts / day', '하루 최대 게시')}</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={96}
                  value={form.maxPostsPerDay}
                  onChange={(e) => edit({ maxPostsPerDay: e.target.valueAsNumber })}
                  onBlur={() => edit({ maxPostsPerDay: num(form.maxPostsPerDay, 1, 96, 6) })}
                />
              </div>
            </div>
            <div className="field">
              <span className="field-label">
                {t('Original vs news', '오리지널 vs 뉴스')}: {form.originalRatio}% {t('original', '오리지널')}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={form.originalRatio}
                onChange={(e) => edit({ originalRatio: e.target.valueAsNumber })}
              />
              <span className="hint">
                {t(
                  'Higher = more funny/human original posts; lower = more news reactions.',
                  '높을수록 재미있는 오리지널 글, 낮을수록 뉴스 반응 위주.',
                )}
              </span>
            </div>
            <div className="field">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.sporadicPosts}
                  onChange={(e) => edit({ sporadicPosts: e.target.checked })}
                />
                <span>{t('Post here and there (sporadic)', '여기저기 게시 (불규칙)')}</span>
              </label>
              <span className="hint">
                {t(
                  'When on, lightly skips ~18% of scheduled post ticks (never two in a row; Run once always posts).',
                  '켜면 예약 게시 틱의 약 18%만 건너뜁니다 (연속 스킵 없음; 한 번 실행은 항상 게시).',
                )}
              </span>
            </div>
            <div className="field">
              <label
                className="toggle"
                title={t(
                  'Primary posts react to CURRENT scraped news (not recycled LLM riffs). Sometimes she shares feelings from the last 3 posts + replies and talks to followers about earlier remarks — more interactive, less repetitive.',
                  '기본 게시는 최신 스크랩 뉴스 반응입니다(반복 LLM 혼잣말 아님). 가끔 최근 3개 글·답글을 바탕으로 감정을 나누고, 이전 발언을 팔로워에게 언급해 더 상호작용합니다.'
                )}
              >
                <input
                  type="checkbox"
                  checked={form.liveNewsInteractive}
                  onChange={(e) => edit({ liveNewsInteractive: e.target.checked })}
                />
                <span>
                  {t('Live news + interactive voice', '실시간 뉴스 + 상호작용 보이스')}
                  <span
                    className="hint-tip"
                    title={t(
                      'Primary posts react to CURRENT scraped news (not recycled LLM riffs). Sometimes she shares feelings from the last 3 posts + replies and talks to followers about earlier remarks — more interactive, less repetitive.',
                      '기본 게시는 최신 스크랩 뉴스 반응입니다(반복 LLM 혼잣말 아님). 가끔 최근 3개 글·답글을 바탕으로 감정을 나누고, 이전 발언을 팔로워에게 언급해 더 상호작용합니다.'
                    )}
                  >
                    {' '}
                    (?)
                  </span>
                </span>
              </label>
              <span className="hint">
                {t(
                  'News-first feed · occasional “how I feel” posts · callbacks to followers about prior takes. Hover (?) for details.',
                  '뉴스 우선 · 가끔 감정 글 · 이전 발언을 팔로워에게 다시 언급. (?)에 마우스를 올려 자세히 보세요.'
                )}
              </span>
            </div>
          </div>

          {/* replies + mentions */}
          <div className="section">
            <div className="section-title">{t('Replies & mentions', '답글 · 멘션')}</div>
            <div className="section-desc">
              {t(
                'Answer unanswered replies on your posts and/or @mentions of your account. Mentions need threads_manage_mentions on the access token (regenerate the token after enabling the permission in Meta).',
                '내 게시물 미답변 답글과 @멘션에 응대합니다. 멘션은 토큰에 threads_manage_mentions가 필요합니다 (Meta에서 권한 켠 뒤 토큰을 다시 발급하세요).'
              )}
            </div>
            <div className="hint" style={{ marginBottom: 10 }}>
              {t(
                'Long threads: each post is hard-capped at 20 unanswered replies (newest first). Older ones are skipped so Full-Auto never chases viral comment storms forever.',
                '긴 스레드: 게시물당 미답변 답글은 최대 20개(최신 우선)로 고정 제한됩니다. 그 이전 답글은 건너뛰어 바이럴 댓글 폭주를 끝없이 따라가지 않습니다.'
              )}
            </div>
            <div className="hint" style={{ marginBottom: 10 }}>
              {t(
                '@Mentions: without Meta Advanced Access for threads_manage_mentions, the API only returns mentions from app Testers — everyone else appears as 0. Activity log shows Mentions API raw counts.',
                '@멘션: Meta Advanced Access(threads_manage_mentions)가 없으면 앱 테스터의 멘션만 API에 보입니다. 그 외는 0건. 활동 로그에 멘션 API 원본 건수가 표시됩니다.'
              )}
            </div>
            <div className="field">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.replyToAll}
                  onChange={(e) => edit({ replyToAll: e.target.checked })}
                />
                <span>{t('Reply to replies on my posts', '내 게시물 답글에 응대')}</span>
              </label>
            </div>
            <div className="field">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.replyToMentions}
                  onChange={(e) => edit({ replyToMentions: e.target.checked })}
                />
                <span>{t('Reply to @mentions of me', '나를 @멘션한 글에 응대')}</span>
              </label>
            </div>
            <div className="field">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.engageDiscover}
                  onChange={(e) => edit({ engageDiscover: e.target.checked })}
                />
                <span>{t('Reply to random public posts in my niches', '내 분야의 공개 글에 랜덤 답글')}</span>
              </label>
              <span className="hint">
                {t(
                  'Uses keyword search on your niches. Needs threads_keyword_search (public results need advanced access / app review). Cap discover replies below.',
                  '주제 키워드 검색으로 공개 글에 답합니다. threads_keyword_search 필요 (공개 검색은 고급 액세스/앱 리뷰). 아래 한도를 설정하세요.',
                )}
              </span>
            </div>
            {form.engageDiscover && (
              <div className="row">
                <div className="field grow">
                  <span className="field-label">{t('Discover max / run', '발견 답글 실행당')}</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={10}
                    value={form.maxDiscoverRepliesPerRun}
                    onChange={(e) => edit({ maxDiscoverRepliesPerRun: e.target.valueAsNumber })}
                    onBlur={() =>
                      edit({ maxDiscoverRepliesPerRun: num(form.maxDiscoverRepliesPerRun, 0, 10, 2) })
                    }
                  />
                </div>
                <div className="field grow">
                  <span className="field-label">{t('Discover max / day', '발견 답글 하루')}</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    value={form.maxDiscoverRepliesPerDay}
                    onChange={(e) => edit({ maxDiscoverRepliesPerDay: e.target.valueAsNumber })}
                    onBlur={() =>
                      edit({ maxDiscoverRepliesPerDay: num(form.maxDiscoverRepliesPerDay, 0, 100, 20) })
                    }
                  />
                </div>
              </div>
            )}
            {(form.replyToAll || form.replyToMentions) && (
              <>
                <div className="field">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={form.autoReply}
                      onChange={(e) => edit({ autoReply: e.target.checked })}
                    />
                    <span>{t('Publish replies automatically (off = draft them)', '답글 자동 게시 (끄면 초안으로)')}</span>
                  </label>
                </div>
                <div className="row">
                  <div className="field grow">
                    <span className="field-label">{t('Check replies every (min)', '답글 확인 주기(분)')}</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={form.replyIntervalMinutes}
                      onChange={(e) => edit({ replyIntervalMinutes: e.target.valueAsNumber })}
                      onBlur={() =>
                        edit({ replyIntervalMinutes: num(form.replyIntervalMinutes, 1, 1440, 5) })
                      }
                    />
                    <span className="hint">
                      {t(
                        'Separate from post timer. Default 5 min so replies/mentions are answered faster.',
                        '게시 주기와 별개입니다. 기본 5분 — 답글·멘션을 더 빠르게 응대합니다.'
                      )}
                    </span>
                  </div>
                  <div className="field grow">
                    <span className="field-label">{t('Max replies / run', '실행당 최대 답글')}</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={20}
                      value={form.maxRepliesPerRun}
                      onChange={(e) => edit({ maxRepliesPerRun: e.target.valueAsNumber })}
                      onBlur={() => edit({ maxRepliesPerRun: num(form.maxRepliesPerRun, 1, 20, 5) })}
                    />
                    <span className="hint">
                      {t(
                        'Per Full-Auto tick (max 20). Separate from the per-post long-thread cap of 20.',
                        '실행 1회 한도(최대 20). 게시물당 긴 스레드 한도 20과는 별개입니다.'
                      )}
                    </span>
                  </div>
                  <div className="field grow">
                    <span className="field-label">{t('Max replies / day', '하루 최대 답글')}</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={300}
                      value={form.maxRepliesPerDay}
                      onChange={(e) => edit({ maxRepliesPerDay: e.target.valueAsNumber })}
                      onBlur={() => edit({ maxRepliesPerDay: num(form.maxRepliesPerDay, 1, 300, 100) })}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* publishing safety */}
          <div className="section">
            <div className="section-title">{t('Publishing', '게시 방식')}</div>
            <div className="section-desc">
              {t('Live posts go straight to your Threads account. Draft-only is a safety valve.', '실시간 게시는 Threads 계정에 바로 올라갑니다. 초안 모드는 안전장치입니다.')}
            </div>
            <div className="field">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.goLive}
                  onChange={(e) => edit({ goLive: e.target.checked })}
                />
                <span>{t('Publish live to Threads', 'Threads에 실시간 게시')}</span>
              </label>
              {!form.goLive && (
                <span className="hint">
                  {t('Off: the agent decides everything but only writes drafts for your review.', '끔: 에이전트가 모두 판단하되 검토용 초안만 작성합니다.')}
                </span>
              )}
            </div>
          </div>

          {/* activity log */}
          <div className="section">
            <div className="section-title">{t('Activity', '활동 로그')}</div>
            <div className="ap-log">
              {!status || status.log.length === 0 ? (
                <div className="hint">{t('No activity yet. Launch to begin.', '아직 활동이 없습니다. 시작해 보세요.')}</div>
              ) : (
                status.log.map((e) => (
                  <div key={e.id} className={`ap-log-row ${e.kind}`}>
                    <span className={`ap-log-kind ${e.kind}`}>{logKindLabel(e.kind)}</span>
                    <span className="ap-log-msg">{e.message}</span>
                    {e.permalink && (
                      <button className="link" onClick={() => void window.api.openExternal(e.permalink!)}>
                        {t('open', '열기')}
                      </button>
                    )}
                    <span className="ap-log-time">{timeAgo(e.at, settings.language)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
