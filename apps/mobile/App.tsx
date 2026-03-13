import { useEffect, useMemo, useState } from "react"
import { AppState, Platform } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from "@react-navigation/native"
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as Notifications from "expo-notifications"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { StatusBar } from "expo-status-bar"
import type {
  AuthTokens,
  NotificationPreferenceKey,
  SoundEffectPreference,
} from "@opencode-remote/shared"
import { AppThemeProvider, useAppTheme } from "./src/design/theme"
import { syncCurrentDeviceMetadata } from "./src/lib/device-metadata"
import { updateDevicePreferences, updatePushToken } from "./src/lib/api"
import { CreateProjectScreen } from "./src/screens/CreateProjectScreen"
import { DirectoryBrowserScreen } from "./src/screens/DirectoryBrowserScreen"
import { DevicesSettingsScreen } from "./src/screens/DevicesSettingsScreen"
import { GeneralSettingsScreen } from "./src/screens/GeneralSettingsScreen"
import { HostConnectScreen } from "./src/screens/HostConnectScreen"
import { ModelsSettingsScreen } from "./src/screens/ModelsSettingsScreen"
import { PrivacySettingsScreen } from "./src/screens/PrivacySettingsScreen"
import { ProvidersSettingsScreen } from "./src/screens/ProvidersSettingsScreen"
import { SessionDetailScreen } from "./src/screens/SessionDetailScreen"
import { SessionsScreen } from "./src/screens/SessionsScreen"
import { SettingsHomeScreen } from "./src/screens/SettingsHomeScreen"
import { ShortcutsSettingsScreen } from "./src/screens/ShortcutsSettingsScreen"
import { TerminalScreen } from "./src/screens/TerminalScreen"
import { useAppPreferencesStore } from "./src/state/app-preferences-store"
import { useAuthStore, type AuthSession } from "./src/state/auth-store"
import { useComposerStore } from "./src/state/composer-store"
import { useInboxStore } from "./src/state/inbox-store"

type RootStackParamList = {
  sessions: undefined
  session: { sessionId: string; notice?: string }
  terminal: { sessionId: string }
  createProject: { selectedParentPath?: string | null } | undefined
  directoryBrowser: { initialPath?: string | null } | undefined
  settings: undefined
  settingsGeneral: undefined
  settingsShortcuts: undefined
  settingsProviders: undefined
  settingsModels: undefined
  settingsPrivacy: undefined
  settingsDevices: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()
const navigationRef = createNavigationContainerRef<RootStackParamList>()

const queryClient = new QueryClient()
const NOTIFICATION_CATEGORIES: NotificationPreferenceKey[] = ["agent", "permissions", "errors"]

function shouldPlayNotificationSound(soundPreference: SoundEffectPreference) {
  return soundPreference !== "silent"
}

function getNotificationCategory(notification: Notifications.Notification): NotificationPreferenceKey {
  const data = notification.request.content.data as { notificationCategory?: unknown; permissionId?: unknown } | undefined
  if (data?.notificationCategory === "agent" || data?.notificationCategory === "permissions" || data?.notificationCategory === "errors") {
    return data.notificationCategory
  }
  if (data?.permissionId) return "permissions"

  const title = notification.request.content.title?.toLowerCase() ?? ""
  if (title.includes("approval")) return "permissions"
  if (title.includes("error") || title.includes("attention")) return "errors"
  return "agent"
}

async function configureNotificationChannels() {
  if (Platform.OS !== "android") return

  await Promise.all(
    NOTIFICATION_CATEGORIES.flatMap((category) => [
      Notifications.setNotificationChannelAsync(`opencode-${category}-silent`, {
        name: `OpenCode ${category} silent`,
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: null,
      }),
      Notifications.setNotificationChannelAsync(`opencode-${category}-audible`, {
        name: `OpenCode ${category}`,
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: "default",
      }),
    ]),
  )
}

async function registerPushToken(session: AuthSession, onRefresh: (tokens: AuthTokens) => Promise<void>) {
  if (Platform.OS === "web") return
  const permissions = await Notifications.requestPermissionsAsync()
  if (!permissions.granted) return
  const token = await Notifications.getExpoPushTokenAsync()
  await updatePushToken(session, token.data, onRefresh)
}

type SyncDeviceOptions = {
  requestLocationPermission?: boolean
  clearLocation?: boolean
}

function AppShell() {
  const { hydrate, hydrated, session, setSession, clear } = useAuthStore()
  const theme = useAppTheme()
  const hydratePreferences = useAppPreferencesStore((state) => state.hydrate)
  const preferencesHydrated = useAppPreferencesStore((state) => state.hydrated)
  const locationSharingEnabled = useAppPreferencesStore((state) => state.locationSharingEnabled)
  const notifications = useAppPreferencesStore((state) => state.notifications)
  const sounds = useAppPreferencesStore((state) => state.sounds)
  const clearInbox = useInboxStore((state) => state.clear)
  const clearComposer = useComposerStore((state) => state.clear)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [pendingNotificationSessionId, setPendingNotificationSessionId] = useState<string | null>(null)
  const [navigationReady, setNavigationReady] = useState(false)

  useEffect(() => {
    void hydrate()
    void hydratePreferences()
  }, [hydrate, hydratePreferences])

  const navigationTheme = useMemo(
    () => ({
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        background: theme.colors.app,
        card: theme.colors.app,
        text: theme.colors.text,
        border: theme.colors.border,
        primary: theme.colors.accent,
      },
    }),
    [theme.colors],
  )
  const hasEnabledNotifications = useMemo(
    () => Object.values(notifications).some(Boolean),
    [notifications],
  )

  async function handleUpdateSession(serverUrl: string, tokens: AuthTokens) {
    await setSession({
      serverUrl,
      deviceId: tokens.deviceId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    })
  }

  async function handleRefresh(tokens: AuthTokens) {
    if (!session) return
    await handleUpdateSession(session.serverUrl, tokens)
  }

  async function syncDeviceMetadata(sessionToSync: AuthSession, options: SyncDeviceOptions = {}) {
    await syncCurrentDeviceMetadata(
      sessionToSync,
      async (next) => {
        await handleUpdateSession(sessionToSync.serverUrl, next)
      },
      {
        requestLocationPermission: Boolean(options.requestLocationPermission),
        includeLocationIfGranted: !options.clearLocation,
        clearLocation: Boolean(options.clearLocation),
      },
    )
  }

  async function syncNotificationPreferences(sessionToSync: AuthSession) {
    await updateDevicePreferences(
      sessionToSync,
      {
        notifications,
        sounds,
      },
      async (next) => {
        await handleUpdateSession(sessionToSync.serverUrl, next)
      },
    )
  }

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const category = getNotificationCategory(notification)
        const showNotification = notifications[category]
        const shouldPlaySound = showNotification && shouldPlayNotificationSound(sounds[category])

        return {
          shouldShowAlert: showNotification,
          shouldPlaySound,
          shouldSetBadge: false,
          shouldShowBanner: showNotification,
          shouldShowList: showNotification,
        }
      },
    })
  }, [notifications, sounds])

  useEffect(() => {
    void configureNotificationChannels().catch(() => {
      // Channel creation should never block the rest of the app.
    })
  }, [sounds])

  useEffect(() => {
    if (!session || !hasEnabledNotifications) return
    void registerPushToken(session, handleRefresh).catch(() => {
      // Keep startup resilient if notifications are unavailable.
    })
  }, [hasEnabledNotifications, session])

  useEffect(() => {
    if (!session || !preferencesHydrated) return

    void syncNotificationPreferences(session).catch(() => {
      // Notification preference sync should stay non-blocking.
    })
  }, [notifications, preferencesHydrated, session?.deviceId, session?.serverUrl, sounds])

  useEffect(() => {
    if (!pendingNotificationSessionId || !navigationReady || !navigationRef.isReady()) return
    setSelectedSessionId(pendingNotificationSessionId)
    navigationRef.navigate("session", { sessionId: pendingNotificationSessionId })
    setPendingNotificationSessionId(null)
  }, [navigationReady, pendingNotificationSessionId])

  useEffect(() => {
    if (!session || !preferencesHydrated) return

    if (locationSharingEnabled) {
      void syncDeviceMetadata(session).catch(() => {
        // Device metadata is optional and should never block startup.
      })
      return
    }

    void syncDeviceMetadata(session, { clearLocation: true }).catch(() => {
      // Clearing previously shared location should remain non-blocking.
    })
  }, [locationSharingEnabled, preferencesHydrated, session?.deviceId, session?.serverUrl])

  useEffect(() => {
    if (!session || !preferencesHydrated || !locationSharingEnabled) return

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return

      void syncDeviceMetadata(session).catch(() => {
        // Foreground refresh failures should stay silent.
      })
    })

    return () => {
      subscription.remove()
    }
  }, [locationSharingEnabled, preferencesHydrated, session])

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { sessionId?: string; screen?: string }
      if (data.screen === "session" && data.sessionId) {
        setPendingNotificationSessionId(data.sessionId)
      }
    })

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const data = response?.notification.request.content.data as { sessionId?: string; screen?: string } | undefined
      if (data?.screen === "session" && data.sessionId) {
        setPendingNotificationSessionId(data.sessionId)
      }
    })

    return () => {
      subscription.remove()
    }
  }, [])

  if (!hydrated || !preferencesHydrated || !theme.hydrated) return null

  return (
    <QueryClientProvider client={queryClient}>
      <NavigationContainer
        ref={navigationRef}
        theme={navigationTheme}
        onReady={() => {
          setNavigationReady(true)
        }}
      >
        <StatusBar
          style={theme.mode === "light" ? "dark" : "light"}
          backgroundColor={theme.colors.app}
        />
        {!session ? (
          <HostConnectScreen
            onPaired={async (serverUrl, tokens) => {
              await handleUpdateSession(serverUrl, tokens)
              if (!locationSharingEnabled) return

              void syncDeviceMetadata(
                {
                  serverUrl,
                  deviceId: tokens.deviceId,
                  accessToken: tokens.accessToken,
                  refreshToken: tokens.refreshToken,
                  expiresAt: tokens.expiresAt,
                },
                { requestLocationPermission: true },
              ).catch(() => {
                // Pairing can still finish even if the first location sync fails.
              })
            }}
          />
        ) : (
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.app },
            }}
          >
            <Stack.Screen name="sessions" options={{ title: "OpenCode Remote" }}>
              {({ navigation }: NativeStackScreenProps<RootStackParamList, "sessions">) => (
                <SessionsScreen
                  session={session}
                  onRefreshSession={handleRefresh}
                  onOpenSession={(sessionId) => {
                    setSelectedSessionId(sessionId)
                    navigation.navigate("session", { sessionId })
                  }}
                  onOpenCreateProject={() => navigation.navigate("createProject")}
                  onOpenSettings={() => navigation.navigate("settings")}
                  onLogout={async () => {
                    clearInbox()
                    clearComposer()
                    await clear()
                  }}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="session" options={{ title: "Session" }}>
              {({ route, navigation }: NativeStackScreenProps<RootStackParamList, "session">) => (
                <SessionDetailScreen
                  auth={session}
                  sessionId={route.params?.sessionId ?? selectedSessionId ?? ""}
                  initialNotice={route.params?.notice ?? null}
                  onRefreshSession={handleRefresh}
                  onOpenTerminal={(sessionId) => navigation.navigate("terminal", { sessionId })}
                  onOpenSessions={() => navigation.navigate("sessions")}
                  onOpenSettings={() => navigation.navigate("settings")}
                  onOpenSession={(sessionId) => {
                    setSelectedSessionId(sessionId)
                    navigation.navigate("session", { sessionId })
                  }}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="terminal" options={{ title: "Terminal" }}>
              {({ route }: NativeStackScreenProps<RootStackParamList, "terminal">) => (
                <TerminalScreen auth={session} sessionId={route.params.sessionId} />
              )}
            </Stack.Screen>
            <Stack.Screen name="createProject" options={{ title: "New project" }}>
              {({ route, navigation }: NativeStackScreenProps<RootStackParamList, "createProject">) => (
                <CreateProjectScreen
                  auth={session}
                  onRefreshSession={handleRefresh}
                  selectedParentPath={route.params?.selectedParentPath ?? null}
                  onClearSelectedParentPath={() => navigation.setParams({ selectedParentPath: undefined })}
                  onBrowseParent={(currentPath) => navigation.navigate("directoryBrowser", { initialPath: currentPath })}
                  onBack={() => navigation.goBack()}
                  onProjectCreated={(sessionId, notice) => {
                    setSelectedSessionId(sessionId)
                    navigation.replace("session", { sessionId, notice })
                  }}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="directoryBrowser" options={{ title: "Browse folders" }}>
              {({ route, navigation }: NativeStackScreenProps<RootStackParamList, "directoryBrowser">) => (
                <DirectoryBrowserScreen
                  auth={session}
                  onRefreshSession={handleRefresh}
                  initialPath={route.params?.initialPath ?? null}
                  onBack={() => navigation.goBack()}
                  onSelectParent={(nextPath) => {
                    navigation.navigate("createProject", { selectedParentPath: nextPath })
                    navigation.goBack()
                  }}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="settings" options={{ title: "Settings" }}>
              {({ navigation }: NativeStackScreenProps<RootStackParamList, "settings">) => (
                <SettingsHomeScreen
                  auth={session}
                  onRefreshSession={handleRefresh}
                  onBack={() => navigation.goBack()}
                  onOpenGeneral={() => navigation.navigate("settingsGeneral")}
                  onOpenShortcuts={() => navigation.navigate("settingsShortcuts")}
                  onOpenProviders={() => navigation.navigate("settingsProviders")}
                  onOpenModels={() => navigation.navigate("settingsModels")}
                  onOpenPrivacy={() => navigation.navigate("settingsPrivacy")}
                  onOpenDevices={() => navigation.navigate("settingsDevices")}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="settingsGeneral" options={{ title: "General" }}>
              {({ navigation }: NativeStackScreenProps<RootStackParamList, "settingsGeneral">) => (
                <GeneralSettingsScreen onBack={() => navigation.goBack()} />
              )}
            </Stack.Screen>
            <Stack.Screen name="settingsShortcuts" options={{ title: "Shortcuts" }}>
              {({ navigation }: NativeStackScreenProps<RootStackParamList, "settingsShortcuts">) => (
                <ShortcutsSettingsScreen auth={session} onRefreshSession={handleRefresh} onBack={() => navigation.goBack()} />
              )}
            </Stack.Screen>
            <Stack.Screen name="settingsProviders" options={{ title: "Providers" }}>
              {({ navigation }: NativeStackScreenProps<RootStackParamList, "settingsProviders">) => (
                <ProvidersSettingsScreen auth={session} onRefreshSession={handleRefresh} onBack={() => navigation.goBack()} />
              )}
            </Stack.Screen>
            <Stack.Screen name="settingsModels" options={{ title: "Models" }}>
              {({ navigation }: NativeStackScreenProps<RootStackParamList, "settingsModels">) => (
                <ModelsSettingsScreen auth={session} onRefreshSession={handleRefresh} onBack={() => navigation.goBack()} />
              )}
            </Stack.Screen>
            <Stack.Screen name="settingsPrivacy" options={{ title: "Privacy & Location" }}>
              {({ navigation }: NativeStackScreenProps<RootStackParamList, "settingsPrivacy">) => (
                <PrivacySettingsScreen auth={session} onRefreshSession={handleRefresh} onBack={() => navigation.goBack()} />
              )}
            </Stack.Screen>
            <Stack.Screen name="settingsDevices" options={{ title: "Devices" }}>
              {({ navigation }: NativeStackScreenProps<RootStackParamList, "settingsDevices">) => (
                <DevicesSettingsScreen auth={session} onRefreshSession={handleRefresh} onBack={() => navigation.goBack()} />
              )}
            </Stack.Screen>
          </Stack.Navigator>
        )}
      </NavigationContainer>
    </QueryClientProvider>
  )
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppThemeProvider>
          <AppShell />
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
