import * as SecureStore from "expo-secure-store"
import { create } from "zustand"

const storageKey = "opencode-remote-auth"

export type AuthSession = {
  serverUrl: string
  deviceId: string
  accessToken: string
  refreshToken: string
  expiresAt: string
}

type AuthState = {
  hydrated: boolean
  session: AuthSession | null
  setSession: (session: AuthSession | null) => Promise<void>
  hydrate: () => Promise<void>
  clear: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  hydrated: false,
  session: null,
  async setSession(session) {
    if (!session) {
      await SecureStore.deleteItemAsync(storageKey)
      set({ session: null })
      return
    }
    await SecureStore.setItemAsync(storageKey, JSON.stringify(session))
    set({ session })
  },
  async hydrate() {
    const raw = await SecureStore.getItemAsync(storageKey)
    set({
      hydrated: true,
      session: raw ? (JSON.parse(raw) as AuthSession) : null,
    })
  },
  async clear() {
    await SecureStore.deleteItemAsync(storageKey)
    set({ session: null })
  },
}))
