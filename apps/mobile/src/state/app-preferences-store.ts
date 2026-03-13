import * as SecureStore from "expo-secure-store"
import { create } from "zustand"

const storageKey = "opencode-remote-preferences"

export type AppLanguagePreference = "en" | "tr"
export type ThemeVariantPreference = "oc-2"
export type MonoFontPreference = "system-mono" | "monospace" | "system-sans"
export type NotificationPreferenceKey = "agent" | "permissions" | "errors"
export type SoundPreferenceKey = NotificationPreferenceKey
export type SoundEffectPreference = "staplebops-01" | "staplebops-02" | "nope-03" | "silent"

type NotificationPreferences = Record<NotificationPreferenceKey, boolean>
type SoundPreferences = Record<SoundPreferenceKey, SoundEffectPreference>

type StoredPreferences = {
  locationSharingEnabled?: boolean
  language?: AppLanguagePreference
  themeVariant?: ThemeVariantPreference
  monoFont?: MonoFontPreference
  showReasoningSummaries?: boolean
  expandShellToolParts?: boolean
  expandEditToolParts?: boolean
  notifications?: Partial<NotificationPreferences>
  sounds?: Partial<SoundPreferences>
  checkForUpdatesOnStartup?: boolean
  showReleaseNotes?: boolean
  hiddenModelIds?: string[]
}

type AppPreferencesState = {
  hydrated: boolean
  locationSharingEnabled: boolean
  language: AppLanguagePreference
  themeVariant: ThemeVariantPreference
  monoFont: MonoFontPreference
  showReasoningSummaries: boolean
  expandShellToolParts: boolean
  expandEditToolParts: boolean
  notifications: NotificationPreferences
  sounds: SoundPreferences
  checkForUpdatesOnStartup: boolean
  showReleaseNotes: boolean
  hiddenModelIds: string[]
  hydrate: () => Promise<void>
  setLocationSharingEnabled: (enabled: boolean) => Promise<void>
  setLanguage: (language: AppLanguagePreference) => Promise<void>
  setThemeVariant: (themeVariant: ThemeVariantPreference) => Promise<void>
  setMonoFont: (monoFont: MonoFontPreference) => Promise<void>
  setShowReasoningSummaries: (enabled: boolean) => Promise<void>
  setExpandShellToolParts: (enabled: boolean) => Promise<void>
  setExpandEditToolParts: (enabled: boolean) => Promise<void>
  setNotificationEnabled: (key: NotificationPreferenceKey, enabled: boolean) => Promise<void>
  setSoundPreference: (key: SoundPreferenceKey, value: SoundEffectPreference) => Promise<void>
  setCheckForUpdatesOnStartup: (enabled: boolean) => Promise<void>
  setShowReleaseNotes: (enabled: boolean) => Promise<void>
  setModelEnabled: (modelId: string, enabled: boolean) => Promise<void>
  isModelEnabled: (modelId: string) => boolean
}

const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  agent: true,
  permissions: true,
  errors: true,
}

const DEFAULT_SOUNDS: SoundPreferences = {
  agent: "staplebops-01",
  permissions: "staplebops-02",
  errors: "nope-03",
}

const DEFAULT_PREFERENCES = {
  locationSharingEnabled: true,
  language: "en" as AppLanguagePreference,
  themeVariant: "oc-2" as ThemeVariantPreference,
  monoFont: "system-mono" as MonoFontPreference,
  showReasoningSummaries: false,
  expandShellToolParts: true,
  expandEditToolParts: false,
  notifications: DEFAULT_NOTIFICATIONS,
  sounds: DEFAULT_SOUNDS,
  checkForUpdatesOnStartup: true,
  showReleaseNotes: true,
  hiddenModelIds: [] as string[],
}

function normalizePreferences(parsed?: StoredPreferences) {
  return {
    locationSharingEnabled: parsed?.locationSharingEnabled ?? DEFAULT_PREFERENCES.locationSharingEnabled,
    language: parsed?.language ?? DEFAULT_PREFERENCES.language,
    themeVariant: parsed?.themeVariant ?? DEFAULT_PREFERENCES.themeVariant,
    monoFont: parsed?.monoFont ?? DEFAULT_PREFERENCES.monoFont,
    showReasoningSummaries: parsed?.showReasoningSummaries ?? DEFAULT_PREFERENCES.showReasoningSummaries,
    expandShellToolParts: parsed?.expandShellToolParts ?? DEFAULT_PREFERENCES.expandShellToolParts,
    expandEditToolParts: parsed?.expandEditToolParts ?? DEFAULT_PREFERENCES.expandEditToolParts,
    notifications: {
      ...DEFAULT_NOTIFICATIONS,
      ...(parsed?.notifications ?? {}),
    },
    sounds: {
      ...DEFAULT_SOUNDS,
      ...(parsed?.sounds ?? {}),
    },
    checkForUpdatesOnStartup: parsed?.checkForUpdatesOnStartup ?? DEFAULT_PREFERENCES.checkForUpdatesOnStartup,
    showReleaseNotes: parsed?.showReleaseNotes ?? DEFAULT_PREFERENCES.showReleaseNotes,
    hiddenModelIds: Array.isArray(parsed?.hiddenModelIds) ? parsed!.hiddenModelIds.filter(Boolean) : [],
  }
}

async function persistPreferences(preferences: StoredPreferences) {
  await SecureStore.setItemAsync(storageKey, JSON.stringify(preferences))
}

function toStoredPreferences(state: AppPreferencesState): StoredPreferences {
  return {
    locationSharingEnabled: state.locationSharingEnabled,
    language: state.language,
    themeVariant: state.themeVariant,
    monoFont: state.monoFont,
    showReasoningSummaries: state.showReasoningSummaries,
    expandShellToolParts: state.expandShellToolParts,
    expandEditToolParts: state.expandEditToolParts,
    notifications: state.notifications,
    sounds: state.sounds,
    checkForUpdatesOnStartup: state.checkForUpdatesOnStartup,
    showReleaseNotes: state.showReleaseNotes,
    hiddenModelIds: state.hiddenModelIds,
  }
}

async function persistFromState(get: () => AppPreferencesState) {
  await persistPreferences(toStoredPreferences(get()))
}

export const useAppPreferencesStore = create<AppPreferencesState>((set, get) => ({
  hydrated: false,
  ...DEFAULT_PREFERENCES,
  async hydrate() {
    const raw = await SecureStore.getItemAsync(storageKey)
    const parsed = raw ? ((JSON.parse(raw) as StoredPreferences) ?? {}) : {}

    set({
      hydrated: true,
      ...normalizePreferences(parsed),
    })
  },
  async setLocationSharingEnabled(enabled) {
    set({ locationSharingEnabled: enabled })
    await persistFromState(get)
  },
  async setLanguage(language) {
    set({ language })
    await persistFromState(get)
  },
  async setThemeVariant(themeVariant) {
    set({ themeVariant })
    await persistFromState(get)
  },
  async setMonoFont(monoFont) {
    set({ monoFont })
    await persistFromState(get)
  },
  async setShowReasoningSummaries(enabled) {
    set({ showReasoningSummaries: enabled })
    await persistFromState(get)
  },
  async setExpandShellToolParts(enabled) {
    set({ expandShellToolParts: enabled })
    await persistFromState(get)
  },
  async setExpandEditToolParts(enabled) {
    set({ expandEditToolParts: enabled })
    await persistFromState(get)
  },
  async setNotificationEnabled(key, enabled) {
    set((state) => ({
      notifications: {
        ...state.notifications,
        [key]: enabled,
      },
    }))
    await persistFromState(get)
  },
  async setSoundPreference(key, value) {
    set((state) => ({
      sounds: {
        ...state.sounds,
        [key]: value,
      },
    }))
    await persistFromState(get)
  },
  async setCheckForUpdatesOnStartup(enabled) {
    set({ checkForUpdatesOnStartup: enabled })
    await persistFromState(get)
  },
  async setShowReleaseNotes(enabled) {
    set({ showReleaseNotes: enabled })
    await persistFromState(get)
  },
  async setModelEnabled(modelId, enabled) {
    set((state) => {
      const hidden = new Set(state.hiddenModelIds)
      if (enabled) hidden.delete(modelId)
      else hidden.add(modelId)

      return {
        hiddenModelIds: Array.from(hidden).sort((left, right) => left.localeCompare(right)),
      }
    })
    await persistFromState(get)
  },
  isModelEnabled(modelId) {
    return !get().hiddenModelIds.includes(modelId)
  },
}))
