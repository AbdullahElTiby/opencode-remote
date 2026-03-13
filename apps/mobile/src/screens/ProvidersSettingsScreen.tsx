import { useMemo } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useQuery } from "@tanstack/react-query"
import type { PromptOptionsResponse } from "@opencode-remote/shared"
import { AppHeader } from "../components/AppHeader"
import { useAppTheme } from "../design/theme"
import { cardSurface, tagSurface } from "../design/primitives"
import { spacing, typography, type ThemeColors } from "../design/tokens"
import { getPromptOptions } from "../lib/api"
import type { AuthSession } from "../state/auth-store"

type Props = {
  auth: AuthSession
  onRefreshSession: (tokens: { deviceId: string; accessToken: string; refreshToken: string; expiresAt: string }) => Promise<void>
  onBack: () => void
}

type ProviderGroup = {
  id: string
  name: string
  modelCount: number
}

export function ProvidersSettingsScreen({ auth, onRefreshSession, onBack }: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const promptOptionsQuery = useQuery<PromptOptionsResponse>({
    queryKey: ["prompt-options"],
    queryFn: () => getPromptOptions(auth, onRefreshSession),
    staleTime: 60_000,
  })

  const providers = useMemo<ProviderGroup[]>(() => {
    const grouped = new Map<string, ProviderGroup>()
    for (const model of promptOptionsQuery.data?.models ?? []) {
      const existing = grouped.get(model.providerID)
      if (existing) {
        existing.modelCount += 1
      } else {
        grouped.set(model.providerID, {
          id: model.providerID,
          name: model.providerName,
          modelCount: 1,
        })
      }
    }

    return Array.from(grouped.values()).sort((left, right) => left.name.localeCompare(right.name))
  }, [promptOptionsQuery.data?.models])

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <AppHeader
          title="Providers"
          subtitle="Available model providers discovered from your host."
          onBack={onBack}
        />

        <View style={styles.noteCard}>
          <Text style={styles.noteLabel}>HOST CONFIGURATION</Text>
          <Text style={styles.noteText}>
            Provider connections are currently managed on your OpenCode host. This mobile view shows what the host has exposed for model selection.
          </Text>
        </View>

        {promptOptionsQuery.isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={theme.colors.text} />
            <Text style={styles.stateText}>Loading providers from your host...</Text>
          </View>
        ) : promptOptionsQuery.isError ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>
              {promptOptionsQuery.error instanceof Error
                ? promptOptionsQuery.error.message
                : "Providers could not be loaded right now."}
            </Text>
          </View>
        ) : providers.length ? (
          <View style={styles.providerList}>
            {providers.map((provider) => (
              <View key={provider.id} style={styles.providerCard}>
                <View style={styles.providerHeader}>
                  <View style={styles.providerCopy}>
                    <Text style={styles.providerName}>{provider.name}</Text>
                    <Text style={styles.providerMeta}>{provider.modelCount} models available on this host</Text>
                  </View>
                  <View style={styles.hostBadge}>
                    <Text style={styles.hostBadgeText}>Host</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.stateText}>No providers with tool-capable models are currently available from the host.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  )
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
    noteCard: {
      ...cardSurface(colors),
      padding: spacing.lg,
      gap: spacing.sm,
    },
    noteLabel: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    noteText: {
      color: colors.textMuted,
      lineHeight: 22,
    },
    centerState: {
      ...cardSurface(colors),
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.xl,
    },
    stateText: {
      color: colors.textMuted,
      textAlign: "center",
      lineHeight: 21,
    },
    errorText: {
      color: colors.danger,
      textAlign: "center",
      lineHeight: 21,
    },
    providerList: {
      gap: spacing.sm,
    },
    providerCard: {
      ...cardSurface(colors),
      padding: spacing.lg,
    },
    providerHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    providerCopy: {
      flex: 1,
      gap: 4,
    },
    providerName: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "700",
    },
    providerMeta: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 20,
    },
    hostBadge: {
      ...tagSurface(colors, "info"),
      minHeight: 28,
      paddingHorizontal: spacing.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    hostBadgeText: {
      color: colors.info,
      fontSize: 11,
      fontWeight: "700",
      fontFamily: typography.mono,
    },
  })
}
