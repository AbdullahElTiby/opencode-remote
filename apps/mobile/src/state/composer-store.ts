import { create } from "zustand"

export type ComposerPreference = {
  agentId: string | null
  providerID: string | null
  modelID: string | null
  variantId: string | null
}

type ComposerState = {
  preferences: Record<string, ComposerPreference>
  setPreference: (sessionId: string, patch: Partial<ComposerPreference>) => void
  ensurePreference: (sessionId: string, fallback: ComposerPreference) => void
  clear: () => void
}

export const emptyComposerPreference: ComposerPreference = {
  agentId: null,
  providerID: null,
  modelID: null,
  variantId: null,
}

export const useComposerStore = create<ComposerState>((set) => ({
  preferences: {},
  setPreference(sessionId, patch) {
    set((state) => ({
      preferences: {
        ...state.preferences,
        [sessionId]: {
          ...(state.preferences[sessionId] ?? emptyComposerPreference),
          ...patch,
        },
      },
    }))
  },
  ensurePreference(sessionId, fallback) {
    set((state) => {
      if (state.preferences[sessionId]) {
        return state
      }
      return {
        preferences: {
          ...state.preferences,
          [sessionId]: fallback,
        },
      }
    })
  },
  clear() {
    set({ preferences: {} })
  },
}))
