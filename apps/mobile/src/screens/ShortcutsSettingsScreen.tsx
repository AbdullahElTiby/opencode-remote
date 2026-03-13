import { useMemo } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useQuery } from "@tanstack/react-query"
import type { CommandListResponse, CommandSource } from "@opencode-remote/shared"
import { AppHeader } from "../components/AppHeader"
import { useAppTheme } from "../design/theme"
import { cardSurface, tagSurface } from "../design/primitives"
import { spacing, typography, type ThemeColors } from "../design/tokens"
import { getCommands } from "../lib/api"
import type { AuthSession } from "../state/auth-store"

type Props = {
  auth: AuthSession
  onRefreshSession: (tokens: { deviceId: string; accessToken: string; refreshToken: string; expiresAt: string }) => Promise<void>
  onBack: () => void
}

type ShortcutItem = {
  label: string
  description: string
}

const MOBILE_ACTIONS: ShortcutItem[] = [
  { label: "Terminal", description: "Open the attached terminal for the current session when available." },
  { label: "Actions", description: "Resume, retry, or abort the active run from the session header." },
  { label: "Details", description: "Reveal todo and diff panels only when you need them." },
  { label: "Options", description: "Change agent, model, and reasoning effort without expanding the full composer." },
  { label: "New project", description: "Create and open a project anywhere on the host directly from mobile." },
]

const LOCAL_SLASH_COMMANDS: ShortcutItem[] = [
  { label: "/help", description: "Open the slash-command menu and filter available commands." },
  { label: "/models", description: "Jump straight into model selection for the next message." },
  { label: "/agents", description: "Open agent selection without leaving the transcript." },
  { label: "/status", description: "Refresh the current session and show the latest session status." },
  { label: "/timestamps", description: "Toggle transcript timestamps in the mobile session view." },
  { label: "/thinking", description: "Toggle reasoning snippets in the session transcript." },
  { label: "/sessions", description: "Return to the projects list without using the header back button." },
  { label: "/theme", description: "Open Settings when you want appearance controls." },
]

export function ShortcutsSettingsScreen({ auth, onRefreshSession, onBack }: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const commandsQuery = useQuery<CommandListResponse>({
    queryKey: ["commands"],
    queryFn: () => getCommands(auth, onRefreshSession),
    staleTime: 60_000,
  })

  const commandGroups = useMemo(() => {
    const grouped = new Map<CommandSource, CommandListResponse[number][]>()

    for (const command of commandsQuery.data ?? []) {
      const current = grouped.get(command.source)
      if (current) current.push(command)
      else grouped.set(command.source, [command])
    }

    return Array.from(grouped.entries())
      .map(([source, commands]) => ({
        source,
        commands: [...commands].sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => formatSourceTitle(left.source).localeCompare(formatSourceTitle(right.source)))
  }, [commandsQuery.data])

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <AppHeader
          title="Shortcuts"
          subtitle="Mobile quick actions plus the real slash commands currently exposed by your host."
          onBack={onBack}
        />

        <View style={styles.noteCard}>
          <Text style={styles.noteLabel}>MOBILE FIRST</Text>
          <Text style={styles.noteText}>
            The mobile companion does not use desktop keyboard shortcuts. These are the fast mobile actions and slash commands that replace them.
          </Text>
        </View>

        <ShortcutSection title="Session actions" items={MOBILE_ACTIONS} />
        <ShortcutSection title="Local slash commands" items={LOCAL_SLASH_COMMANDS} />

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Host slash commands</Text>
            <View style={styles.sectionBadge}>
              <Text style={styles.sectionBadgeText}>
                {commandsQuery.data?.length ?? 0} available
              </Text>
            </View>
          </View>
          <Text style={styles.sectionBody}>
            These commands come from your OpenCode host and match what the session slash menu can execute right now.
          </Text>

          {commandsQuery.isLoading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={theme.colors.text} />
              <Text style={styles.stateText}>Loading commands from your host...</Text>
            </View>
          ) : commandsQuery.isError ? (
            <View style={styles.centerState}>
              <Text style={styles.errorText}>
                {commandsQuery.error instanceof Error
                  ? commandsQuery.error.message
                  : "Commands could not be loaded right now."}
              </Text>
            </View>
          ) : commandGroups.length ? (
            <View style={styles.commandGroupStack}>
              {commandGroups.map((group) => (
                <View key={group.source} style={styles.commandGroup}>
                  <Text style={styles.groupTitle}>{formatSourceTitle(group.source)}</Text>
                  {group.commands.map((command) => (
                    <View key={`${group.source}-${command.name}`} style={styles.commandRow}>
                      <View style={styles.commandCopy}>
                        <Text style={styles.commandName}>/{command.name}</Text>
                        {command.description ? <Text style={styles.commandDescription}>{command.description}</Text> : null}
                        {command.aliases.length ? (
                          <Text style={styles.commandMeta}>Aliases: {command.aliases.map((alias) => `/${alias}`).join(", ")}</Text>
                        ) : null}
                        {command.hints.length ? (
                          <Text style={styles.commandMeta}>{command.hints.join(" ")}</Text>
                        ) : null}
                      </View>
                      <View style={styles.sourceBadge}>
                        <Text style={styles.sourceBadgeText}>{group.source}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.stateText}>No slash commands are currently available from the host.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ShortcutSection({ title, items }: { title: string; items: ShortcutItem[] }) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.shortcutList}>
        {items.map((item) => (
          <View key={item.label} style={styles.shortcutRow}>
            <View style={styles.shortcutBadge}>
              <Text style={styles.shortcutBadgeText}>{item.label}</Text>
            </View>
            <Text style={styles.shortcutDescription}>{item.description}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function formatSourceTitle(source: CommandSource) {
  switch (source) {
    case "built-in":
      return "Built-in"
    case "command":
      return "Command"
    case "mcp":
      return "MCP"
    case "skill":
      return "Skill"
    default:
      return source
  }
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
    sectionCard: {
      ...cardSurface(colors),
      padding: spacing.lg,
      gap: spacing.md,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "700",
      flex: 1,
    },
    sectionBody: {
      color: colors.textMuted,
      lineHeight: 22,
    },
    sectionBadge: {
      ...tagSurface(colors, "info"),
      paddingHorizontal: spacing.sm,
      minHeight: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    sectionBadgeText: {
      color: colors.info,
      fontSize: 11,
      fontWeight: "700",
      fontFamily: typography.mono,
    },
    shortcutList: {
      gap: spacing.sm,
    },
    shortcutRow: {
      ...cardSurface(colors, "surfaceMuted"),
      padding: spacing.md,
      gap: spacing.sm,
    },
    shortcutBadge: {
      ...tagSurface(colors, "panelStrong"),
      alignSelf: "flex-start",
      paddingHorizontal: spacing.sm,
      minHeight: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    shortcutBadgeText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "700",
      fontFamily: typography.mono,
    },
    shortcutDescription: {
      color: colors.textMuted,
      lineHeight: 21,
    },
    centerState: {
      ...cardSurface(colors, "surfaceMuted"),
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
    commandGroupStack: {
      gap: spacing.md,
    },
    commandGroup: {
      gap: spacing.sm,
    },
    groupTitle: {
      color: colors.textDim,
      fontSize: 12,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    commandRow: {
      ...cardSurface(colors, "surfaceMuted"),
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
      padding: spacing.md,
    },
    commandCopy: {
      flex: 1,
      gap: 4,
    },
    commandName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "700",
      fontFamily: typography.mono,
    },
    commandDescription: {
      color: colors.textMuted,
      lineHeight: 20,
    },
    commandMeta: {
      color: colors.textDim,
      fontSize: 11,
      lineHeight: 18,
      fontFamily: typography.mono,
    },
    sourceBadge: {
      ...tagSurface(colors, "panelStrong"),
      paddingHorizontal: spacing.sm,
      minHeight: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    sourceBadgeText: {
      color: colors.text,
      fontSize: 10,
      fontWeight: "700",
      fontFamily: typography.mono,
      textTransform: "uppercase",
    },
  })
}
