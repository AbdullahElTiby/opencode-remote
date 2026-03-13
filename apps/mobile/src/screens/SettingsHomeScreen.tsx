import { useCallback, useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useFocusEffect } from "@react-navigation/native"
import { useQuery } from "@tanstack/react-query"
import type { Device, PromptOptionsResponse } from "@opencode-remote/shared"
import { AppHeader } from "../components/AppHeader"
import { useAppTheme } from "../design/theme"
import { cardSurface, tagSurface } from "../design/primitives"
import { spacing, typography, type ThemeColors } from "../design/tokens"
import { getApproximateLocationPermissionState, type ApproximateLocationPermissionState } from "../lib/device-metadata"
import { getDevices, getPromptOptions } from "../lib/api"
import type { AuthSession } from "../state/auth-store"
import { useAppPreferencesStore } from "../state/app-preferences-store"

type Props = {
  auth: AuthSession
  onRefreshSession: (tokens: { deviceId: string; accessToken: string; refreshToken: string; expiresAt: string }) => Promise<void>
  onBack: () => void
  onOpenGeneral: () => void
  onOpenShortcuts: () => void
  onOpenProviders: () => void
  onOpenModels: () => void
  onOpenPrivacy: () => void
  onOpenDevices: () => void
}

export function SettingsHomeScreen({
  auth,
  onRefreshSession,
  onBack,
  onOpenGeneral,
  onOpenShortcuts,
  onOpenProviders,
  onOpenModels,
  onOpenPrivacy,
  onOpenDevices,
}: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const locationSharingEnabled = useAppPreferencesStore((state) => state.locationSharingEnabled)
  const showReasoningSummaries = useAppPreferencesStore((state) => state.showReasoningSummaries)
  const hiddenModelIds = useAppPreferencesStore((state) => state.hiddenModelIds)
  const [permissionState, setPermissionState] = useState<ApproximateLocationPermissionState>("unavailable")

  const devicesQuery = useQuery<Device[]>({
    queryKey: ["devices"],
    queryFn: () => getDevices(auth, onRefreshSession),
  })
  const promptOptionsQuery = useQuery<PromptOptionsResponse>({
    queryKey: ["prompt-options"],
    queryFn: () => getPromptOptions(auth, onRefreshSession),
    staleTime: 60_000,
  })

  useFocusEffect(
    useCallback(() => {
      let active = true
      void getApproximateLocationPermissionState().then((nextState) => {
        if (active) {
          setPermissionState(nextState)
        }
      })
      return () => {
        active = false
      }
    }, []),
  )

  const visibleDevices = useMemo(
    () => (devicesQuery.data ?? []).filter((item) => !item.revokedAt),
    [devicesQuery.data],
  )
  const currentDevice = useMemo(
    () => visibleDevices.find((item) => item.id === auth.deviceId) ?? null,
    [auth.deviceId, visibleDevices],
  )

  const providerCount = useMemo(() => {
    return new Set((promptOptionsQuery.data?.models ?? []).map((model) => model.providerID)).size
  }, [promptOptionsQuery.data?.models])
  const totalModelCount = promptOptionsQuery.data?.models.length ?? 0
  const visibleModelCount = Math.max(totalModelCount - hiddenModelIds.length, 0)

  const generalSummary = `${formatAppearance(theme.preference, theme.mode)} · ${showReasoningSummaries ? "reasoning on" : "reasoning off"}`
  const providersSummary = promptOptionsQuery.isLoading
    ? "Loading provider catalog..."
    : providerCount
      ? `${providerCount} providers available from the host`
      : "No host providers detected yet"
  const modelsSummary = promptOptionsQuery.isLoading
    ? "Loading model visibility..."
    : `${visibleModelCount} of ${totalModelCount} models visible`
  const privacySummary = useMemo(() => {
    if (!locationSharingEnabled) {
      return "Approximate location sharing is off."
    }
    if (permissionState === "granted") {
      const label = formatLocation(currentDevice)
      return label ? `Sharing ${label}.` : "Approximate location sharing is enabled."
    }
    if (permissionState === "denied") {
      return "Location access is blocked in system settings."
    }
    if (permissionState === "undetermined") {
      return "Location access has not been granted yet."
    }
    return "Location sharing is unavailable on this device."
  }, [currentDevice, locationSharingEnabled, permissionState])
  const devicesSummary = devicesQuery.isLoading
    ? "Loading trusted devices..."
    : `${visibleDevices.length} linked device${visibleDevices.length === 1 ? "" : "s"}`

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <AppHeader title="Settings" subtitle="General controls, host providers, model visibility, privacy, and trusted devices." onBack={onBack} />

        <SettingsCard
          title="General"
          kicker="DESKTOP"
          body="Appearance, feed behavior, notifications, sounds, and update preferences."
          summary={generalSummary}
          onPress={onOpenGeneral}
        />

        <SettingsCard
          title="Shortcuts"
          kicker="DESKTOP"
          body="Quick actions, slash commands, and mobile-first session controls."
          summary="Session actions, composer shortcuts, and host command list"
          onPress={onOpenShortcuts}
        />

        <SettingsCard
          title="Providers"
          kicker="SERVER"
          body="View which OpenCode providers are currently exposed by your host."
          summary={providersSummary}
          onPress={onOpenProviders}
        />

        <SettingsCard
          title="Models"
          kicker="SERVER"
          body="Choose which host models stay visible in mobile composer pickers."
          summary={modelsSummary}
          onPress={onOpenModels}
        />

        <SettingsCard
          title="Privacy & Location"
          kicker="PRIVACY"
          body="Automatic approximate location sync for the host linked-device view."
          summary={privacySummary}
          onPress={onOpenPrivacy}
        />

        <SettingsCard
          title="Trusted devices"
          kicker="DEVICES"
          body="Review linked phones and revoke access when needed."
          summary={devicesSummary}
          onPress={onOpenDevices}
        />
      </ScrollView>
    </SafeAreaView>
  )
}

function SettingsCard({
  kicker,
  title,
  body,
  summary,
  onPress,
}: {
  kicker: string
  title: string
  body: string
  summary: string
  onPress: () => void
}) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardHeader}>
        <View style={styles.cardCopy}>
          <Text style={styles.kicker}>{kicker}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <Text style={styles.meta}>{summary}</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{">"}</Text>
        </View>
      </View>
    </Pressable>
  )
}

function formatLocation(device: Device | null) {
  if (!device?.locationCity && !device?.locationCountry) {
    return null
  }
  return [device.locationCity, device.locationCountry].filter(Boolean).join(", ")
}

function formatAppearance(value: "system" | "dark" | "light", resolvedMode: "dark" | "light") {
  if (value === "system") {
    return `System (${resolvedMode})`
  }
  return value[0].toUpperCase() + value.slice(1)
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.app,
    },
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl,
      gap: spacing.md,
      backgroundColor: colors.app,
    },
    card: {
      ...cardSurface(colors),
      padding: spacing.lg,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    cardCopy: {
      flex: 1,
      gap: spacing.sm,
    },
    kicker: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    title: {
      color: colors.text,
      fontSize: 22,
      fontWeight: "700",
    },
    body: {
      color: colors.textMuted,
      lineHeight: 22,
    },
    meta: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 20,
      fontFamily: typography.mono,
    },
    badge: {
      ...tagSurface(colors, "panelStrong"),
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
      fontFamily: typography.mono,
    },
  })
}
