import { useApp } from '../store/appStore'
import { shellText } from '../i18n'

export default function StatusBar() {
  const settings = useApp((s) => s.settings)
  const drafts = useApp((s) => s.drafts)
  const autopilot = useApp((s) => s.autopilot)
  const setView = useApp((s) => s.setView)
  if (!settings) return null
  const text = shellText(settings.language)

  const llm = settings.llm
  const model =
    llm.provider === 'claude'
      ? llm.claude.model
      : llm.provider === 'openai'
        ? llm.openai.model
        : llm.provider === 'gemini'
          ? llm.gemini.model
          : llm.provider === 'other'
            ? llm.other.model || 'custom'
            : llm.local.model
  const llmReady =
    llm.provider === 'local'
      ? Boolean(llm.local.baseUrl)
      : llm.provider === 'other'
        ? Boolean(llm.other.baseUrl)
        : Boolean(llm[llm.provider].apiKey)
  const threadsReady = Boolean(settings.threads.accessToken)
  const scheduled = drafts.filter((d) => d.status === 'scheduled').length
  const failed = drafts.filter((d) => d.status === 'failed').length

  return (
    <footer className="statusbar">
      <span className="status-item">
        LLM: {llm.provider} · {model}
        {!llmReady && ` (${text.notConfigured})`}
      </span>
      <span className="status-sep">|</span>
      <span className="status-item">
        Threads: {threadsReady ? settings.threads.username ? `@${settings.threads.username}` : text.configured : text.notConfigured}
      </span>
      <span className="grow" />
      {autopilot?.running && (
        <button
          className="status-item link"
          onClick={() => setView('autopilot')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}
        >
          <span className="side-live inline" />
          {text.auto}
          {autopilot.busy ? ' ·' : ''} {autopilot.postsToday}/{autopilot.maxPostsPerDay}
        </button>
      )}
      {failed > 0 && <span className="status-item">{failed} {text.failed}</span>}
      <span className="status-item">{scheduled} {text.scheduled}</span>
      <span className="status-item">{drafts.length} {text.total}</span>
      <span className="status-sep">|</span>
      <span className="status-item status-version" title="AutoThreads version">
        v{__APP_VERSION__}
      </span>
    </footer>
  )
}
