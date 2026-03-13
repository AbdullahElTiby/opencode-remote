import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useColorScheme } from "react-native"
import * as SecureStore from "expo-secure-store"
import { useAppPreferencesStore } from "../state/app-preferences-store"
import {
  createAppTheme,
  resolveMonoFontFamily,
  setActiveMonoFont,
  type AppTheme,
  type ResolvedThemeMode,
  type ThemeModePreference,
} from "./tokens"

const storageKey = "opencode-remote-theme"

type ThemeContextValue = AppTheme & {
  hydrated: boolean
  preference: ThemeModePreference
  setPreference: (next: ThemeModePreference) => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme()
  const monoFontPreference = useAppPreferencesStore((state) => state.monoFont)
  const [hydrated, setHydrated] = useState(false)
  const [preference, setPreferenceState] = useState<ThemeModePreference>("system")

  useEffect(() => {
    let active = true

    void SecureStore.getItemAsync(storageKey)
      .then((raw) => {
        if (!active) return
        if (raw === "dark" || raw === "light" || raw === "system") {
          setPreferenceState(raw)
        }
      })
      .finally(() => {
        if (active) setHydrated(true)
      })

    return () => {
      active = false
    }
  }, [])

  const setPreference = useCallback(async (next: ThemeModePreference) => {
    setPreferenceState(next)
    await SecureStore.setItemAsync(storageKey, next)
  }, [])

  const resolvedMode: ResolvedThemeMode =
    preference === "system" ? (systemScheme === "light" ? "light" : "dark") : preference
  const monoFontFamily = useMemo(() => resolveMonoFontFamily(monoFontPreference), [monoFontPreference])

  useEffect(() => {
    setActiveMonoFont(monoFontFamily)
  }, [monoFontFamily])

  const theme = useMemo(() => createAppTheme(resolvedMode, monoFontFamily), [monoFontFamily, resolvedMode])

  const value = useMemo<ThemeContextValue>(
    () => ({
      ...theme,
      hydrated,
      preference,
      setPreference,
    }),
    [hydrated, preference, setPreference, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useAppTheme() {
  const value = useContext(ThemeContext)
  if (!value) {
    throw new Error("useAppTheme must be used inside AppThemeProvider")
  }
  return value
}
