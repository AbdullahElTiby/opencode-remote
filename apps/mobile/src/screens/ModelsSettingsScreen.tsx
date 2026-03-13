import { useMemo, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useQuery } from "@tanstack/react-query"
import type { PromptModelOption, PromptOptionsResponse } from "@opencode-remote/shared"
import { AppHeader } from "../components/AppHeader"
import { SettingToggle } from "../components/SettingToggle"
import { useAppTheme } from "../design/theme"
import { cardSurface, inputSurface, tagSurface } from "../design/primitives"
import { spacing, typography, type ThemeColors } from "../design/tokens"
import { getPromptOptions } from "../lib/api"
import type { AuthSession } from "../state/auth-store"
import { useAppPreferencesStore } from "../state/app-preferences-store"

type Props = {
  auth: AuthSession
  onRefreshSession: (tokens: { deviceId: string; accessToken: string; refreshToken: string; expiresAt: string }) => Promise<void>
  onBack: () => void
}

type ModelGroup = {
  providerID: string
  providerName: string
  models: PromptModelOption[]
}

export function ModelsSettingsScreen({ auth, onRefreshSession, onBack }: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const [searchQuery, setSearchQuery] = useState("")
  const hiddenModelIds = useAppPreferencesStore((state) => state.hiddenModelIds)
  const setModelEnabled = useAppPreferencesStore((state) => state.setModelEnabled)

  const promptOptionsQuery = useQuery<PromptOptionsResponse>({
    queryKey: ["prompt-options"],
    queryFn: () => getPromptOptions(auth, onRefreshSession),
    staleTime: 60_000,
  })

  const searchValue = searchQuery.trim().toLowerCase()
  const groups = useMemo<ModelGroup[]>(() => {
    const grouped = new Map<string, ModelGroup>()
    for (const model of promptOptionsQuery.data?.models ?? []) {
      if (searchValue) {
        const haystack = `${model.name} ${model.providerName} ${model.modelID}`.toLowerCase()
        if (!haystack.includes(searchValue)) continue
      }

      const existing = grouped.get(model.providerID)
      if (existing) {
        existing.models.push(model)
      } else {
        grouped.set(model.providerID, {
          providerID: model.providerID,
          providerName: model.providerName,
          models: [model],
        })
      }
    }

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        models: [...group.models].sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => left.providerName.localeCompare(right.providerName))
  }, [promptOptionsQuery.data?.models, searchValue])

  const enabledCount = useMemo(
    () => (promptOptionsQuery.data?.models ?? []).filter((model) => !hiddenModelIds.includes(getModelKey(model))).length,
    [hiddenModelIds, promptOptionsQuery.data?.models],
  )

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <AppHeader
          title="Models"
          subtitle="Choose which host models stay visible in mobile composer pickers."
          onBack={onBack}
        />

        <View style={styles.noteCard}>
          <Text style={styles.noteLabel}>MODEL VISIBILITY</Text>
          <Text style={styles.noteText}>
            Hidden models stay available on the host, but they will be removed from mobile model pickers.
          </Text>
          <View style={styles.summaryBadge}>
            <Text style={styles.summaryBadgeText}>{enabledCount} enabled</Text>
          </View>
        </View>

        <View style={styles.searchShell}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
            placeholder="Search models"
            placeholderTextColor={theme.colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {promptOptionsQuery.isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={theme.colors.text} />
            <Text style={styles.stateText}>Loading model catalog from your host...</Text>
          </View>
        ) : promptOptionsQuery.isError ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>
              {promptOptionsQuery.error instanceof Error
                ? promptOptionsQuery.error.message
                : "Models could not be loaded right now."}
            </Text>
          </View>
        ) : groups.length ? (
          groups.map((group) => (
            <View key={group.providerID} style={styles.groupCard}>
              <Text style={styles.groupTitle}>{group.providerName}</Text>
              <View style={styles.modelList}>
                {group.models.map((model) => {
                  const enabled = !hiddenModelIds.includes(getModelKey(model))
                  return (
                    <View key={getModelKey(model)} style={styles.modelRow}>
                      <View style={styles.modelCopy}>
                        <Text style={styles.modelName}>{model.name}</Text>
                        <Text style={styles.modelMeta}>
                          {model.reasoningSupported ? "Reasoning" : "Standard"} · {model.variants.length || 1} variants
                        </Text>
                      </View>
                      <SettingToggle
                        value={enabled}
                        onPress={() => {
                          void setModelEnabled(getModelKey(model), !enabled)
                        }}
                      />
                    </View>
                  )
                })}
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.stateText}>No models match that search.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function getModelKey(model: Pick<PromptModelOption, "providerID" | "modelID">) {
  return `${model.providerID}/${model.modelID}`
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
    summaryBadge: {
      ...tagSurface(colors, "info"),
      alignSelf: "flex-start",
      minHeight: 28,
      paddingHorizontal: spacing.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    summaryBadgeText: {
      color: colors.info,
      fontSize: 11,
      fontWeight: "700",
      fontFamily: typography.mono,
    },
    searchShell: {
      ...inputSurface(colors, "surface"),
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    searchInput: {
      minHeight: 40,
      color: colors.text,
      fontSize: 14,
      paddingHorizontal: spacing.sm,
      fontFamily: typography.mono,
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
    groupCard: {
      ...cardSurface(colors),
      padding: spacing.lg,
      gap: spacing.sm,
    },
    groupTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "700",
    },
    modelList: {
      gap: spacing.sm,
    },
    modelRow: {
      ...cardSurface(colors, "surfaceMuted"),
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
    },
    modelCopy: {
      flex: 1,
      gap: 4,
    },
    modelName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "700",
    },
    modelMeta: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: typography.mono,
    },
  })
}
