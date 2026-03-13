import { useCallback, useMemo, useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useFocusEffect } from "@react-navigation/native"
import { useQuery } from "@tanstack/react-query"
import type { Device } from "@opencode-remote/shared"
import { AppHeader } from "../components/AppHeader"
import { SettingToggle } from "../components/SettingToggle"
import { buttonSurface, cardSurface } from "../design/primitives"
import { useAppTheme } from "../design/theme"
import { spacing, typography, type ThemeColors } from "../design/tokens"
import {
  getApproximateLocationPermissionState,
  openAppSystemSettings,
  syncCurrentDeviceMetadata,
  type ApproximateLocationPermissionState,
} from "../lib/device-metadata"
import { getDevices } from "../lib/api"
import type { AuthSession } from "../state/auth-store"
import { useAppPreferencesStore } from "../state/app-preferences-store"

type Props = {
  auth: AuthSession
  onRefreshSession: (tokens: { deviceId: string; accessToken: string; refreshToken: string; expiresAt: string }) => Promise<void>
  onBack: () => void
}

export function PrivacySettingsScreen({ auth, onRefreshSession, onBack }: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const locationSharingEnabled = useAppPreferencesStore((state) => state.locationSharingEnabled)
  const setLocationSharingEnabled = useAppPreferencesStore((state) => state.setLocationSharingEnabled)
  const [permissionState, setPermissionState] = useState<ApproximateLocationPermissionState>("unavailable")
  const [busy, setBusy] = useState(false)
  const devicesQuery = useQuery<Device[]>({
    queryKey: ["devices"],
    queryFn: () => getDevices(auth, onRefreshSession),
  })

  const currentDevice = useMemo(
    () => (devicesQuery.data ?? []).find((item) => item.id === auth.deviceId) ?? null,
    [auth.deviceId, devicesQuery.data],
  )

  const refreshPermissionState = useCallback(async () => {
    const nextState = await getApproximateLocationPermissionState()
    setPermissionState(nextState)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refreshPermissionState()
      void devicesQuery.refetch()
    }, [devicesQuery, refreshPermissionState]),
  )

  async function updateLocationSharing(enabled: boolean) {
    const previous = locationSharingEnabled

    setBusy(true)
    try {
      await setLocationSharingEnabled(enabled)
      await syncCurrentDeviceMetadata(
        auth,
        onRefreshSession,
        enabled
          ? {
              requestLocationPermission: true,
              includeLocationIfGranted: true,
            }
          : {
              clearLocation: true,
              includeLocationIfGranted: false,
            },
      )
      await Promise.all([refreshPermissionState(), devicesQuery.refetch()])
    } catch (error) {
      await setLocationSharingEnabled(previous)
      Alert.alert(
        "Location update failed",
        error instanceof Error ? error.message : "The location sharing setting could not be updated right now.",
      )
    } finally {
      setBusy(false)
    }
  }

  const permissionLabel = useMemo(() => {
    switch (permissionState) {
      case "granted":
        return "Allowed"
      case "undetermined":
        return "Not granted yet"
      case "denied":
        return "Blocked"
      default:
        return "Unavailable"
    }
  }, [permissionState])

  const shareLabel = formatLocation(currentDevice) ?? "Location not shared"
  const lastSharedLabel = currentDevice?.locationSharedAt ? formatTimestamp(currentDevice.locationSharedAt) : "Never"

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <AppHeader title="Privacy & Location" subtitle="Only approximate city and country are ever shared." onBack={onBack} />

        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleCopy}>
              <Text style={styles.title}>Automatic approximate location</Text>
              <Text style={styles.body}>
                When enabled, the app updates your city and country for the host linked-device view whenever the app is active.
              </Text>
            </View>
            <SettingToggle
              value={locationSharingEnabled}
              onPress={() => {
                const nextValue = !locationSharingEnabled
                void updateLocationSharing(nextValue)
              }}
              disabled={busy}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.kicker}>STATUS</Text>
          <InfoRow label="Sharing" value={locationSharingEnabled ? "Enabled" : "Disabled"} />
          <InfoRow label="Permission" value={permissionLabel} />
          <InfoRow label="Current location" value={shareLabel} />
          <InfoRow label="Last shared" value={lastSharedLabel} />

          {locationSharingEnabled && permissionState === "denied" ? (
            <Pressable style={styles.actionButton} onPress={() => void openAppSystemSettings()}>
              <Text style={styles.actionButtonText}>Open system settings</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function formatLocation(device: Device | null) {
  if (!device?.locationCity && !device?.locationCountry) {
    return null
  }
  return [device.locationCity, device.locationCountry].filter(Boolean).join(", ")
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
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
      gap: spacing.md,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    toggleCopy: {
      flex: 1,
      gap: spacing.xs,
    },
    kicker: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    title: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "700",
    },
    body: {
      color: colors.textMuted,
      lineHeight: 22,
    },
    infoRow: {
      gap: 4,
    },
    infoLabel: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    infoValue: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
    },
    actionButton: {
      ...buttonSurface(colors, "panelStrong"),
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.md,
    },
    actionButtonText: {
      color: colors.text,
      fontWeight: "700",
    },
  })
}
