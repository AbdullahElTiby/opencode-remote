import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useQuery } from "@tanstack/react-query"
import type { ProjectDirectoryBrowseResponse } from "@opencode-remote/shared"
import { AppHeader } from "../components/AppHeader"
import { buttonSurface, cardSurface } from "../design/primitives"
import { useAppTheme } from "../design/theme"
import { spacing, typography, type ThemeColors } from "../design/tokens"
import { browseProjectDirectories } from "../lib/api"
import type { AuthSession } from "../state/auth-store"

type Props = {
  auth: AuthSession
  onRefreshSession: (tokens: { deviceId: string; accessToken: string; refreshToken: string; expiresAt: string }) => Promise<void>
  initialPath?: string | null
  onBack: () => void
  onSelectParent: (path: string) => void
}

export function DirectoryBrowserScreen({
  auth,
  onRefreshSession,
  initialPath,
  onBack,
  onSelectParent,
}: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const [currentPath, setCurrentPath] = useState<string | null>(initialPath ?? null)

  useEffect(() => {
    setCurrentPath(initialPath ?? null)
  }, [initialPath])

  const directoryQuery = useQuery<ProjectDirectoryBrowseResponse>({
    queryKey: ["project-directories", currentPath ?? "__roots__"],
    queryFn: () => browseProjectDirectories(auth, onRefreshSession, currentPath),
  })

  const canSelectCurrentFolder = Boolean(directoryQuery.data?.currentPath)

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <AppHeader
          title="Browse folders"
          subtitle={directoryQuery.data?.currentPath ?? "This PC"}
          onBack={onBack}
        />

        <View style={styles.card}>
          <Text style={styles.kicker}>CURRENT LOCATION</Text>
          <Text style={styles.currentPath}>{directoryQuery.data?.currentPath ?? "Choose a drive to start browsing."}</Text>

          <View style={styles.actionRow}>
            {directoryQuery.data?.parentPath ? (
              <Pressable
                style={styles.actionButton}
                onPress={() => {
                  setCurrentPath(directoryQuery.data?.parentPath ?? null)
                }}
              >
                <Text style={styles.actionButtonText}>Up one level</Text>
              </Pressable>
            ) : null}

            {currentPath ? (
              <Pressable
                style={styles.ghostButton}
                onPress={() => {
                  setCurrentPath(null)
                }}
              >
                <Text style={styles.ghostButtonText}>Browse roots</Text>
              </Pressable>
            ) : null}

            {canSelectCurrentFolder ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  if (directoryQuery.data?.currentPath) {
                    onSelectParent(directoryQuery.data.currentPath)
                  }
                }}
              >
                <Text style={styles.primaryButtonText}>Use this folder</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.kicker}>{currentPath ? "SUBFOLDERS" : "DRIVES"}</Text>

          {directoryQuery.isLoading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={theme.colors.text} />
              <Text style={styles.stateText}>Loading folders from your PC...</Text>
            </View>
          ) : directoryQuery.isError ? (
            <View style={styles.centerState}>
              <Text style={styles.errorText}>
                {directoryQuery.error instanceof Error ? directoryQuery.error.message : "The folder list could not be loaded."}
              </Text>
              <Pressable style={styles.actionButton} onPress={() => void directoryQuery.refetch()}>
                <Text style={styles.actionButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : directoryQuery.data?.entries.length ? (
            <View style={styles.directoryList}>
              {directoryQuery.data.entries.map((entry) => (
                <Pressable
                  key={entry.path}
                  style={styles.directoryRow}
                  onPress={() => {
                    setCurrentPath(entry.path)
                  }}
                >
                  <View style={styles.directoryCopy}>
                    <Text style={styles.directoryName}>{entry.name}</Text>
                    <Text style={styles.directoryPath}>{entry.path}</Text>
                  </View>
                  <Text style={styles.directoryArrow}>{">"}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.stateText}>No subfolders are available here.</Text>
          )}
        </View>
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
    card: {
      ...cardSurface(colors),
      padding: spacing.lg,
      gap: spacing.md,
    },
    kicker: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    currentPath: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 22,
      fontFamily: typography.mono,
    },
    actionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    actionButton: {
      ...buttonSurface(colors, "panelStrong"),
      minHeight: 42,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    actionButtonText: {
      color: colors.text,
      fontWeight: "700",
    },
    ghostButton: {
      ...buttonSurface(colors, "surfaceMuted"),
      minHeight: 42,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    ghostButtonText: {
      color: colors.text,
      fontWeight: "700",
    },
    primaryButton: {
      ...buttonSurface(colors, "accent"),
      minHeight: 42,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      color: colors.textOnAccent,
      fontWeight: "800",
    },
    centerState: {
      ...cardSurface(colors, "surfaceMuted"),
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.lg,
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
    directoryList: {
      gap: spacing.sm,
    },
    directoryRow: {
      ...cardSurface(colors, "surfaceMuted"),
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
    },
    directoryCopy: {
      flex: 1,
      gap: 4,
    },
    directoryName: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
    },
    directoryPath: {
      color: colors.textDim,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: typography.mono,
    },
    directoryArrow: {
      color: colors.textMuted,
      fontSize: 18,
      fontWeight: "700",
    },
  })
}
