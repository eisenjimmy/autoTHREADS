import { useEffect, useState } from 'react'
import { useApp } from '../store/appStore'
import ThreadsTokenHelp from './ThreadsTokenHelp'
import type {
  AppSettings,
  AutoDraftSettings,
  CustomNewsSource,
  LanguageCode,
  LlmProviderKind,
  LlmSettings,
  NewsSourceSettings,
  TestResult,
  ThemeMode,
  ThreadsSettings,
  ViewId,
} from '../types'
import { snippet } from '../util/format'

const LANGUAGES: { id: LanguageCode; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'ko', label: '한국어' },
  { id: 'zh', label: '中文' },
  { id: 'ja', label: '日本語' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'pt', label: 'Português' },
]

const PROVIDERS: { id: LlmProviderKind; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'openai', label: 'ChatGPT' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'local', label: 'Local LLM' },
  { id: 'other', label: 'Other' },
]

export default function SettingsView() {
  // settings is loaded before any view renders, so the non-null cast is safe here
  const stored = useApp((s) => s.settings) as AppSettings
  const saveSettings = useApp((s) => s.saveSettings)
  const setView = useApp((s) => s.setView)
  const setShowOnboarding = useApp((s) => s.setShowOnboarding)
  const toast = useApp((s) => s.toast)

  const [form, setForm] = useState<AppSettings>(stored)
  const ko = form.language === 'ko'
  const t = (en: string, kr: string) => (ko ? kr : en)
  const themes: { id: ThemeMode; label: string }[] = [
    { id: 'light', label: t('Light', '라이트') },
    { id: 'dark', label: t('Dark', '다크') },
  ]
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [threadsResult, setThreadsResult] = useState<TestResult | null>(null)
  const [llmResult, setLlmResult] = useState<TestResult | null>(null)
  const [testingThreads, setTestingThreads] = useState(false)
  const [connectingThreads, setConnectingThreads] = useState(false)
  const [testingLlm, setTestingLlm] = useState(false)
  const [importing, setImporting] = useState(false)
  const [pendingView, setPendingView] = useState<ViewId | null>(null)
  const [showTokenHelp, setShowTokenHelp] = useState(false)
  const [topicInput, setTopicInput] = useState('')
  const [customSourceName, setCustomSourceName] = useState('')
  const [customSourceUrl, setCustomSourceUrl] = useState('')
  const [sampleInput, setSampleInput] = useState('')

  // follow external settings changes only while the form has no local edits
  useEffect(() => {
    if (!dirty) setForm(stored)
  }, [stored, dirty])

  const edit = (fn: (f: AppSettings) => AppSettings) => {
    setForm(fn)
    setDirty(true)
  }

  const setThreads = (patch: Partial<ThreadsSettings>) => {
    setThreadsResult(null)
    edit((f) => ({ ...f, threads: { ...f.threads, ...patch } }))
  }

  const setLlm = (fn: (l: LlmSettings) => LlmSettings) => {
    setLlmResult(null)
    edit((f) => ({ ...f, llm: fn(f.llm) }))
  }

  const setAuto = (patch: Partial<AutoDraftSettings>) =>
    edit((f) => ({ ...f, autoDraft: { ...f.autoDraft, ...patch } }))

  const setNewsSources = (fn: (sources: NewsSourceSettings) => NewsSourceSettings) =>
    edit((f) => ({ ...f, newsSources: fn(f.newsSources) }))

  useEffect(() => {
    if (!dirty) return
    const onClickCapture = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const button = target.closest<HTMLElement>('[data-view]')
      const nextView = button?.dataset.view as ViewId | undefined
      if (!nextView || nextView === 'settings') return
      event.preventDefault()
      event.stopPropagation()
      setPendingView(nextView)
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    document.addEventListener('click', onClickCapture, true)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [dirty])

  // Theme applies immediately (like the sidebar toggle) rather than staging in the
  // dirty form, so a Save of other fields can never revert a theme set elsewhere.
  const applyThemeNow = (theme: ThemeMode) => {
    setForm((f) => ({ ...f, theme }))
    const latest = useApp.getState().settings
    if (latest) void saveSettings({ ...latest, theme })
  }

  const persistForm = async (): Promise<boolean> => {
    setSaving(true)
    // Keep whatever theme is current in the store; theme is not part of this form's diff.
    const latest = useApp.getState().settings
    const ok = await saveSettings({ ...form, theme: latest?.theme ?? form.theme })
    setSaving(false)
    return ok
  }

  const save = async () => {
    const ok = await persistForm()
    if (ok) {
      setDirty(false)
      toast('ok', t('Settings saved', '설정을 저장했습니다'))
    }
  }

  const saveAndLeave = async () => {
    if (!pendingView) return
    const ok = await persistForm()
    if (!ok) return
    const next = pendingView
    setPendingView(null)
    setDirty(false)
    toast('ok', t('Settings saved', '설정을 저장했습니다'))
    setView(next)
  }

  const discardAndLeave = () => {
    if (!pendingView) return
    const next = pendingView
    setForm(stored)
    setDirty(false)
    setPendingView(null)
    setView(next)
  }

  const testThreads = async () => {
    setTestingThreads(true)
    setThreadsResult(null)
    try {
      const res = await window.api.threadsTest({
        accessToken: form.threads.accessToken,
        userId: form.threads.userId,
      })
      setThreadsResult({ ok: res.ok, message: res.message })
      if (res.ok) {
        const username = res.username ?? form.threads.username
        const userId = res.userId ?? form.threads.userId
        if (username !== form.threads.username || userId !== form.threads.userId)
          edit((f) => ({ ...f, threads: { ...f.threads, username, userId } }))
      }
    } catch (err) {
      setThreadsResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
    setTestingThreads(false)
  }

  const connectThreadsOAuth = async () => {
    setConnectingThreads(true)
    setThreadsResult(null)
    try {
      const res = await window.api.threadsOAuthStart({
        appId: form.threads.appId,
        appSecret: form.threads.appSecret,
        redirectUri: form.threads.redirectUri,
        scopes: form.threads.scopes,
      })
      setThreadsResult({ ok: res.ok, message: res.message })
      if (res.ok && res.accessToken) {
        edit((f) => ({
          ...f,
          threads: {
            ...f.threads,
            accessToken: res.accessToken || f.threads.accessToken,
            userId: res.userId || f.threads.userId,
            username: res.username || f.threads.username,
            tokenExpiresAt: res.tokenExpiresAt ?? f.threads.tokenExpiresAt,
          },
        }))
      }
    } catch (err) {
      setThreadsResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
    setConnectingThreads(false)
  }

  const testLlm = async () => {
    setTestingLlm(true)
    setLlmResult(null)
    try {
      setLlmResult(await window.api.llmTest(form.llm))
    } catch (err) {
      setLlmResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
    setTestingLlm(false)
  }

  const importSamples = async () => {
    setImporting(true)
    try {
      const res = await window.api.threadsScrapeStyle(10)
      if (res.ok) {
        const fresh = res.samples.filter((s) => !form.style.samples.includes(s))
        if (fresh.length > 0)
          edit((f) => ({
            ...f,
            style: {
              ...f.style,
              samples: [...f.style.samples, ...fresh.filter((s) => !f.style.samples.includes(s))],
            },
          }))
        toast('ok', res.message)
      } else {
        toast('err', res.message)
      }
    } catch (err) {
      toast('err', err instanceof Error ? err.message : String(err))
    }
    setImporting(false)
  }

  const addTopic = () => {
    const t = topicInput.trim()
    if (!t) return
    if (!form.topics.some((x) => x.toLowerCase() === t.toLowerCase()))
      edit((f) => ({ ...f, topics: [...f.topics, t] }))
    setTopicInput('')
  }

  const removeTopic = (topic: string) =>
    edit((f) => ({ ...f, topics: f.topics.filter((t) => t !== topic) }))

  const toggleBuiltInSource = (key: 'google' | 'yahoo' | 'hackerNews' | 'naver', enabled: boolean) =>
    setNewsSources((sources) => ({ ...sources, [key]: enabled }))

  const addCustomSource = () => {
    const name = customSourceName.trim()
    const url = customSourceUrl.trim()
    if (!url) return
    const source: CustomNewsSource = {
      id: crypto.randomUUID(),
      name: name || 'Custom RSS',
      url,
      enabled: true,
    }
    setNewsSources((sources) => ({ ...sources, custom: [...sources.custom, source] }))
    setCustomSourceName('')
    setCustomSourceUrl('')
  }

  const updateCustomSource = (id: string, patch: Partial<CustomNewsSource>) =>
    setNewsSources((sources) => ({
      ...sources,
      custom: sources.custom.map((source) => (source.id === id ? { ...source, ...patch } : source)),
    }))

  const removeCustomSource = (id: string) =>
    setNewsSources((sources) => ({
      ...sources,
      custom: sources.custom.filter((source) => source.id !== id),
    }))

  const addSample = () => {
    const s = sampleInput.trim()
    if (!s || form.style.samples.includes(s)) return
    edit((f) => ({ ...f, style: { ...f.style, samples: [...f.style.samples, s] } }))
    setSampleInput('')
  }

  const removeSample = (idx: number) =>
    edit((f) => ({ ...f, style: { ...f.style, samples: f.style.samples.filter((_, i) => i !== idx) } }))

  const clampAuto = () => {
    const intervalMinutes = Math.max(15, Math.round(form.autoDraft.intervalMinutes) || 15)
    const maxPerRun = Math.min(10, Math.max(1, Math.round(form.autoDraft.maxPerRun) || 1))
    if (intervalMinutes !== form.autoDraft.intervalMinutes || maxPerRun !== form.autoDraft.maxPerRun)
      setAuto({ intervalMinutes, maxPerRun })
  }

  return (
    <>
    <div className="view">
      <div className="view-header">
        <div className="view-title">{t('Settings', '설정')}</div>
        {dirty && <span className="view-sub">{t('Unsaved changes', '저장되지 않은 변경사항')}</span>}
        <div className="view-actions">
          <button className="btn ghost" onClick={() => setShowOnboarding(true)}>
            {t('Setup wizard', '설정 마법사')}
          </button>
          <button className="btn primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? t('Saving…', '저장 중…') : t('Save', '저장')}
          </button>
        </div>
      </div>
      <div className="view-body">
        <div className="settings-wrap">
          <div className="section">
            <div className="section-title">{t('Appearance', '화면')}</div>
            <div className="section-desc">{t('Interface theme.', '인터페이스 테마.')}</div>
            <div className="row">
              <div className="seg">
                {themes.map((th) => (
                  <button
                    key={th.id}
                    className={form.theme === th.id ? 'on' : ''}
                    onClick={() => applyThemeNow(th.id)}
                  >
                    {th.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">{t('Language', '언어')}</span>
              <select
                className="select"
                value={form.language}
                onChange={(e) => edit((f) => ({ ...f, language: e.target.value as LanguageCode }))}
              >
                {LANGUAGES.map((language) => (
                  <option key={language.id} value={language.id}>
                    {language.label}
                  </option>
                ))}
              </select>
              <span className="hint">
                {t(
                  'UI language for navigation and main screens (English & Korean fully supported).',
                  '탐색 및 주요 화면의 UI 언어입니다 (영어·한국어 완전 지원).'
                )}
              </span>
            </div>
          </div>

          <div className="section">
            <div className="section-title">{t('Threads API', 'Threads API')}</div>
            <div className="section-desc">
              {t(
                'Paste a Threads access token for this desktop app. OAuth app fields are optional advanced setup.',
                '데스크톱 앱용 Threads 액세스 토큰을 붙여넣으세요. OAuth 앱 필드는 선택적 고급 설정입니다.'
              )}{' '}
              <button
                className="btn ghost small"
                onClick={() => void window.api.openExternal('https://developers.facebook.com/docs/threads')}
              >
                {t('Threads API docs', 'Threads API 문서')}
              </button>
            </div>
            <div className="field">
              <div className="field-label-row">
                <span className="field-label">{t('Access token', '액세스 토큰')}</span>
                <button className="btn ghost small" onClick={() => setShowTokenHelp(true)}>
                  {t('How to get token', '토큰 받는 방법')}
                </button>
              </div>
              <input
                className="input mono"
                type="password"
                value={form.threads.accessToken}
                onChange={(e) => setThreads({ accessToken: e.target.value })}
              />
            </div>
            <details className="advanced-panel">
              <summary>{t('Advanced OAuth setup (optional)', '고급 OAuth 설정 (선택)')}</summary>
            <div className="field">
              <span className="field-label">{t('App ID', '앱 ID')}</span>
              <input
                className="input mono"
                value={form.threads.appId}
                onChange={(e) => setThreads({ appId: e.target.value })}
              />
            </div>
            <div className="field">
              <span className="field-label">{t('App secret', '앱 시크릿')}</span>
              <input
                className="input mono"
                type="password"
                value={form.threads.appSecret}
                onChange={(e) => setThreads({ appSecret: e.target.value })}
              />
            </div>
            <div className="field">
              <span className="field-label">{t('Redirect URI', '리디렉트 URI')}</span>
              <input
                className="input mono"
                value={form.threads.redirectUri}
                onChange={(e) => setThreads({ redirectUri: e.target.value })}
              />
              <span className="hint">
                {t(
                  'Register this exact URI in the Meta app OAuth settings.',
                  'Meta 앱 OAuth 설정에 이 URI를 정확히 등록하세요.'
                )}
              </span>
            </div>
            <div className="field">
              <span className="field-label">{t('Scopes', '권한 범위')}</span>
              <input
                className="input mono"
                value={form.threads.scopes}
                onChange={(e) => setThreads({ scopes: e.target.value })}
              />
            </div>
            <div className="row">
              <button className="btn" disabled={connectingThreads} onClick={() => void connectThreadsOAuth()}>
                {connectingThreads
                  ? t('Waiting for browser…', '브라우저 대기 중…')
                  : t('Connect with Threads OAuth', 'Threads OAuth로 연결')}
              </button>
              {form.threads.tokenExpiresAt && (
                <span className="muted">
                  {t('Token expires', '토큰 만료')} {new Date(form.threads.tokenExpiresAt).toLocaleDateString()}
                </span>
              )}
            </div>
            </details>
            <div className="field">
              <span className="field-label">{t('User ID', '사용자 ID')}</span>
              <input
                className="input"
                value={form.threads.userId}
                onChange={(e) => setThreads({ userId: e.target.value })}
              />
              <span className="hint">{t('Leave empty to use "me".', '비워 두면 "me"를 사용합니다.')}</span>
            </div>
            <div className="row">
              <button className="btn" disabled={testingThreads} onClick={() => void testThreads()}>
                {testingThreads ? t('Testing…', '테스트 중…') : t('Test connection', '연결 테스트')}
              </button>
              {form.threads.username && (
                <span className="muted">
                  {t('Connected as', '연결됨')} @{form.threads.username}
                </span>
              )}
            </div>
            {threadsResult && (
              <div className={`test-result ${threadsResult.ok ? 'ok' : 'err'}`}>{threadsResult.message}</div>
            )}
          </div>

          <div className="section">
            <div className="section-title">{t('AI provider', 'AI 제공자')}</div>
            <div className="section-desc">{t('Which model writes your drafts.', '초안을 작성할 모델입니다.')}</div>
            <div className="field">
              <div className="row">
                <div className="seg">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      className={form.llm.provider === p.id ? 'on' : ''}
                      onClick={() => setLlm((l) => ({ ...l, provider: p.id }))}
                    >
                      {p.id === 'local'
                        ? t('Local LLM', '로컬 LLM')
                        : p.id === 'other'
                          ? t('Other', '기타')
                          : p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {form.llm.provider === 'claude' && (
              <>
                <div className="field">
                  <span className="field-label">{t('API key', 'API 키')}</span>
                  <input
                    className="input mono"
                    type="password"
                    value={form.llm.claude.apiKey}
                    onChange={(e) => setLlm((l) => ({ ...l, claude: { ...l.claude, apiKey: e.target.value } }))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">{t('Model', '모델')}</span>
                  <input
                    className="input"
                    placeholder="claude-sonnet-5"
                    value={form.llm.claude.model}
                    onChange={(e) => setLlm((l) => ({ ...l, claude: { ...l.claude, model: e.target.value } }))}
                  />
                </div>
              </>
            )}
            {form.llm.provider === 'openai' && (
              <>
                <div className="field">
                  <span className="field-label">{t('API key', 'API 키')}</span>
                  <input
                    className="input mono"
                    type="password"
                    value={form.llm.openai.apiKey}
                    onChange={(e) => setLlm((l) => ({ ...l, openai: { ...l.openai, apiKey: e.target.value } }))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">{t('Model', '모델')}</span>
                  <input
                    className="input"
                    placeholder="gpt-4o-mini"
                    value={form.llm.openai.model}
                    onChange={(e) => setLlm((l) => ({ ...l, openai: { ...l.openai, model: e.target.value } }))}
                  />
                </div>
              </>
            )}
            {form.llm.provider === 'gemini' && (
              <>
                <div className="field">
                  <span className="field-label">{t('API key', 'API 키')}</span>
                  <input
                    className="input mono"
                    type="password"
                    value={form.llm.gemini.apiKey}
                    onChange={(e) => setLlm((l) => ({ ...l, gemini: { ...l.gemini, apiKey: e.target.value } }))}
                  />
                  <span className="hint">
                    {t('Gemini API key from Google AI Studio.', 'Google AI Studio의 Gemini API 키.')}
                  </span>
                </div>
                <div className="field">
                  <span className="field-label">{t('Model', '모델')}</span>
                  <input
                    className="input"
                    placeholder="gemini-3.5-flash"
                    value={form.llm.gemini.model}
                    onChange={(e) => setLlm((l) => ({ ...l, gemini: { ...l.gemini, model: e.target.value } }))}
                  />
                </div>
              </>
            )}
            {form.llm.provider === 'local' && (
              <>
                <div className="field">
                  <span className="field-label">{t('Base URL', '기본 URL')}</span>
                  <input
                    className="input mono"
                    value={form.llm.local.baseUrl}
                    onChange={(e) => setLlm((l) => ({ ...l, local: { ...l.local, baseUrl: e.target.value } }))}
                  />
                  <span className="hint">
                    {t(
                      'OpenAI-compatible endpoint. Jarvis: http://127.0.0.1:8080/v1/chat/completions, Ollama: http://localhost:11434/v1, LM Studio: http://localhost:1234/v1',
                      'OpenAI 호환 엔드포인트. Jarvis: http://127.0.0.1:8080/v1/chat/completions, Ollama: http://localhost:11434/v1, LM Studio: http://localhost:1234/v1'
                    )}
                  </span>
                </div>
                <div className="field">
                  <span className="field-label">{t('Model', '모델')}</span>
                  <input
                    className="input"
                    value={form.llm.local.model}
                    onChange={(e) => setLlm((l) => ({ ...l, local: { ...l.local, model: e.target.value } }))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">{t('API key', 'API 키')}</span>
                  <input
                    className="input"
                    type="password"
                    value={form.llm.local.apiKey}
                    onChange={(e) => setLlm((l) => ({ ...l, local: { ...l.local, apiKey: e.target.value } }))}
                  />
                  <span className="hint">{t('Optional.', '선택 사항.')}</span>
                </div>
              </>
            )}
            {form.llm.provider === 'other' && (
              <>
                <div className="field">
                  <span className="field-label">{t('Base URL', '기본 URL')}</span>
                  <input
                    className="input mono"
                    placeholder="https://openrouter.ai/api/v1"
                    value={form.llm.other.baseUrl}
                    onChange={(e) => setLlm((l) => ({ ...l, other: { ...l.other, baseUrl: e.target.value } }))}
                  />
                  <span className="hint">
                    {t(
                      'OpenAI-compatible base URL or full /chat/completions URL.',
                      'OpenAI 호환 기본 URL 또는 전체 /chat/completions URL.'
                    )}
                  </span>
                </div>
                <div className="field">
                  <span className="field-label">{t('Model', '모델')}</span>
                  <input
                    className="input"
                    placeholder="provider/model-name"
                    value={form.llm.other.model}
                    onChange={(e) => setLlm((l) => ({ ...l, other: { ...l.other, model: e.target.value } }))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">{t('API key', 'API 키')}</span>
                  <input
                    className="input mono"
                    type="password"
                    value={form.llm.other.apiKey}
                    onChange={(e) => setLlm((l) => ({ ...l, other: { ...l.other, apiKey: e.target.value } }))}
                  />
                  <span className="hint">
                    {t(
                      'Optional if the endpoint does not require bearer auth.',
                      '엔드포인트에 인증이 필요 없으면 비워 두세요.'
                    )}
                  </span>
                </div>
                <div className="field">
                  <span className="field-label">{t('Headers JSON', '헤더 JSON')}</span>
                  <textarea
                    className="textarea mono"
                    value={form.llm.other.headersJson}
                    onChange={(e) => setLlm((l) => ({ ...l, other: { ...l.other, headersJson: e.target.value } }))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">{t('Request JSON', '요청 JSON')}</span>
                  <textarea
                    className="textarea mono"
                    value={form.llm.other.bodyJson}
                    onChange={(e) => setLlm((l) => ({ ...l, other: { ...l.other, bodyJson: e.target.value } }))}
                  />
                  <span className="hint">
                    {t(
                      'Merged into the chat-completions body. Use for temperature, top_p, max_tokens, provider extras.',
                      'chat-completions 본문에 병합됩니다. temperature, top_p, max_tokens 등에 사용하세요.'
                    )}
                  </span>
                </div>
              </>
            )}
            <div className="row">
              <button className="btn" disabled={testingLlm} onClick={() => void testLlm()}>
                {testingLlm ? t('Testing…', '테스트 중…') : t('Test connection', '연결 테스트')}
              </button>
            </div>
            {llmResult && (
              <div className={`test-result ${llmResult.ok ? 'ok' : 'err'}`}>{llmResult.message}</div>
            )}
          </div>

          <div className="section">
            <div className="section-title">{t('Topics', '주제')}</div>
            <div className="section-desc">
              {t('News topics used for draft generation.', '초안 생성에 사용하는 뉴스 주제입니다.')}
            </div>
            <div className="field">
              <div className="row">
                {form.topics.map((topic) => (
                  <span key={topic} className="chip">
                    {topic}
                    <button
                      className="chip-x"
                      onClick={() => removeTopic(topic)}
                      aria-label={t(`Remove ${topic}`, `${topic} 제거`)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {form.topics.length === 0 && (
                  <span className="hint">{t('No topics yet.', '주제가 없습니다.')}</span>
                )}
              </div>
            </div>
            <div className="row">
              <input
                className="input grow"
                placeholder={t('Add a topic', '주제 추가')}
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTopic()
                  }
                }}
              />
              <button className="btn" onClick={addTopic}>
                {t('Add', '추가')}
              </button>
            </div>
          </div>

          <div className="section">
            <div className="section-title">{t('News sources', '뉴스 소스')}</div>
            <div className="section-desc">
              {t(
                'Choose which media sources AutoThreads scrapes for News and auto-drafts.',
                '뉴스 화면과 자동 초안에 사용할 미디어 소스를 선택하세요.'
              )}
            </div>
            <div className="source-list">
              <label className="toggle source-toggle">
                <input
                  type="checkbox"
                  checked={form.newsSources.google}
                  onChange={(e) => toggleBuiltInSource('google', e.target.checked)}
                />
                <span>
                  <strong>Google News RSS</strong>
                  <span className="hint">
                    {t('General news and blog-mode searches.', '일반 뉴스 및 블로그 모드 검색.')}
                  </span>
                </span>
              </label>
              <label className="toggle source-toggle">
                <input
                  type="checkbox"
                  checked={form.newsSources.yahoo}
                  onChange={(e) => toggleBuiltInSource('yahoo', e.target.checked)}
                />
                <span>
                  <strong>Yahoo News</strong>
                  <span className="hint">
                    {t('Yahoo News search results (global).', 'Yahoo News 검색 결과 (글로벌).')}
                  </span>
                </span>
              </label>
              <label className="toggle source-toggle">
                <input
                  type="checkbox"
                  checked={form.newsSources.hackerNews}
                  onChange={(e) => toggleBuiltInSource('hackerNews', e.target.checked)}
                />
                <span>
                  <strong>Hacker News</strong>
                  <span className="hint">
                    {t('Selective tech/startup/developer results.', '기술·스타트업·개발자 관련 선택 결과.')}
                  </span>
                </span>
              </label>
              <label className="toggle source-toggle">
                <input
                  type="checkbox"
                  checked={form.newsSources.naver}
                  onChange={(e) => toggleBuiltInSource('naver', e.target.checked)}
                />
                <span>
                  <strong>{t('Naver News', '네이버 뉴스')}</strong>
                  <span className="hint">
                    {t('Korean media search results from Naver News.', '네이버 뉴스 한국어 미디어 검색 결과.')}
                  </span>
                </span>
              </label>
            </div>
            <div className="field">
              <span className="field-label">{t('Custom RSS / Atom feeds', '커스텀 RSS / Atom 피드')}</span>
              <div className="custom-source-list">
                {form.newsSources.custom.map((source) => (
                  <div key={source.id} className="custom-source-row">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={source.enabled}
                        onChange={(e) => updateCustomSource(source.id, { enabled: e.target.checked })}
                      />
                    </label>
                    <input
                      className="input"
                      value={source.name}
                      onChange={(e) => updateCustomSource(source.id, { name: e.target.value })}
                      placeholder={t('Source name', '소스 이름')}
                    />
                    <input
                      className="input grow"
                      value={source.url}
                      onChange={(e) => updateCustomSource(source.id, { url: e.target.value })}
                      placeholder="https://example.com/rss.xml or ...?q={query}"
                    />
                    <button className="btn ghost small" onClick={() => removeCustomSource(source.id)}>
                      {t('Remove', '제거')}
                    </button>
                  </div>
                ))}
                {form.newsSources.custom.length === 0 && (
                  <span className="hint">
                    {t(
                      'No custom feeds yet. Use {query} in a URL for query-aware RSS feeds.',
                      '커스텀 피드가 없습니다. 주제 연동 RSS는 URL에 {query}를 넣으세요.'
                    )}
                  </span>
                )}
              </div>
            </div>
            <div className="row">
              <input
                className="input"
                placeholder={t('Name', '이름')}
                value={customSourceName}
                onChange={(e) => setCustomSourceName(e.target.value)}
              />
              <input
                className="input grow"
                placeholder={t('RSS/Atom URL, optional {query}', 'RSS/Atom URL, 선택적 {query}')}
                value={customSourceUrl}
                onChange={(e) => setCustomSourceUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCustomSource()
                  }
                }}
              />
              <button className="btn" onClick={addCustomSource}>
                {t('Add source', '소스 추가')}
              </button>
            </div>
          </div>

          <div className="section">
            <div className="section-title">{t('Writing style', '글쓰기 스타일')}</div>
            <div className="field">
              <span className="field-label">{t('Style notes', '스타일 메모')}</span>
              <textarea
                className="textarea"
                value={form.style.notes}
                onChange={(e) => edit((f) => ({ ...f, style: { ...f.style, notes: e.target.value } }))}
              />
              <span className="hint">
                {t(
                  'Tone, voice, quirks. Included in every generation prompt.',
                  '톤, 목소리, 개성. 모든 생성 프롬프트에 포함됩니다.'
                )}
              </span>
            </div>
            <div className="field">
              <span className="field-label">{t('Samples', '샘플')}</span>
              {form.style.samples.map((s, i) => (
                <div key={`${i}-${s.slice(0, 16)}`} className="row">
                  <span className="muted grow">{snippet(s)}</span>
                  <button
                    className="chip-x"
                    onClick={() => removeSample(i)}
                    aria-label={t('Remove sample', '샘플 제거')}
                  >
                    ×
                  </button>
                </div>
              ))}
              {form.style.samples.length === 0 && (
                <span className="hint">
                  {t(
                    'No samples yet. Add one below or import from Threads.',
                    '샘플이 없습니다. 아래에 추가하거나 Threads에서 가져오세요.'
                  )}
                </span>
              )}
            </div>
            <div className="field">
              <textarea
                className="textarea"
                placeholder={t('Paste a post that sounds like you', '내 말투와 비슷한 글을 붙여넣기')}
                value={sampleInput}
                onChange={(e) => setSampleInput(e.target.value)}
              />
              <div className="row">
                <button className="btn" disabled={!sampleInput.trim()} onClick={addSample}>
                  {t('Add sample', '샘플 추가')}
                </button>
                <button className="btn" disabled={importing} onClick={() => void importSamples()}>
                  {importing
                    ? t('Importing…', '가져오는 중…')
                    : t('Import recent posts from Threads', 'Threads 최근 글 가져오기')}
                </button>
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section-title">{t('Automation', '자동화')}</div>
            <div className="section-desc">
              {t(
                'Periodically pulls fresh news for your topics and drafts posts for review. Scheduled posts publish automatically; drafts always wait for your review. For a fully autonomous agent that decides, posts, and replies on its own, see',
                '주제에 맞는 뉴스를 주기적으로 가져와 검토용 초안을 만듭니다. 예약 글은 자동 게시되고, 초안은 항상 검토 후 게시됩니다. 스스로 판단·게시·답글하는 완전 자동은'
              )}{' '}
              <button className="link" data-view="autopilot" onClick={() => setView('autopilot')}>
                {t('Full-Auto', '완전 자동')}
              </button>
              {ko ? '을 보세요.' : '.'}
            </div>
            <div className="field">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.autoDraft.enabled}
                  onChange={(e) => setAuto({ enabled: e.target.checked })}
                />
                <span>{t('Auto-generate drafts', '초안 자동 생성')}</span>
              </label>
            </div>
            {form.autoDraft.enabled && (
              <div className="row">
                <div className="field grow">
                  <span className="field-label">{t('Every N minutes', 'N분마다')}</span>
                  <input
                    className="input"
                    type="number"
                    min={15}
                    value={form.autoDraft.intervalMinutes}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber
                      if (!Number.isNaN(n)) setAuto({ intervalMinutes: n })
                    }}
                    onBlur={clampAuto}
                  />
                </div>
                <div className="field grow">
                  <span className="field-label">{t('Max drafts per run', '실행당 최대 초안')}</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={10}
                    value={form.autoDraft.maxPerRun}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber
                      if (!Number.isNaN(n)) setAuto({ maxPerRun: n })
                    }}
                    onBlur={clampAuto}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    {pendingView && (
      <div className="modal-backdrop">
        <div
          className="confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t('Unsaved settings', '저장되지 않은 설정')}
        >
          <div className="confirm-title">{t('Save settings?', '설정을 저장할까요?')}</div>
          <div className="confirm-body">
            {t(
              'You have unsaved settings changes. Save them before leaving this screen?',
              '저장되지 않은 설정 변경이 있습니다. 이 화면을 떠나기 전에 저장할까요?'
            )}
          </div>
          <div className="confirm-actions">
            <button className="btn ghost" disabled={saving} onClick={discardAndLeave}>
              {t('Discard', '버리기')}
            </button>
            <button className="btn" disabled={saving} onClick={() => setPendingView(null)}>
              {t('Stay', '머무르기')}
            </button>
            <button className="btn primary" disabled={saving} onClick={() => void saveAndLeave()}>
              {saving ? t('Saving…', '저장 중…') : t('Save and leave', '저장 후 나가기')}
            </button>
          </div>
        </div>
      </div>
    )}
    {showTokenHelp && <ThreadsTokenHelp onClose={() => setShowTokenHelp(false)} />}
    </>
  )
}
