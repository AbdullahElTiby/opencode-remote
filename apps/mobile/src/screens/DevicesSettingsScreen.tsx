import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Device } from "@opencode-remote/shared"
import { AppHeader } from "../components/AppHeader"
import { buttonSurface, cardSurface, tagSurface } from "../design/primitives"
import { useAppTheme } from "../design/theme"
import { spacing, typography, type ThemeColors } from "../design/tokens"
import { getDevices, revokeDevice } from "../lib/api"
import type { AuthSession } from "../state/auth-store"

type Props = {
  auth: AuthSession
  onRefreshSession: (tokens: { deviceId: string; accessToken: string; refreshToken: string; expiresAt: string }) => Promise<void>
  onBack: () => void
}

export function DevicesSettingsScreen({ auth, onRefreshSession, onBack }: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const queryClient = useQueryClient()
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null)
  const devicesQuery = useQuery<Device[]>({
    queryKey: ["devices"],
    queryFn: () => getDevices(auth, onRefreshSession),
  })

  const visibleDevices = useMemo(
    () => (devicesQuery.data ?? []).filter((item) => !item.revokedAt),
    [devicesQuery.data],
  )

  async function performRevoke(deviceId: string) {
    try {
      setRevokingDeviceId(deviceId)
      queryClient.setQueryData<Device[]>(["devices"], (current = []) => current.filter((item) => item.id !== deviceId))
      await revokeDevice(auth, deviceId, onRefreshSession)
      await devicesQuery.refetch()
    } catch (error) {
      await devicesQuery.refetch()
      Alert.alert(
        "Revoke failed",
        error instanceof Error ? error.message : "The device could not be revoked right now.",
      )
    } finally {
      setRevokingDeviceId(null)
    }
  }

  async function handleRevoke(deviceId: string) {
    Alert.alert("Revoke device", "This device will lose access until it pairs again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: () => {
          void performRevoke(deviceId)
        },
      },
    ])
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <AppHeader title="Devices" subtitle="Trusted phones and tablets currently linked to this gateway." onBack={onBack} />

        <View style={styles.noteCard}>
          <Text style={styles.noteLabel}>ACCESS</Text>
          <Text style={styles.noteText}>
            Revoke a device here if you no longer want it to reconnect without pairing again.
          </Text>
        </View>

        <FlatList
          data={visibleDevices}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.deviceRow}>
              <View style={styles.deviceCopy}>
                <Text style={styles.deviceName}>{item.name}</Text>
                <Text style={styles.deviceMeta}>
                  {item.platform} · last seen {formatTimestamp(item.lastSeenAt)}
                </Text>
                <Text style={styles.deviceMeta}>{item.id === auth.deviceId ? "This phone" : item.id}</Text>
              </View>
              {item.id !== auth.deviceId ? (
                <Pressable
                  style={[styles.revokeButton, revokingDeviceId === item.id && styles.revokeButtonBusy]}
                  onPress={() => handleRevoke(item.id)}
                  disabled={revokingDeviceId === item.id}
                >
                  <Text style={styles.revokeText}>{revokingDeviceId === item.id ? "Revoking..." : "Revoke"}</Text>
                </Pressable>
              ) : (
                <View style={styles.currentBadge}>
                  <Text style={styles.currentBadgeText}>Active</Text>
                </View>
              )}
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No devices are registered yet.</Text>}
        />
      </View>
    </SafeAreaView>
  )
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
      flex: 1,
      backgroundColor: colors.app,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      gap: spacing.md,
    },
    noteCard: {
      ...cardSurface(colors),
      padding: spacing.md,
      gap: spacing.xs,
    },
    noteLabel: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    noteText: {
      color: colors.textMuted,
      lineHeight: 20,
    },
    list: {
      gap: spacing.sm,
      paddingBottom: spacing.xxl,
    },
    deviceRow: {
      ...cardSurface(colors, "surfaceMuted"),
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.md,
    },
    deviceCopy: {
      flex: 1,
      gap: 4,
    },
    deviceName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "700",
    },
    deviceMeta: {
      color: colors.textDim,
      fontSize: 12,
      fontFamily: typography.mono,
    },
    revokeButton: {
      ...buttonSurface(colors, "danger"),
      minHeight: 36,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    revokeButtonBusy: {
      opacity: 0.7,
    },
    revokeText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: "700",
    },
    currentBadge: {
      ...tagSurface(colors, "success"),
      minHeight: 36,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    currentBadgeText: {
      color: colors.success,
      fontSize: 13,
      fontWeight: "700",
    },
    empty: {
      color: colors.textDim,
      textAlign: "center",
      marginTop: spacing.xxl,
    },
  })
}
