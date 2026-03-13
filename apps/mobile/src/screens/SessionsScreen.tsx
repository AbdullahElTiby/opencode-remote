import { useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { HostInfo, SessionSummary, StreamEvent } from "@opencode-remote/shared"
import { BrandLockup } from "../components/BrandLockup"
import { buttonSurface, cardSurface, inputSurface, tagSurface } from "../design/primitives"
import { useAppTheme } from "../design/theme"
import { sessionStatusTone, spacing, typography, type ThemeColors } from "../design/tokens"
import { getHostInfo, getSessions, openStreamSocket } from "../lib/api"
import type { AuthSession } from "../state/auth-store"
import { useInboxStore } from "../state/inbox-store"

const UNKNOWN_PROJECT_KEY = "__unknown_project__"

type Props = {
  session: AuthSession
  onRefreshSession: (tokens: { deviceId: string; accessToken: string; refreshToken: string; expiresAt: string }) => Promise<void>
  onOpenSession: (sessionId: string) => void
  onOpenCreateProject: () => void
  onOpenSettings: () => void
  onLogout: () => Promise<void>
}

type ProjectSection = {
  key: string
  title: string
  directory: string | null
  latestUpdatedAt: string
  sessionCount: number
  activeCount: number
  approvalCount: number
  collapsed: boolean
  data: SessionSummary[]
}

export function SessionsScreen({
  session,
  onRefreshSession,
  onOpenSession,
  onOpenCreateProject,
  onOpenSettings,
  onLogout,
}: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})
  const queryClient = useQueryClient()
  const approvals = useInboxStore((state) => state.approvals)
  const upsertApproval = useInboxStore((state) => state.upsertApproval)
  const resolveApproval = useInboxStore((state) => state.resolveApproval)

  const hostQuery = useQuery<HostInfo>({
    queryKey: ["host"],
    queryFn: () => getHostInfo(session, onRefreshSession),
  })

  const sessionsQuery = useQuery<SessionSummary[]>({
    queryKey: ["sessions"],
    queryFn: () => getSessions(session, onRefreshSession),
  })

  useEffect(() => {
    const socket = openStreamSocket(session, {
      onMessage(event: StreamEvent) {
        if (event.kind === "host.status") {
          queryClient.setQueryData(["host"], event.payload)
        }
        if (event.kind === "session.approval_requested") {
          upsertApproval({
            sessionId: event.payload.sessionId,
            permissionId: event.payload.permissionId,
            permission: event.payload.permission,
            patterns: event.payload.patterns,
          })
        }
        if (event.kind === "session.approval_resolved") {
          resolveApproval(event.payload.permissionId)
        }
        if (event.kind === "session.snapshot") {
          queryClient.setQueryData<SessionSummary[]>(["sessions"], (current = []) => {
            const next = [...current]
            const index = next.findIndex((item) => item.id === event.payload.id)
            if (index >= 0) next[index] = event.payload
            else next.unshift(event.payload)
            return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          })
        }
      },
    })
    return () => socket.close()
  }, [onRefreshSession, queryClient, resolveApproval, session, upsertApproval])

  const approvalsBySession = useMemo(() => {
    const map = new Map<string, number>()
    for (const approval of approvals) {
      map.set(approval.sessionId, (map.get(approval.sessionId) ?? 0) + 1)
    }
    return map
  }, [approvals])

  const searchValue = searchQuery.trim().toLowerCase()
  const searchActive = searchValue.length > 0
  const allSessions = sessionsQuery.data ?? []

  const projectCount = useMemo(() => {
    const keys = new Set<string>()
    for (const item of allSessions) {
      keys.add(getProjectKey(item.directory))
    }
    return keys.size
  }, [allSessions])

  const projectSections = useMemo(() => {
    const grouped = new Map<
      string,
      {
        directory: string | null
        sessions: SessionSummary[]
        latestUpdatedAt: string
      }
    >()

    for (const item of allSessions) {
      if (searchActive && !matchesSession(item, searchValue)) continue

      const key = getProjectKey(item.directory)
      const current = grouped.get(key)
      if (current) {
        current.sessions.push(item)
        if (item.updatedAt > current.latestUpdatedAt) current.latestUpdatedAt = item.updatedAt
      } else {
        grouped.set(key, {
          directory: item.directory ?? null,
          sessions: [item],
          latestUpdatedAt: item.updatedAt,
        })
      }
    }

    return Array.from(grouped.entries())
      .map<ProjectSection>(([key, group]) => {
        const sessions = [...group.sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        const activeCount = sessions.filter((item) => item.status.type !== "idle").length
        const approvalCount = sessions.reduce((total, item) => total + (approvalsBySession.get(item.id) ?? 0), 0)
        const collapsed = searchActive ? false : !(expandedProjects[key] ?? false)

        return {
          key,
          title: getProjectTitle(group.directory),
          directory: group.directory,
          latestUpdatedAt: group.latestUpdatedAt,
          sessionCount: sessions.length,
          activeCount,
          approvalCount,
          collapsed,
          data: collapsed ? [] : sessions,
        }
      })
      .sort((left, right) => right.latestUpdatedAt.localeCompare(left.latestUpdatedAt))
  }, [allSessions, approvalsBySession, expandedProjects, searchActive, searchValue])

  const activeSessionCount = useMemo(
    () => allSessions.filter((item) => item.status.type !== "idle").length,
    [allSessions],
  )

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionList
        sections={projectSections}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={sessionsQuery.isFetching}
            onRefresh={() => sessionsQuery.refetch()}
            tintColor={theme.colors.text}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerStack}>
            <View style={styles.hero}>
              <View style={styles.heroTopRow}>
                <BrandLockup caption="Remote session control built around the OpenCode workflow." />
                <View style={styles.heroActions}>
                  <HeaderChip label="New project" onPress={onOpenCreateProject} />
                  <HeaderChip label="Settings" onPress={onOpenSettings} />
                  <HeaderChip label="Logout" onPress={onLogout} subtle />
                </View>
              </View>

              <View style={styles.heroGrid}>
                <View style={styles.metaBlock}>
                  <Text style={styles.metaLabel}>HOST</Text>
                  <Text style={styles.metaValue}>{hostQuery.data?.hostName ?? "Connecting..."}</Text>
                  <Text style={styles.metaHint}>{session.serverUrl}</Text>
                </View>
                <View style={styles.metaBlock}>
                  <Text style={styles.metaLabel}>STACK</Text>
                  <Text style={styles.metaValue}>
                    {hostQuery.data?.opencodeReachable ? "OpenCode reachable" : "Gateway only"}
                  </Text>
                  <Text style={styles.metaHint}>
                    {hostQuery.data?.opencodeVersion ? `v${hostQuery.data.opencodeVersion}` : "Version unknown"}
                  </Text>
                </View>
              </View>
            </View>

            {approvals.length > 0 ? (
              <Pressable style={styles.alertStrip} onPress={() => onOpenSession(approvals[0].sessionId)}>
                <Text style={styles.alertLabel}>APPROVALS</Text>
                <Text style={styles.alertText}>
                  {approvals.length} approval {approvals.length === 1 ? "request" : "requests"} waiting for review
                </Text>
              </Pressable>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Projects</Text>
              <Text style={styles.sectionMeta}>
                {allSessions.length} sessions | {projectCount} projects | {activeSessionCount} active
              </Text>
            </View>

            <View style={styles.searchShell}>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={styles.searchInput}
                placeholder="Search sessions, paths, slugs..."
                placeholderTextColor={theme.colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
              {searchActive ? (
                <Pressable style={styles.searchClear} onPress={() => setSearchQuery("")}>
                  <Text style={styles.searchClearText}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.empty}>
              {searchActive
                ? "No sessions match that search."
                : "No sessions yet. Create your first project from the phone or start one from OpenCode on your host."}
            </Text>
            {!searchActive ? (
              <Pressable style={styles.emptyButton} onPress={onOpenCreateProject}>
                <Text style={styles.emptyButtonText}>Create new project</Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => {
          const isOpen = !section.collapsed

          return (
            <Pressable
              style={styles.projectHeader}
              onPress={() => {
                if (searchActive) return
                setExpandedProjects((current) => ({
                  ...current,
                  [section.key]: !isOpen,
                }))
              }}
            >
              <View style={styles.projectHeaderTop}>
                <View style={styles.projectHeading}>
                  <Text style={styles.projectTitle} numberOfLines={1}>
                    {section.title}
                  </Text>
                  <Text style={styles.projectPath} numberOfLines={2}>
                    {section.directory ?? "Unknown project directory"}
                  </Text>
                </View>
                <View style={styles.projectHeaderChips}>
                  {section.activeCount > 0 ? <Badge label={`${section.activeCount} active`} tone="warning" /> : null}
                  <Badge label={searchActive ? "MATCHES" : isOpen ? "OPEN" : "CLOSED"} subtle />
                </View>
              </View>

              <View style={styles.projectMetaRow}>
                <Text style={styles.projectMetaText}>
                  {section.sessionCount} {section.sessionCount === 1 ? "session" : "sessions"} |{" "}
                  {formatTimestamp(section.latestUpdatedAt)}
                </Text>
                {section.approvalCount > 0 ? (
                  <Text style={styles.projectMetaText}>
                    {section.approvalCount} approval{section.approvalCount === 1 ? "" : "s"}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          )
        }}
        renderItem={({ item }) => {
          const statusTone = sessionStatusTone(theme.colors, item.status.type)
          const approvalCount = approvalsBySession.get(item.id) ?? 0

          return (
            <View style={styles.projectSessionSlot}>
              <View style={styles.projectSessionRail} />
              <Pressable style={styles.sessionRow} onPress={() => onOpenSession(item.id)}>
                <View style={styles.sessionTopRow}>
                  <View style={styles.sessionHeading}>
                    <Text style={styles.sessionTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.sessionPath} numberOfLines={1}>
                      {item.slug ?? item.id}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusChip,
                      { backgroundColor: statusTone.backgroundColor, borderColor: statusTone.borderColor },
                    ]}
                  >
                    <Text style={[styles.statusChipText, { color: statusTone.textColor }]}>{item.status.type}</Text>
                  </View>
                </View>

                <View style={styles.sessionMetaRow}>
                  <Text style={styles.sessionMetaText}>{formatTimestamp(item.updatedAt)}</Text>
                  {item.summary ? (
                    <Text style={styles.sessionMetaText}>
                      {item.summary.files} files | +{item.summary.additions} / -{item.summary.deletions}
                    </Text>
                  ) : (
                    <Text style={styles.sessionMetaText}>No diff summary yet</Text>
                  )}
                </View>

                <View style={styles.badgeRow}>
                  {item.hasTui ? <Badge label="TUI" /> : <Badge label="API" subtle />}
                  {approvalCount > 0 ? <Badge label={`${approvalCount} approvals`} tone="warning" /> : null}
                  {item.slug ? <Badge label={item.slug} subtle /> : null}
                </View>
              </Pressable>
            </View>
          )
        }}
        renderSectionFooter={() => <View style={styles.projectFooterGap} />}
      />
    </SafeAreaView>
  )
}

function getProjectKey(directory: string | null | undefined) {
  const normalized = directory?.trim()
  return normalized ? normalized : UNKNOWN_PROJECT_KEY
}

function getProjectTitle(directory: string | null | undefined) {
  if (!directory) return "Unknown project"
  const normalized = directory.replace(/[\\/]+$/, "")
  const parts = normalized.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? directory
}

function matchesSession(item: SessionSummary, query: string) {
  const haystack = [
    item.title,
    item.directory ?? "",
    item.slug ?? "",
    item.id,
    item.status.type,
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(query)
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function HeaderChip({ label, onPress, subtle = false }: { label: string; onPress: () => void; subtle?: boolean }) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <Pressable style={[styles.headerChip, subtle && styles.headerChipSubtle]} onPress={onPress}>
      <Text style={styles.headerChipText}>{label}</Text>
    </Pressable>
  )
}

function Badge({
  label,
  tone = "default",
  subtle = false,
}: {
  label: string
  tone?: "default" | "warning"
  subtle?: boolean
}) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <View
      style={[
        styles.badge,
        subtle && styles.badgeSubtle,
        tone === "warning" && styles.badgeWarning,
      ]}
    >
      <Text style={[styles.badgeText, tone === "warning" && styles.badgeWarningText]}>{label}</Text>
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.app,
    },
    list: {
      flex: 1,
      backgroundColor: colors.app,
    },
    listContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    headerStack: {
      paddingTop: spacing.sm,
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    hero: {
      ...cardSurface(colors),
      padding: spacing.lg,
      gap: spacing.lg,
    },
    heroTopRow: {
      gap: spacing.md,
    },
    heroActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    heroGrid: {
      gap: spacing.sm,
    },
    metaBlock: {
      ...cardSurface(colors, "surfaceMuted"),
      padding: spacing.md,
      gap: 4,
    },
    metaLabel: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    metaValue: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
    },
    metaHint: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    headerChip: {
      ...buttonSurface(colors, "panelStrong"),
      minHeight: 38,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    headerChipSubtle: {
      ...buttonSurface(colors, "surfaceMuted"),
    },
    headerChipText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
    },
    alertStrip: {
      ...cardSurface(colors, "warning"),
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      gap: 4,
    },
    alertLabel: {
      color: colors.warning,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    alertText: {
      color: colors.text,
      fontWeight: "700",
    },
    sectionHeader: {
      gap: 4,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "700",
    },
    sectionMeta: {
      color: colors.textDim,
      fontSize: 12,
      fontFamily: typography.mono,
    },
    searchShell: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      ...inputSurface(colors, "surface"),
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    searchInput: {
      flex: 1,
      minHeight: 40,
      color: colors.text,
      fontSize: 14,
      paddingHorizontal: spacing.sm,
      fontFamily: typography.mono,
    },
    searchClear: {
      ...buttonSurface(colors, "panelStrong"),
      minHeight: 32,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    searchClearText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "700",
    },
    projectHeader: {
      ...cardSurface(colors),
      padding: spacing.md,
      gap: spacing.sm,
    },
    projectHeaderTop: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    projectHeading: {
      flex: 1,
      gap: 4,
    },
    projectTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
    },
    projectPath: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      fontFamily: typography.mono,
    },
    projectHeaderChips: {
      alignItems: "flex-end",
      gap: spacing.xs,
    },
    projectMetaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    projectMetaText: {
      color: colors.textDim,
      fontSize: 12,
      fontFamily: typography.mono,
    },
    projectSessionSlot: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: spacing.sm,
      marginLeft: spacing.md,
    },
    projectSessionRail: {
      width: 1,
      alignSelf: "stretch",
      backgroundColor: colors.border,
      opacity: 0.7,
    },
    sessionRow: {
      flex: 1,
      ...cardSurface(colors, "surfaceMuted"),
      padding: spacing.md,
      gap: spacing.sm,
    },
    sessionTopRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    sessionHeading: {
      flex: 1,
      gap: 4,
    },
    sessionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
    },
    sessionPath: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
      fontFamily: typography.mono,
    },
    statusChip: {
      ...tagSurface(colors, "panelStrong"),
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    statusChipText: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    sessionMetaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    sessionMetaText: {
      color: colors.textDim,
      fontSize: 12,
      fontFamily: typography.mono,
    },
    badgeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    badge: {
      ...tagSurface(colors, "panelStrong"),
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
    },
    badgeSubtle: {
      ...tagSurface(colors, "surface"),
    },
    badgeWarning: {
      backgroundColor: colors.warningSurface,
      borderColor: "#9d7b44",
    },
    badgeText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: "700",
      fontFamily: typography.mono,
    },
    badgeWarningText: {
      color: colors.warning,
    },
    projectFooterGap: {
      height: spacing.md,
    },
    empty: {
      color: colors.textDim,
      textAlign: "center",
      paddingTop: spacing.xxl,
      lineHeight: 22,
    },
    emptyState: {
      alignItems: "center",
      gap: spacing.md,
      paddingTop: spacing.xxl,
    },
    emptyButton: {
      ...buttonSurface(colors, "accent"),
      minHeight: 42,
      paddingHorizontal: spacing.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyButtonText: {
      color: colors.textOnAccent,
      fontWeight: "800",
    },
  })
}
