import { useApp } from '../store/appStore'
import { shellText } from '../i18n'
import logo from '../assets/autothreads-logo.png'
import type { ViewId } from '../types'

const NAV: { id: ViewId; label: string }[] = [
  { id: 'drafts', label: 'Drafts' },
  { id: 'news', label: 'News' },
  { id: 'replies', label: 'Replies' },
  { id: 'queue', label: 'Queue' },
  { id: 'autopilot', label: 'Auto' },
]

export default function Sidebar() {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const drafts = useApp((s) => s.drafts)
  const settings = useApp((s) => s.settings)
  const autopilot = useApp((s) => s.autopilot)
  const saveSettings = useApp((s) => s.saveSettings)
  const text = shellText(settings?.language)

  const draftCount = drafts.filter((d) => d.status === 'draft').length
  const queueCount = drafts.filter((d) => d.status === 'scheduled' || d.status === 'posting').length

  const toggleTheme = () => {
    if (!settings) return
    void saveSettings({ ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' })
  }

  const countFor = (id: ViewId) =>
    id === 'drafts' ? draftCount : id === 'queue' ? queueCount : 0

  const labelFor = (id: ViewId): string =>
    id === 'drafts'
      ? text.drafts
      : id === 'news'
        ? text.news
        : id === 'replies'
          ? text.replies
          : id === 'autopilot'
            ? text.auto
            : text.queue

  return (
    <aside className="sidebar">
      <div className="side-brand">
        <img className="side-logo" src={logo} alt="" />
        <span>AutoThreads</span>
      </div>
      <nav className="side-nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`side-item${view === item.id ? ' active' : ''}`}
            data-view={item.id}
            onClick={() => setView(item.id)}
          >
            <span>{labelFor(item.id)}</span>
            {item.id === 'autopilot' && autopilot?.running && (
              <span className="side-live" title="Full-Auto running" />
            )}
            {countFor(item.id) > 0 && <span className="side-count">{countFor(item.id)}</span>}
          </button>
        ))}
      </nav>
      <div className="side-footer">
        <button
          className={`side-item${view === 'settings' ? ' active' : ''}`}
          data-view="settings"
          onClick={() => setView('settings')}
        >
          <span>{text.settings}</span>
        </button>
        <button className="side-item" onClick={toggleTheme}>
          <span>{settings?.theme === 'dark' ? text.light : text.dark}</span>
        </button>
        <div className="side-version" title="AutoThreads version">
          v{__APP_VERSION__}
        </div>
      </div>
    </aside>
  )
}
