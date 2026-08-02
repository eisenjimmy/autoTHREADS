import { create } from 'zustand'
import type { AppSettings, AutopilotStatus, Draft, Toast, ViewId } from '../types'

function applyTheme(settings: AppSettings | null) {
  document.documentElement.dataset.theme = settings?.theme === 'light' ? 'light' : 'dark'
}

let toastSeq = 1
let draftsListenerRegistered = false
let autopilotListenerRegistered = false

interface AppState {
  view: ViewId
  settings: AppSettings | null
  drafts: Draft[]
  selectedDraftId: string | null
  toasts: Toast[]
  showOnboarding: boolean
  autopilot: AutopilotStatus | null
  setShowOnboarding(show: boolean): void
  setView(view: ViewId): void
  loadInitial(): Promise<void>
  saveSettings(settings: AppSettings): Promise<boolean>
  selectDraft(id: string | null): void
  upsertDraft(draft: Draft): Promise<void>
  deleteDraft(id: string): Promise<void>
  setAutopilotRunning(running: boolean): Promise<void>
  runAutopilotNow(): Promise<void>
  resetAutopilotCounters(): Promise<void>
  toast(kind: 'ok' | 'err', text: string): void
  dismissToast(id: number): void
}

export const useApp = create<AppState>((set, get) => ({
  view: 'drafts',
  settings: null,
  drafts: [],
  selectedDraftId: null,
  toasts: [],
  showOnboarding: false,
  autopilot: null,

  setShowOnboarding: (show) => set({ showOnboarding: show }),

  setView: (view) => set({ view }),

  loadInitial: async () => {
    if (!draftsListenerRegistered) {
      draftsListenerRegistered = true
      window.api.onDraftsChanged((drafts) => set({ drafts }))
    }
    if (!autopilotListenerRegistered) {
      autopilotListenerRegistered = true
      window.api.onAutopilotStatus((autopilot) => set({ autopilot }))
    }
    const [settings, drafts, autopilot] = await Promise.all([
      window.api.settingsGet(),
      window.api.draftsAll(),
      window.api.autopilotStatus(),
    ])
    applyTheme(settings)
    set({ settings, drafts, autopilot, showOnboarding: !settings.onboarded })
  },

  setAutopilotRunning: async (running) => {
    try {
      const status = await window.api.autopilotSetRunning(running)
      set({ autopilot: status })
    } catch (err) {
      get().toast('err', `Autopilot: ${err instanceof Error ? err.message : String(err)}`)
    }
  },

  runAutopilotNow: async () => {
    try {
      const status = await window.api.autopilotRunNow()
      set({ autopilot: status })
    } catch (err) {
      get().toast('err', `Autopilot: ${err instanceof Error ? err.message : String(err)}`)
    }
  },

  resetAutopilotCounters: async () => {
    try {
      const status = await window.api.autopilotResetCounters()
      set({ autopilot: status })
    } catch (err) {
      get().toast('err', `Failed to reset counters: ${err instanceof Error ? err.message : String(err)}`)
    }
  },

  saveSettings: async (settings) => {
    try {
      await window.api.settingsSet(settings)
      const fresh = await window.api.settingsGet()
      applyTheme(fresh)
      set({ settings: fresh })
      return true
    } catch (err) {
      get().toast('err', `Failed to save settings: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  },

  selectDraft: (id) => set({ selectedDraftId: id }),

  upsertDraft: async (draft) => {
    try {
      const drafts = await window.api.draftUpsert(draft)
      set({ drafts })
    } catch (err) {
      get().toast('err', `Failed to save draft: ${err instanceof Error ? err.message : String(err)}`)
    }
  },

  deleteDraft: async (id) => {
    try {
      const drafts = await window.api.draftDelete(id)
      const selected = get().selectedDraftId
      set({ drafts, selectedDraftId: selected === id ? null : selected })
    } catch (err) {
      get().toast('err', `Failed to delete draft: ${err instanceof Error ? err.message : String(err)}`)
    }
  },

  toast: (kind, text) =>
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id: toastSeq++, kind, text }] })),

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
