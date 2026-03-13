import { useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { SessionSummary } from "@opencode-remote/shared"
import { AppHeader } from "../components/AppHeader"
import { buttonSurface, cardSurface, inputSurface, tagSurface } from "../design/primitives"
import { useAppTheme } from "../design/theme"
import { spacing, typography, type ThemeColors } from "../design/tokens"
import { createProject, getSessions } from "../lib/api"
import type { AuthSession } from "../state/auth-store"

type Props = {
  auth: AuthSession
  onRefreshSession: (tokens: { deviceId: string; accessToken: string; refreshToken: string; expiresAt: string }) => Promise<void>
  selectedParentPath: string | null
  onClearSelectedParentPath: () => void
  onBrowseParent: (currentPath: string | null) => void
  onBack: () => void
  onProjectCreated: (sessionId: string, notice: string) => void
}

type CreateMode = "guided" | "manual"

const INVALID_PROJECT_NAME_PATTERN = /[<>:"/\\|?*\u0000]/

export function CreateProjectScreen({
  auth,
  onRefreshSession,
  selectedParentPath,
  onClearSelectedParentPath,
  onBrowseParent,
  onBack,
  onProjectCreated,
}: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<CreateMode>("guided")
  const [parentPath, setParentPath] = useState<string | null>(selectedParentPath)
  const [projectName, setProjectName] = useState("")
  const [manualPath, setManualPath] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sessionsQuery = useQuery<SessionSummary[]>({
    queryKey: ["sessions"],
    queryFn: () => getSessions(auth, onRefreshSession),
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!selectedParentPath) return
    setParentPath(selectedParentPath)
    setMode("guided")
    setError(null)
    onClearSelectedParentPath()
  }, [onClearSelectedParentPath, selectedParentPath])

  const recentFolders = useMemo(() => {
    const seen = new Set<string>()
    const folders: string[] = []

    for (const item of sessionsQuery.data ?? []) {
      const directory = item.directory?.trim()
      if (!directory || seen.has(directory)) continue
      seen.add(directory)
      folders.push(directory)
      if (folders.length >= 6) break
    }

    return folders
  }, [sessionsQuery.data])

  const guidedPreviewPath = useMemo(() => {
    const trimmedName = projectName.trim()
    if (!parentPath || !trimmedName) return null
    return joinTargetPath(parentPath, trimmedName)
  }, [parentPath, projectName])

  async function handleCreateProject() {
    setSubmitting(true)
    try {
      const targetDirectory = mode === "guided" ? validateGuidedTarget(parentPath, projectName) : validateManualTarget(manualPath)

      setError(null)
      const created = await createProject(
        auth,
        {
          directory: targetDirectory,
        },
        onRefreshSession,
      )

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["host"] }),
      ])

      onProjectCreated(
        created.sessionId,
        created.createdDirectory
          ? `Created and opened ${created.directory}.`
          : `Opened a new session in ${created.directory}.`,
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The project could not be created right now.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <AppHeader title="New project" subtitle="Create and open a project anywhere on this PC." onBack={onBack} />

        <View style={styles.modeRow}>
          <ModeChip
            label="Guided"
            selected={mode === "guided"}
            onPress={() => {
              setMode("guided")
              setError(null)
            }}
          />
          <ModeChip
            label="Manual path"
            selected={mode === "manual"}
            onPress={() => {
              setMode("manual")
              setError(null)
            }}
          />
        </View>

        {mode === "guided" ? (
          <View style={styles.card}>
            <Text style={styles.kicker}>GUIDED CREATE</Text>
            <Text style={styles.title}>Choose a parent folder</Text>
            <Text style={styles.body}>
              Pick the parent location on your PC, then enter the new project folder name.
            </Text>

            <View style={styles.pathBox}>
              <Text style={styles.pathLabel}>Parent folder</Text>
              <Text style={styles.pathValue}>{parentPath ?? "No folder selected yet"}</Text>
            </View>

            <Pressable
              style={styles.actionButton}
              onPress={() => onBrowseParent(parentPath)}
            >
              <Text style={styles.actionButtonText}>{parentPath ? "Browse another folder" : "Browse folder"}</Text>
            </Pressable>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Project folder name</Text>
              <TextInput
                value={projectName}
                onChangeText={(value) => {
                  setProjectName(value)
                  setError(null)
                }}
                style={styles.input}
                placeholder="my-new-project"
                placeholderTextColor={theme.colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.pathBox}>
              <Text style={styles.pathLabel}>Target directory</Text>
              <Text style={styles.pathValue}>{guidedPreviewPath ?? "Choose a parent folder and project name."}</Text>
            </View>

            {recentFolders.length ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Recent folders</Text>
                <View style={styles.recentRow}>
                  {recentFolders.map((directory) => (
                    <Pressable
                      key={directory}
                      style={styles.recentChip}
                      onPress={() => {
                        setParentPath(directory)
                        setError(null)
                      }}
                    >
                      <Text style={styles.recentChipText} numberOfLines={1}>
                        {directory}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.kicker}>MANUAL PATH</Text>
            <Text style={styles.title}>Type the full PC path</Text>
            <Text style={styles.body}>
              Use an absolute Windows path such as <Text style={styles.inlineCode}>D:\Code\MyNewApp</Text>.
            </Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Target directory</Text>
              <TextInput
                value={manualPath}
                onChangeText={(value) => {
                  setManualPath(value)
                  setError(null)
                }}
                style={[styles.input, styles.multilineInput]}
                placeholder="D:\\Code\\MyNewApp"
                placeholderTextColor={theme.colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />
            </View>

            {recentFolders.length ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Recent folders</Text>
                <View style={styles.recentRow}>
                  {recentFolders.map((directory) => (
                    <Pressable
                      key={directory}
                      style={styles.recentChip}
                      onPress={() => {
                        setManualPath(directory)
                        setError(null)
                      }}
                    >
                      <Text style={styles.recentChipText} numberOfLines={1}>
                        {directory}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          style={[styles.submitButton, submitting && styles.buttonDisabled]}
          disabled={submitting}
          onPress={() => {
            void handleCreateProject()
          }}
        >
          <Text style={styles.submitButtonText}>{submitting ? "Creating..." : "Create and open"}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

function ModeChip({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <Pressable
      style={[styles.modeChip, selected && styles.modeChipSelected]}
      onPress={onPress}
    >
      <Text style={[styles.modeChipText, selected && styles.modeChipTextSelected]}>{label}</Text>
    </Pressable>
  )
}

function validateGuidedTarget(parentPath: string | null, projectName: string) {
  if (!parentPath) {
    throw new Error("Choose the parent folder on your PC first.")
  }

  const trimmedName = projectName.trim()
  if (!trimmedName) {
    throw new Error("Enter the new project folder name.")
  }

  if (trimmedName === "." || trimmedName === "..") {
    throw new Error("Choose a different project folder name.")
  }

  if (INVALID_PROJECT_NAME_PATTERN.test(trimmedName)) {
    throw new Error("Project folder names cannot include Windows path characters.")
  }

  return joinTargetPath(parentPath, trimmedName)
}

function validateManualTarget(manualPath: string) {
  const trimmedPath = manualPath.trim()
  if (!trimmedPath) {
    throw new Error("Enter the full project path on your PC.")
  }

  return trimmedPath
}

function joinTargetPath(parentPath: string, projectName: string) {
  const trimmedParent = parentPath.replace(/[\\/]+$/, "")
  if (!trimmedParent) {
    return `\\${projectName}`
  }

  return `${trimmedParent}\\${projectName}`
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
    modeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    modeChip: {
      ...buttonSurface(colors, "surface"),
      minHeight: 40,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    modeChipSelected: {
      borderColor: colors.borderStrong,
      backgroundColor: colors.panelStrong,
    },
    modeChipText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: "700",
      fontFamily: typography.mono,
    },
    modeChipTextSelected: {
      color: colors.text,
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
    title: {
      color: colors.text,
      fontSize: 22,
      fontWeight: "700",
    },
    body: {
      color: colors.textMuted,
      lineHeight: 22,
    },
    inlineCode: {
      fontFamily: typography.mono,
      color: colors.text,
    },
    pathBox: {
      ...cardSurface(colors, "surfaceMuted"),
      padding: spacing.md,
      gap: spacing.xs,
    },
    pathLabel: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    pathValue: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 21,
      fontFamily: typography.mono,
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
    fieldGroup: {
      gap: spacing.sm,
    },
    fieldLabel: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    input: {
      minHeight: 50,
      ...inputSurface(colors, "surfaceMuted"),
      color: colors.text,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 15,
    },
    multilineInput: {
      minHeight: 96,
      textAlignVertical: "top",
    },
    recentRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    recentChip: {
      maxWidth: "100%",
      ...tagSurface(colors, "surfaceMuted"),
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
    },
    recentChipText: {
      color: colors.text,
      fontSize: 12,
      fontFamily: typography.mono,
    },
    errorText: {
      color: colors.danger,
      fontSize: 13,
      lineHeight: 20,
      paddingHorizontal: 4,
    },
    submitButton: {
      ...buttonSurface(colors, "accent"),
      minHeight: 50,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    submitButtonText: {
      color: colors.textOnAccent,
      fontSize: 15,
      fontWeight: "800",
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  })
}
