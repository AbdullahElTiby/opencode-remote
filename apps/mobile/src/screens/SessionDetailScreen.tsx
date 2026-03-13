import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewProps,
} from "react-native"
import { useQuery } from "@tanstack/react-query"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { CommandSummary, PromptModelOption, SessionDetail, StreamEvent } from "@opencode-remote/shared"
import { AppHeader } from "../components/AppHeader"
import { BrandLockup } from "../components/BrandLockup"
import { SelectionModal } from "../components/SelectionModal"
import { buttonSurface, cardSurface, tagSurface } from "../design/primitives"
import { useAppTheme } from "../design/theme"
import {
  commandSourceTone,
  sessionStatusTone,
  spacing,
  typography,
  type ThemeColors,
} from "../design/tokens"
import {
  getCommands,
  getPromptOptions,
  getSessionDetail,
  openStreamSocket,
  sendCommand,
  sendControl,
  sendPrompt,
} from "../lib/api"
import type { AuthSession } from "../state/auth-store"
import { useAppPreferencesStore } from "../state/app-preferences-store"
import { emptyComposerPreference, useComposerStore } from "../state/composer-store"
import { useInboxStore } from "../state/inbox-store"

type Props = {
  auth: AuthSession
  sessionId: string
  initialNotice?: string | null
  onRefreshSession: (tokens: { deviceId: string; accessToken: string; refreshToken: string; expiresAt: string }) => Promise<void>
  onOpenTerminal: (sessionId: string) => void
  onOpenSessions: () => void
  onOpenSettings: () => void
  onOpenSession: (sessionId: string) => void
}

type ApprovalRequest = {
  permissionId: string
  permission: string
  patterns: string[]
}

type ChatMessage = {
  id: string
  role: "user" | "assistant" | "reasoning"
  text: string
  createdAt: number | null
}

type TodoEntry = {
  id: string
  content: string
  status: string | null
  priority: string | null
}

type DiffEntry = {
  id: string
  file: string
  status: string | null
  additions: number | null
  deletions: number | null
}

type ToolActivityCategory = "shell" | "edit"

type ToolActivityEntry = {
  id: string
  category: ToolActivityCategory
  sourceType: string
  preview: string
  detail: string
  createdAt: number
}

type PickerType = "agent" | "model" | "variant" | "actions" | null

type SlashDraft = {
  commandText: string
  arguments: string
  showMenu: boolean
}

const SHELL_ACTIVITY_KEYWORDS = [
  "shell",
  "bash",
  "powershell",
  "command",
  "terminal",
  "stdout",
  "stderr",
  "process",
]
const EDIT_ACTIVITY_KEYWORDS = [
  "edit",
  "patch",
  "write",
  "replace",
  "delete",
  "rename",
  "create",
  "diff",
  "file",
]

function extractChatEntries(
  message: Record<string, unknown>,
  fallbackIndex: number,
  includeThinking: boolean,
): ChatMessage[] {
  const info =
    typeof message.info === "object" && message.info !== null
      ? (message.info as Record<string, unknown>)
      : null
  const role = info?.role

  if (role !== "user" && role !== "assistant") {
    return []
  }

  const parts = Array.isArray(message.parts) ? message.parts : []
  const createdAt =
    typeof info?.time === "object" &&
    info.time !== null &&
    typeof (info.time as Record<string, unknown>).created === "number"
      ? ((info.time as Record<string, unknown>).created as number)
      : null
  const baseId = typeof info?.id === "string" ? info.id : `${role}-${fallbackIndex}`
  const entries: ChatMessage[] = []

  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex]
    if (typeof part !== "object" || part === null) continue
    const candidate = part as Record<string, unknown>
    if (candidate.type === "text" && typeof candidate.text === "string" && candidate.text.trim()) {
      entries.push({
        id: `${baseId}-text-${partIndex}`,
        role,
        text: candidate.text.trim(),
        createdAt,
      })
    }
    if (
      includeThinking &&
      role === "assistant" &&
      candidate.type === "reasoning" &&
      typeof candidate.text === "string" &&
      candidate.text.trim()
    ) {
      entries.push({
        id: `${baseId}-thinking-${partIndex}`,
        role: "reasoning",
        text: candidate.text.trim(),
        createdAt,
      })
    }
  }

  return entries
}

function formatChatTimestamp(timestamp: number | null) {
  if (!timestamp) return null
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function extractTodoEntry(item: Record<string, unknown>, index: number): TodoEntry | null {
  const content = typeof item.content === "string" ? item.content.trim() : ""
  if (!content) return null

  return {
    id: `todo-${index}-${content}`,
    content,
    status: typeof item.status === "string" ? item.status : null,
    priority: typeof item.priority === "string" ? item.priority : null,
  }
}

function extractDiffEntry(item: Record<string, unknown>, index: number): DiffEntry | null {
  const file = typeof item.file === "string" ? item.file.trim() : ""
  if (!file) return null

  return {
    id: `diff-${index}-${file}`,
    file,
    status: typeof item.status === "string" ? item.status : null,
    additions: typeof item.additions === "number" ? item.additions : null,
    deletions: typeof item.deletions === "number" ? item.deletions : null,
  }
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

function safePrettyStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return "Unable to render event details."
  }
}

function truncateValue(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function findFieldValue(value: unknown, keys: string[]): string | null {
  if (typeof value !== "object" || value === null) return null

  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (keys.includes(entryKey) && typeof entryValue === "string" && entryValue.trim()) {
      return entryValue.trim()
    }
    if (typeof entryValue === "object" && entryValue !== null) {
      const nested = findFieldValue(entryValue, keys)
      if (nested) return nested
    }
  }

  return null
}

function classifyToolActivity(sourceType: string, raw: Record<string, unknown>): ToolActivityCategory | null {
  const haystack = `${sourceType} ${safeStringify(raw)}`.toLowerCase()

  if (SHELL_ACTIVITY_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return "shell"
  }
  if (EDIT_ACTIVITY_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return "edit"
  }

  return null
}

function buildToolActivityEntry(event: Extract<StreamEvent, { kind: "session.event" }>): ToolActivityEntry | null {
  if (!event.payload.sessionId) return null

  const category = classifyToolActivity(event.payload.sourceType, event.payload.raw)
  if (!category) return null

  const previewSource =
    category === "shell"
      ? findFieldValue(event.payload.raw, ["command", "cmd", "input", "script", "text", "data"])
      : findFieldValue(event.payload.raw, ["file", "path", "target", "name", "uri"])
  const preview = previewSource
    ? truncateValue(previewSource.replace(/\s+/g, " "), 120)
    : truncateValue(`${event.payload.sourceType} ${safeStringify(event.payload.raw)}`.replace(/\s+/g, " "), 120)

  return {
    id: `${event.payload.sourceType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category,
    sourceType: event.payload.sourceType,
    preview,
    detail: safePrettyStringify(event.payload.raw),
    createdAt: Date.now(),
  }
}

function extractPromptDefaults(messages: Record<string, unknown>[]) {
  const defaults = {
    agentId: null as string | null,
    providerID: null as string | null,
    modelID: null as string | null,
    variantId: null as string | null,
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (typeof message.info !== "object" || message.info === null) continue
    const info = message.info as Record<string, unknown>

    if (!defaults.agentId && typeof info.agent === "string") {
      defaults.agentId = info.agent
    }

    if (!defaults.providerID || !defaults.modelID) {
      const userModel =
        typeof info.model === "object" && info.model !== null ? (info.model as Record<string, unknown>) : null
      const providerID =
        typeof userModel?.providerID === "string"
          ? userModel.providerID
          : typeof info.providerID === "string"
            ? info.providerID
            : null
      const modelID =
        typeof userModel?.modelID === "string"
          ? userModel.modelID
          : typeof info.modelID === "string"
            ? info.modelID
            : null
      if (providerID && modelID) {
        defaults.providerID = providerID
        defaults.modelID = modelID
      }
    }

    if (!defaults.variantId && typeof info.variant === "string") {
      defaults.variantId = info.variant
    }

    if (defaults.agentId && defaults.providerID && defaults.modelID && defaults.variantId) {
      break
    }
  }

  return defaults
}

function formatReasoningLabel(model: PromptModelOption | null, variantId: string | null) {
  if (!model) return "Auto"
  if (!model.variants.length) return model.reasoningSupported ? "Auto" : "Not available"
  if (!variantId) return "Auto"
  const variant = model.variants.find((item) => item.id === variantId)
  if (!variant) return "Auto"
  return variant.reasoningEffort ?? variant.label
}

function parseSlashDraft(value: string): SlashDraft | null {
  const trimmedStart = value.trimStart()
  if (!trimmedStart.startsWith("/")) return null

  const body = trimmedStart.slice(1)
  const whitespaceIndex = body.search(/\s/)

  if (whitespaceIndex === -1) {
    return {
      commandText: body,
      arguments: "",
      showMenu: true,
    }
  }

  return {
    commandText: body.slice(0, whitespaceIndex),
    arguments: body.slice(whitespaceIndex + 1),
    showMenu: false,
  }
}

function filterCommands(commands: CommandSummary[], query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return commands

  return commands.filter((command) => {
    if (command.name.toLowerCase().startsWith(normalized)) return true
    return command.aliases.some((alias) => alias.toLowerCase().startsWith(normalized))
  })
}

function resolveCommandName(commands: CommandSummary[], typedCommand: string) {
  const normalized = typedCommand.trim().toLowerCase()
  if (!normalized) return null

  return (
    commands.find((command) => command.name.toLowerCase() === normalized)?.name ??
    commands.find((command) => command.aliases.some((alias) => alias.toLowerCase() === normalized))?.name ??
    null
  )
}

function ScreenShell({
  children,
  keyboardVerticalOffset,
}: ViewProps & { keyboardVerticalOffset: number }) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  if (Platform.OS === "ios") {
    return (
      <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={keyboardVerticalOffset}>
        {children}
      </KeyboardAvoidingView>
    )
  }

  return <View style={styles.screen}>{children}</View>
}

export function SessionDetailScreen({
  auth,
  sessionId,
  initialNotice = null,
  onRefreshSession,
  onOpenTerminal,
  onOpenSessions,
  onOpenSettings,
  onOpenSession,
}: Props) {
  const theme = useAppTheme()
  const colors = theme.colors
  const styles = useMemo(() => createStyles(colors), [colors])
  const showReasoningSummaries = useAppPreferencesStore((state) => state.showReasoningSummaries)
  const expandShellToolParts = useAppPreferencesStore((state) => state.expandShellToolParts)
  const expandEditToolParts = useAppPreferencesStore((state) => state.expandEditToolParts)
  const hiddenModelIds = useAppPreferencesStore((state) => state.hiddenModelIds)
  const [prompt, setPrompt] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [composerError, setComposerError] = useState<string | null>(null)
  const [composerNotice, setComposerNotice] = useState<string | null>(initialNotice)
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([])
  const [toolActivity, setToolActivity] = useState<ToolActivityEntry[]>([])
  const [activePicker, setActivePicker] = useState<PickerType>(null)
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)
  const [showTimestamps, setShowTimestamps] = useState(true)
  const [showThinking, setShowThinking] = useState(showReasoningSummaries)
  const [detailsVisible, setDetailsVisible] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [shellActivityOpen, setShellActivityOpen] = useState(expandShellToolParts)
  const [editActivityOpen, setEditActivityOpen] = useState(expandEditToolParts)
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRef = useRef<ScrollView | null>(null)
  const inputRef = useRef<TextInput | null>(null)
  const insets = useSafeAreaInsets()
  const composerPreference = useComposerStore((state) => state.preferences[sessionId] ?? emptyComposerPreference)
  const setComposerPreference = useComposerStore((state) => state.setPreference)
  const ensureComposerPreference = useComposerStore((state) => state.ensurePreference)
  const resolveApproval = useInboxStore((state) => state.resolveApproval)

  const detailQuery = useQuery<SessionDetail>({
    queryKey: ["session", sessionId],
    queryFn: () => getSessionDetail(auth, sessionId, onRefreshSession),
    refetchInterval: (query) => {
      const data = query.state.data as SessionDetail | undefined
      if (submitting) return 1200
      if (data?.summary.status.type === "busy" || data?.summary.status.type === "retry") return 1500
      return false
    },
  })
  const promptOptionsQuery = useQuery({
    queryKey: ["prompt-options"],
    queryFn: () => getPromptOptions(auth, onRefreshSession),
    staleTime: 60_000,
  })
  const commandsQuery = useQuery({
    queryKey: ["commands", auth.serverUrl],
    queryFn: () => getCommands(auth, onRefreshSession),
    staleTime: 60_000,
  })

  useEffect(() => {
    setComposerNotice(initialNotice)
  }, [initialNotice, sessionId])

  useEffect(() => {
    const scheduleRefetch = () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current)
      refetchTimerRef.current = setTimeout(() => {
        void detailQuery.refetch()
      }, 350)
    }

    const socket = openStreamSocket(auth, {
      onMessage(event: StreamEvent) {
        if (event.kind === "session.approval_requested" && event.payload.sessionId === sessionId) {
          setApprovals((current) => [
            {
              permissionId: event.payload.permissionId,
              permission: event.payload.permission,
              patterns: event.payload.patterns,
            },
            ...current.filter((item) => item.permissionId !== event.payload.permissionId),
          ])
          scheduleRefetch()
        }
        if (event.kind === "session.approval_resolved" && event.payload.sessionId === sessionId) {
          setApprovals((current) => current.filter((item) => item.permissionId !== event.payload.permissionId))
          resolveApproval(event.payload.permissionId)
          scheduleRefetch()
        }
        if (event.kind === "session.snapshot" && event.payload.id === sessionId) scheduleRefetch()
        if (event.kind === "session.event" && event.payload.sessionId === sessionId) {
          const nextActivity = buildToolActivityEntry(event)
          if (nextActivity) {
            setToolActivity((current) => [nextActivity, ...current].slice(0, 24))
          }
          scheduleRefetch()
        }
        if (event.kind === "session.diff_ready" && event.payload.sessionId === sessionId) scheduleRefetch()
      },
    })
    return () => {
      socket.close()
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current)
        refetchTimerRef.current = null
      }
    }
  }, [auth, detailQuery, resolveApproval, sessionId])

  const summary = detailQuery.data?.summary
  const renderedMessages = useMemo(
    () => (detailQuery.data?.messages ?? []).flatMap((message, index) => extractChatEntries(message, index, showThinking)),
    [detailQuery.data?.messages, showThinking],
  )
  const allMessages = useMemo(() => {
    const known = new Set(renderedMessages.map((message) => `${message.role}:${message.text}`))
    const pending = optimisticMessages.filter((message) => !known.has(`${message.role}:${message.text}`))
    return [...renderedMessages, ...pending].sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
  }, [optimisticMessages, renderedMessages])
  const renderedTodo = useMemo(
    () =>
      (detailQuery.data?.todo ?? [])
        .map((item, index) => extractTodoEntry(item, index))
        .filter((item): item is TodoEntry => Boolean(item)),
    [detailQuery.data?.todo],
  )
  const renderedDiff = useMemo(
    () =>
      (detailQuery.data?.diff ?? [])
        .map((item, index) => extractDiffEntry(item, index))
        .filter((item): item is DiffEntry => Boolean(item)),
    [detailQuery.data?.diff],
  )
  const shellToolActivity = useMemo(
    () => toolActivity.filter((entry) => entry.category === "shell"),
    [toolActivity],
  )
  const editToolActivity = useMemo(
    () => toolActivity.filter((entry) => entry.category === "edit"),
    [toolActivity],
  )
  const latestPromptDefaults = useMemo(
    () => extractPromptDefaults(detailQuery.data?.messages ?? []),
    [detailQuery.data?.messages],
  )
  const primaryAgents = useMemo(
    () => (promptOptionsQuery.data?.agents ?? []).filter((agent) => agent.isPrimary),
    [promptOptionsQuery.data?.agents],
  )
  const visibleModels = useMemo(
    () =>
      (promptOptionsQuery.data?.models ?? []).filter(
        (model) => !hiddenModelIds.includes(`${model.providerID}/${model.modelID}`),
      ),
    [hiddenModelIds, promptOptionsQuery.data?.models],
  )
  const selectedModel = useMemo(
    () =>
      visibleModels.find(
        (model) => model.providerID === composerPreference.providerID && model.modelID === composerPreference.modelID,
      ) ?? null,
    [composerPreference.modelID, composerPreference.providerID, visibleModels],
  )
  const selectedAgentId = composerPreference.agentId ?? promptOptionsQuery.data?.defaultAgent ?? "build"
  const selectedAgent = useMemo(
    () => (promptOptionsQuery.data?.agents ?? []).find((agent) => agent.id === selectedAgentId) ?? null,
    [promptOptionsQuery.data?.agents, selectedAgentId],
  )
  const selectedModelLabel = selectedModel?.name ?? "Default model"
  const selectedReasoningLabel = formatReasoningLabel(selectedModel, composerPreference.variantId)
  const composerSummary = `${selectedAgent?.name ?? "Agent"} · ${selectedModelLabel} · ${selectedReasoningLabel}`
  const slashDraft = useMemo(() => parseSlashDraft(prompt), [prompt])
  const visibleCommands = useMemo(
    () => filterCommands(commandsQuery.data ?? [], slashDraft?.commandText ?? ""),
    [commandsQuery.data, slashDraft?.commandText],
  )
  const agentItems = useMemo(
    () =>
      primaryAgents.map((agent) => ({
        id: agent.id,
        title: agent.name,
        subtitle: agent.description,
      })),
    [primaryAgents],
  )
  const modelItems = useMemo(
    () =>
      visibleModels.map((model) => ({
        id: `${model.providerID}/${model.modelID}`,
        title: model.name,
        subtitle: `${model.providerName}${model.reasoningSupported ? " · reasoning" : ""}`,
      })),
    [visibleModels],
  )
  const variantItems = useMemo(() => {
    const items = [{ id: "__auto__", title: "Auto", subtitle: "Use the model default" }]
    if (!selectedModel) return items
    return [
      ...items,
      ...selectedModel.variants.map((variant) => ({
        id: variant.id,
        title: variant.reasoningEffort ?? variant.label,
        subtitle: variant.id === variant.label ? "Model variant" : variant.label,
        })),
    ]
  }, [selectedModel])
  const actionItems = useMemo(
    () => [
      { id: "resume", title: "Resume", subtitle: "Continue the current session" },
      { id: "retry", title: "Retry", subtitle: "Retry the current step" },
      { id: "abort", title: "Abort", subtitle: "Stop the current run" },
    ],
    [],
  )
  const compactComposer = isKeyboardVisible
  const composerBottomPadding = Math.max(insets.bottom, Platform.OS === "ios" ? 12 : 10)
  const statusTone = sessionStatusTone(colors, summary?.status.type ?? "idle")

  const scrollToLatest = useCallback((animated: boolean) => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated })
    }, animated ? 90 : 0)
  }, [])

  useEffect(() => {
    if (!promptOptionsQuery.data) return

    const fallbackModel = (() => {
      const fromMessage = visibleModels.find(
        (model) =>
          model.providerID === latestPromptDefaults.providerID && model.modelID === latestPromptDefaults.modelID,
      )
      if (fromMessage) {
        return {
          providerID: fromMessage.providerID,
          modelID: fromMessage.modelID,
        }
      }

      const firstModel = visibleModels[0]
      return {
        providerID: firstModel?.providerID ?? null,
        modelID: firstModel?.modelID ?? null,
      }
    })()

    ensureComposerPreference(sessionId, {
      agentId: latestPromptDefaults.agentId ?? promptOptionsQuery.data.defaultAgent,
      providerID: fallbackModel.providerID,
      modelID: fallbackModel.modelID,
      variantId: latestPromptDefaults.variantId,
    })
  }, [
    ensureComposerPreference,
    latestPromptDefaults.agentId,
    latestPromptDefaults.modelID,
    latestPromptDefaults.providerID,
    latestPromptDefaults.variantId,
    promptOptionsQuery.data,
    sessionId,
    visibleModels,
  ])

  useEffect(() => {
    setShowThinking(showReasoningSummaries)
  }, [sessionId, showReasoningSummaries])

  useEffect(() => {
    setShellActivityOpen(expandShellToolParts)
  }, [expandShellToolParts, sessionId])

  useEffect(() => {
    setEditActivityOpen(expandEditToolParts)
  }, [expandEditToolParts, sessionId])

  useEffect(() => {
    setToolActivity([])
  }, [sessionId])

  useEffect(() => {
    if (!visibleModels.length || selectedModel) return
    if (!composerPreference.providerID || !composerPreference.modelID) return

    const fallback = visibleModels[0]
    setComposerPreference(sessionId, {
      providerID: fallback.providerID,
      modelID: fallback.modelID,
      variantId: null,
    })
  }, [
    composerPreference.modelID,
    composerPreference.providerID,
    selectedModel,
    sessionId,
    setComposerPreference,
    visibleModels,
  ])

  useEffect(() => {
    if (!selectedModel?.variants.length && composerPreference.variantId) {
      setComposerPreference(sessionId, { variantId: null })
      return
    }

    if (
      composerPreference.variantId &&
      selectedModel &&
      !selectedModel.variants.some((variant) => variant.id === composerPreference.variantId)
    ) {
      setComposerPreference(sessionId, { variantId: null })
    }
  }, [composerPreference.variantId, selectedModel, sessionId, setComposerPreference])

  useEffect(() => {
    scrollToLatest(false)
  }, [allMessages.length, scrollToLatest, sessionId])

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide"
    const showSubscription = Keyboard.addListener(showEvent, () => {
      setIsKeyboardVisible(true)
      scrollToLatest(true)
    })
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardVisible(false)
    })

    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [scrollToLatest])

  useEffect(() => {
    if (isKeyboardVisible) {
      setOptionsOpen(false)
    }
  }, [isKeyboardVisible])

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current)
        scrollTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    setOptimisticMessages((current) =>
      current.filter(
        (optimistic) =>
          !renderedMessages.some(
            (message) => message.role === optimistic.role && message.text.trim() === optimistic.text.trim(),
          ),
      ),
    )
  }, [renderedMessages])

  function handleSelectCommand(command: CommandSummary) {
    setComposerError(null)
    setComposerNotice(null)
    setPrompt(`/${command.name} `)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  function handleToggleTimestamps() {
    setComposerError(null)
    setComposerNotice(showTimestamps ? "Timestamps hidden." : "Timestamps shown.")
    setPrompt("")
    setShowTimestamps((current) => !current)
  }

  function handleToggleThinking() {
    setComposerError(null)
    setComposerNotice(showThinking ? "Reasoning snippets hidden." : "Reasoning snippets shown.")
    setPrompt("")
    setShowThinking((current) => !current)
  }

  function handleActionSelect(actionId: string) {
    if (actionId !== "resume" && actionId !== "retry" && actionId !== "abort") {
      return
    }

    void handleControl(actionId)
  }

  async function handleLocalSlashCommand(commandName: string, argumentsText: string) {
    switch (commandName) {
      case "help":
        setComposerError(null)
        setComposerNotice("Slash commands are listed above. Type to filter them.")
        setPrompt("/")
        requestAnimationFrame(() => {
          inputRef.current?.focus()
        })
        return true
      case "models":
        setComposerError(null)
        setComposerNotice("Choose a model for the next message.")
        setPrompt("")
        setActivePicker("model")
        return true
      case "agents":
        setComposerError(null)
        setComposerNotice("Choose an agent for the next message.")
        setPrompt("")
        setActivePicker("agent")
        return true
      case "themes":
      case "theme":
        setComposerError(null)
        setComposerNotice("Appearance settings moved to Settings.")
        setPrompt("")
        onOpenSettings()
        return true
      case "sessions":
      case "exit":
        setComposerError(null)
        setComposerNotice(null)
        setPrompt("")
        onOpenSessions()
        return true
      case "status": {
        const refreshed = await detailQuery.refetch()
        setComposerError(null)
        setComposerNotice(`Status: ${refreshed.data?.summary.status.type ?? "unknown"}.`)
        setPrompt("")
        return true
      }
      case "editor":
        setComposerError(null)
        setComposerNotice("Composer ready.")
        setPrompt("")
        requestAnimationFrame(() => {
          inputRef.current?.focus()
        })
        return true
      case "skills":
        setComposerError(null)
        setComposerNotice("Skill commands are shown with the skill badge in the slash list.")
        setPrompt("/")
        requestAnimationFrame(() => {
          inputRef.current?.focus()
        })
        return true
      case "timestamps":
        handleToggleTimestamps()
        return true
      case "thinking":
        handleToggleThinking()
        return true
      case "copy":
        setComposerError("Transcript copy isn’t available on mobile yet.")
        setComposerNotice(null)
        return true
      case "workspaces":
      case "mcps":
      case "connect":
      case "timeline":
      case "fork":
      case "export":
        setComposerError(`/${commandName} isn’t available in the mobile session view yet.`)
        setComposerNotice(null)
        if (argumentsText) {
          setPrompt(`/${commandName} ${argumentsText}`)
        }
        return true
      default:
        return false
    }
  }

  async function handleSendPrompt() {
    if (!prompt.trim()) return
    const promptText = prompt.trim()
    const nextModel =
      composerPreference.providerID && composerPreference.modelID
        ? {
            providerID: composerPreference.providerID,
            modelID: composerPreference.modelID,
          }
        : undefined

    setSubmitting(true)
    try {
      setComposerError(null)
      setComposerNotice(null)

      if (slashDraft) {
        if (!slashDraft.commandText.trim()) {
          setComposerError("Choose a slash command before sending.")
          return
        }

        const resolvedCommand =
          commandsQuery.data?.find(
            (command) =>
              command.name ===
              (resolveCommandName(commandsQuery.data ?? [], slashDraft.commandText) ?? slashDraft.commandText),
          ) ?? null

        const localHandled = await handleLocalSlashCommand(
          resolvedCommand?.name ?? slashDraft.commandText.trim().toLowerCase(),
          slashDraft.arguments,
        )
        if (localHandled) {
          return
        }

        const commandResponse = await sendCommand(
          auth,
          sessionId,
          {
            command:
              resolvedCommand?.name ??
              resolveCommandName(commandsQuery.data ?? [], slashDraft.commandText) ??
              slashDraft.commandText,
            arguments: slashDraft.arguments,
            agent: selectedAgentId,
            model: nextModel,
            variant: composerPreference.variantId ?? undefined,
          },
          onRefreshSession,
        )

        if (commandResponse.status === "unsupported") {
          setComposerError(commandResponse.message ?? "That slash command is not available right now.")
          return
        }

        if (commandResponse.message) {
          setComposerNotice(
            commandResponse.shareUrl ? `${commandResponse.message} ${commandResponse.shareUrl}` : commandResponse.message,
          )
        }

        if (commandResponse.sessionId && commandResponse.sessionId !== sessionId) {
          setPrompt("")
          onOpenSession(commandResponse.sessionId)
          return
        }
      } else {
        setOptimisticMessages((current) => [
          ...current,
          {
            id: `optimistic-${Date.now()}`,
            role: "user",
            text: promptText,
            createdAt: Date.now(),
          },
        ])
        await sendPrompt(
          auth,
          sessionId,
          {
            text: promptText,
            agent: selectedAgentId,
            model: nextModel,
            variant: composerPreference.variantId ?? undefined,
          },
          onRefreshSession,
        )
      }

      setPrompt("")
      await detailQuery.refetch()
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Unable to send right now.")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleControl(action: "approve" | "deny" | "abort" | "resume" | "retry", permissionId?: string) {
    const nextModel =
      composerPreference.providerID && composerPreference.modelID
        ? {
            providerID: composerPreference.providerID,
            modelID: composerPreference.modelID,
          }
        : undefined

    await sendControl(
      auth,
      sessionId,
      {
        action,
        permissionId,
        agent: selectedAgentId,
        model: nextModel,
        variant: composerPreference.variantId ?? undefined,
      },
      onRefreshSession,
    )
    if (permissionId && (action === "approve" || action === "deny")) {
      resolveApproval(permissionId)
    }
    await detailQuery.refetch()
  }

  if (detailQuery.isLoading && !detailQuery.data) {
    return (
      <View style={styles.loading}>
        <BrandLockup compact caption="Loading session from your OpenCode host." />
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }

  if (detailQuery.isError && !detailQuery.data) {
    return (
      <View style={styles.loading}>
        <BrandLockup compact caption="Session view unavailable." />
        <Text style={styles.errorTitle}>Couldn’t open this session.</Text>
        <Text style={styles.errorMessage}>
          {detailQuery.error instanceof Error ? detailQuery.error.message : "The session details could not be loaded."}
        </Text>
        <Pressable style={styles.inlineButton} onPress={() => void detailQuery.refetch()}>
          <Text style={styles.inlineButtonText}>Try again</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <ScreenShell keyboardVerticalOffset={84}>
      <View style={styles.screenBody}>
        <View style={styles.headerBlock}>
          <AppHeader
            title={summary?.title ?? "Session"}
            subtitle={summary?.directory ?? sessionId}
            onBack={onOpenSessions}
            right={
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: statusTone.backgroundColor, borderColor: statusTone.borderColor },
                ]}
              >
                <Text style={[styles.statusBadgeText, { color: statusTone.textColor }]}>{summary?.status.type ?? "idle"}</Text>
              </View>
            }
          />

          <View style={styles.topActionRow}>
            {summary?.hasTui ? <ControlChip label="Terminal" onPress={() => onOpenTerminal(sessionId)} /> : null}
            <ControlChip label="Actions" onPress={() => setActivePicker("actions")} />
            <ControlChip label="Details" onPress={() => setDetailsVisible(true)} />
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.transcriptScroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          {approvals.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>APPROVALS</Text>
              {approvals.map((approval) => (
                <View key={approval.permissionId} style={styles.approvalRow}>
                  <View style={styles.approvalCopy}>
                    <Text style={styles.approvalTitle}>{approval.permission}</Text>
                    <Text style={styles.approvalMeta}>{approval.patterns.join(", ") || "No pattern details"}</Text>
                  </View>
                  <View style={styles.approvalActions}>
                    <ControlChip label="Approve" onPress={() => void handleControl("approve", approval.permissionId)} tone="success" />
                    <ControlChip label="Deny" onPress={() => void handleControl("deny", approval.permissionId)} />
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {allMessages.length ? (
            <View style={styles.messageColumn}>
              {allMessages.map((message) => {
                const timestamp = formatChatTimestamp(message.createdAt)
                const isUser = message.role === "user"
                const isReasoning = message.role === "reasoning"
                return (
                  <View
                    key={message.id}
                    style={[
                      styles.messageBubble,
                      isUser ? styles.messageBubbleRight : styles.messageBubbleLeft,
                      isUser && styles.messageBubbleUser,
                      isReasoning && styles.messageBubbleThinking,
                    ]}
                  >
                    <View style={styles.logMeta}>
                      <Text style={styles.logRole}>
                        {message.role === "user" ? "YOU" : message.role === "reasoning" ? "THINKING" : "OPENCODE"}
                      </Text>
                      {showTimestamps && timestamp ? <Text style={styles.logTime}>{timestamp}</Text> : null}
                    </View>
                    <Text style={[styles.logText, isReasoning && styles.logTextThinking]}>{message.text}</Text>
                  </View>
                )
              })}
            </View>
          ) : (
            <View style={styles.emptyTranscript}>
              <Text style={styles.emptyState}>No readable transcript yet. Tool activity may still be streaming.</Text>
            </View>
          )}
        </ScrollView>

        <View style={[styles.composerDock, { paddingBottom: composerBottomPadding }]}>
          {slashDraft?.showMenu ? (
            <View style={styles.commandMenu}>
              {commandsQuery.isLoading ? (
                <Text style={styles.commandMenuState}>Loading commands...</Text>
              ) : commandsQuery.isError ? (
                <Text style={styles.commandMenuState}>Couldn’t load slash commands.</Text>
              ) : visibleCommands.length ? (
                <ScrollView style={styles.commandMenuScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {visibleCommands.map((command) => {
                    const tone = commandSourceTone(colors, command.source)
                    return (
                      <Pressable key={command.name} style={styles.commandItem} onPress={() => handleSelectCommand(command)}>
                        <View style={styles.commandItemHeader}>
                          <Text style={styles.commandName}>/{command.name}</Text>
                          <View
                            style={[
                              styles.commandSourceBadge,
                              { backgroundColor: tone.backgroundColor, borderColor: tone.borderColor },
                            ]}
                          >
                            <Text style={[styles.commandSourceText, { color: tone.textColor }]}>{command.source}</Text>
                          </View>
                        </View>
                        {command.description ? <Text style={styles.commandDescription}>{command.description}</Text> : null}
                        {command.aliases.length ? (
                          <Text style={styles.commandMeta}>{command.aliases.map((alias) => `/${alias}`).join(" ")}</Text>
                        ) : null}
                        {command.hints.length ? <Text style={styles.commandMeta}>{command.hints.join(" ")}</Text> : null}
                      </Pressable>
                    )
                  })}
                </ScrollView>
              ) : (
                <Text style={styles.commandMenuState}>No slash commands match that name.</Text>
              )}
            </View>
          ) : null}

          {composerNotice ? <Text style={styles.composerNotice}>{composerNotice}</Text> : null}
          {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}

          {optionsOpen ? (
            <View style={styles.optionsPanel}>
              <Text style={styles.optionsLabel}>PROMPT OPTIONS</Text>
              <View style={styles.agentToggleRow}>
                {primaryAgents.map((agent) => {
                  const selected = selectedAgentId === agent.id
                  return (
                    <Pressable
                      key={agent.id}
                      style={[styles.agentToggle, selected && styles.agentToggleSelected]}
                      onPress={() => setComposerPreference(sessionId, { agentId: agent.id })}
                    >
                      <Text style={[styles.agentToggleText, selected && styles.agentToggleTextSelected]}>{agent.name}</Text>
                    </Pressable>
                  )
                })}
                {primaryAgents.length > 2 ? (
                  <Pressable style={styles.inlineAction} onPress={() => setActivePicker("agent")}>
                    <Text style={styles.inlineActionText}>More</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.optionsMetaRow}>
                <Pressable style={styles.metaChip} onPress={() => setActivePicker("model")}>
                  <Text style={styles.metaChipLabel}>MODEL</Text>
                  <Text style={styles.metaChipValue} numberOfLines={1}>
                    {selectedModelLabel}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.metaChip, !selectedModel?.variants.length && styles.metaChipDisabled]}
                  disabled={!selectedModel?.variants.length}
                  onPress={() => setActivePicker("variant")}
                >
                  <Text style={styles.metaChipLabel}>REASONING</Text>
                  <Text style={styles.metaChipValue} numberOfLines={1}>
                    {selectedReasoningLabel}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={[styles.composerCard, compactComposer && styles.composerCardCompact]}>
            <TextInput
              ref={inputRef}
              multiline
              style={[styles.composer, compactComposer && styles.composerCompact]}
              placeholder='Ask anything...  "Fix broken tests"'
              placeholderTextColor={colors.textDim}
              value={prompt}
              onChangeText={(value) => {
                setComposerError(null)
                setComposerNotice(null)
                setPrompt(value)
              }}
              onFocus={() => {
                scrollToLatest(true)
              }}
            />

            <View style={[styles.composerFooter, compactComposer && styles.composerFooterCompact]}>
              <View style={styles.composerFooterLeft}>
                <Text style={styles.composerSummary} numberOfLines={1}>
                  {composerSummary}
                </Text>
                <Pressable style={styles.metaChip} onPress={() => setOptionsOpen((current) => !current)}>
                  <Text style={styles.metaChipLabel}>COMPOSER</Text>
                  <Text style={styles.metaChipValue}>{optionsOpen ? "Hide options" : "Options"}</Text>
                </Pressable>
              </View>

              <Pressable
                style={[styles.sendButton, submitting && styles.buttonDisabled]}
                disabled={submitting}
                onPress={handleSendPrompt}
              >
                <Text style={styles.sendButtonText}>{submitting ? "Sending..." : "Send"}</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <SelectionModal
          visible={activePicker === "agent"}
          title="Choose agent"
          searchPlaceholder="Search agents"
          items={agentItems}
          selectedId={selectedAgentId}
          onSelect={(agentId) => setComposerPreference(sessionId, { agentId })}
          onClose={() => setActivePicker(null)}
        />
        <SelectionModal
          visible={activePicker === "model"}
          title="Choose model"
          searchPlaceholder="Search models"
          items={modelItems}
          selectedId={selectedModel ? `${selectedModel.providerID}/${selectedModel.modelID}` : null}
          onSelect={(value) => {
            const [providerID, ...modelParts] = value.split("/")
            const modelID = modelParts.join("/")
            setComposerPreference(sessionId, {
              providerID,
              modelID,
              variantId: null,
            })
          }}
          onClose={() => setActivePicker(null)}
        />
        <SelectionModal
          visible={activePicker === "variant"}
          title="Choose reasoning"
          searchPlaceholder="Search variants"
          items={variantItems}
          selectedId={composerPreference.variantId ?? "__auto__"}
          onSelect={(variantId) =>
            setComposerPreference(sessionId, { variantId: variantId === "__auto__" ? null : variantId })
          }
          onClose={() => setActivePicker(null)}
        />
        <SelectionModal
          visible={activePicker === "actions"}
          title="Session actions"
          items={actionItems}
          searchable={false}
          selectedId={null}
          onSelect={handleActionSelect}
          onClose={() => setActivePicker(null)}
        />

        <Modal animationType="slide" transparent visible={detailsVisible} onRequestClose={() => setDetailsVisible(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.sectionLabel}>DETAILS</Text>
              <Text style={styles.modalTitle}>Session view options</Text>

              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Transcript</Text>
                <View style={styles.modalActionRow}>
                  <ControlChip
                    label={showTimestamps ? "Hide timestamps" : "Show timestamps"}
                    onPress={handleToggleTimestamps}
                  />
                  <ControlChip
                    label={showThinking ? "Hide thinking" : "Show thinking"}
                    onPress={handleToggleThinking}
                  />
                </View>
              </View>

              <ScrollView style={styles.detailsScroll} contentContainerStyle={styles.detailsContent}>
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Todo</Text>
                  {renderedTodo.length ? (
                    renderedTodo.map((item) => (
                      <View key={item.id} style={styles.listRow}>
                        <Text style={styles.listRowTitle}>{item.content}</Text>
                        <View style={styles.rowBadges}>
                          {item.status ? <Tag label={item.status} /> : null}
                          {item.priority ? <Tag label={item.priority} tone="warning" /> : null}
                        </View>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.emptyState}>No todo items reported.</Text>
                  )}
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Diff</Text>
                  {renderedDiff.length ? (
                    renderedDiff.map((item) => (
                      <View key={item.id} style={styles.listRow}>
                        <Text style={styles.listRowTitle}>{item.file}</Text>
                        <View style={styles.rowBadges}>
                          {item.status ? <Tag label={item.status} /> : null}
                          {item.additions !== null ? <Tag label={`+${item.additions}`} tone="success" /> : null}
                          {item.deletions !== null ? <Tag label={`-${item.deletions}`} tone="danger" /> : null}
                        </View>
                      </View>
                    ))
                  ) : detailQuery.data?.diffInfo.message ? (
                    <Text style={styles.emptyState}>{detailQuery.data.diffInfo.message}</Text>
                  ) : (
                    <Text style={styles.emptyState}>No diff available yet.</Text>
                  )}
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Tool activity</Text>
                  <Text style={styles.detailSectionHint}>
                    Live shell and edit events appear here while this session screen stays open.
                  </Text>

                  <DisclosureSection
                    title="Shell tool parts"
                    count={shellToolActivity.length}
                    open={shellActivityOpen}
                    onToggle={() => setShellActivityOpen((current) => !current)}
                  >
                    <View style={styles.disclosureContent}>
                      {shellToolActivity.length ? (
                        shellToolActivity.map((item) => (
                          <View key={item.id} style={styles.listRow}>
                            <View style={styles.detailRowMeta}>
                              <Text style={styles.sectionLabel}>{item.sourceType}</Text>
                              <Text style={styles.disclosureMeta}>{formatChatTimestamp(item.createdAt) ?? "Now"}</Text>
                            </View>
                            <Text style={styles.detailPreview}>{item.preview}</Text>
                            <View style={styles.detailCodeBlock}>
                              <Text style={styles.detailCodeText}>{item.detail}</Text>
                            </View>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.emptyState}>No shell activity captured in this view yet.</Text>
                      )}
                    </View>
                  </DisclosureSection>

                  <DisclosureSection
                    title="Edit tool parts"
                    count={editToolActivity.length}
                    open={editActivityOpen}
                    onToggle={() => setEditActivityOpen((current) => !current)}
                  >
                    <View style={styles.disclosureContent}>
                      {editToolActivity.length ? (
                        editToolActivity.map((item) => (
                          <View key={item.id} style={styles.listRow}>
                            <View style={styles.detailRowMeta}>
                              <Text style={styles.sectionLabel}>{item.sourceType}</Text>
                              <Text style={styles.disclosureMeta}>{formatChatTimestamp(item.createdAt) ?? "Now"}</Text>
                            </View>
                            <Text style={styles.detailPreview}>{item.preview}</Text>
                            <View style={styles.detailCodeBlock}>
                              <Text style={styles.detailCodeText}>{item.detail}</Text>
                            </View>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.emptyState}>No edit activity captured in this view yet.</Text>
                      )}
                    </View>
                  </DisclosureSection>
                </View>
              </ScrollView>

              <Pressable style={styles.closeDetailsButton} onPress={() => setDetailsVisible(false)}>
                <Text style={styles.closeDetailsText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </ScreenShell>
  )
}

function ControlChip({
  label,
  onPress,
  tone = "default",
}: {
  label: string
  onPress: () => void
  tone?: "default" | "danger" | "success"
}) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <Pressable
      style={[
        styles.controlChip,
        tone === "danger" && styles.controlChipDanger,
        tone === "success" && styles.controlChipSuccess,
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.controlChipText,
          tone === "danger" && styles.controlChipTextDanger,
          tone === "success" && styles.controlChipTextSuccess,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function Tag({ label, tone = "default" }: { label: string; tone?: "default" | "warning" | "success" | "danger" }) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <View
      style={[
        styles.tag,
        tone === "warning" && styles.tagWarning,
        tone === "success" && styles.tagSuccess,
        tone === "danger" && styles.tagDanger,
      ]}
    >
      <Text
        style={[
          styles.tagText,
          tone === "warning" && styles.tagTextWarning,
          tone === "success" && styles.tagTextSuccess,
          tone === "danger" && styles.tagTextDanger,
        ]}
      >
        {label}
      </Text>
    </View>
  )
}

function DisclosureSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <View style={styles.section}>
      <Pressable style={styles.disclosureHeader} onPress={onToggle}>
        <View>
          <Text style={styles.sectionLabel}>{title.toUpperCase()}</Text>
          <Text style={styles.disclosureMeta}>{count} items</Text>
        </View>
        <Text style={styles.disclosureGlyph}>{open ? "−" : "+"}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.app,
    },
    screenBody: {
      flex: 1,
      backgroundColor: colors.app,
    },
    headerBlock: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
    },
    statusBadge: {
      ...tagSurface(colors, "panelStrong"),
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      alignSelf: "flex-start",
    },
    statusBadgeText: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      fontFamily: typography.mono,
    },
    topActionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    controlChip: {
      ...buttonSurface(colors, "surfaceMuted"),
      minHeight: 36,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    controlChipDanger: {
      ...buttonSurface(colors, "danger"),
    },
    controlChipSuccess: {
      ...buttonSurface(colors, "success"),
    },
    controlChipText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
      fontFamily: typography.mono,
    },
    controlChipTextDanger: {
      color: colors.danger,
    },
    controlChipTextSuccess: {
      color: colors.success,
    },
    transcriptScroll: {
      flex: 1,
      minHeight: 0,
    },
    content: {
      paddingHorizontal: spacing.lg,
      gap: spacing.sm,
      paddingBottom: spacing.md,
    },
    section: {
      ...cardSurface(colors),
      padding: spacing.md,
      gap: spacing.md,
    },
    sectionLabel: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    approvalRow: {
      ...cardSurface(colors, "surfaceMuted"),
      padding: spacing.md,
      gap: spacing.md,
    },
    approvalCopy: {
      gap: 4,
    },
    approvalTitle: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 15,
    },
    approvalMeta: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      fontFamily: typography.mono,
    },
    approvalActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    messageColumn: {
      gap: spacing.sm,
    },
    messageBubble: {
      maxWidth: "94%",
      ...buttonSurface(colors, "surface"),
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      gap: spacing.xs,
    },
    messageBubbleLeft: {
      alignSelf: "flex-start",
    },
    messageBubbleRight: {
      alignSelf: "flex-end",
    },
    messageBubbleUser: {
      ...buttonSurface(colors, "surfaceMuted"),
    },
    messageBubbleThinking: {
      backgroundColor: colors.panel,
      borderStyle: "dashed",
    },
    logMeta: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    logRole: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    logTime: {
      color: colors.textDim,
      fontSize: 11,
      fontFamily: typography.mono,
    },
    logText: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
    },
    logTextThinking: {
      color: colors.textMuted,
      fontStyle: "italic",
    },
    emptyTranscript: {
      ...cardSurface(colors),
      padding: spacing.lg,
    },
    disclosureHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    disclosureMeta: {
      color: colors.textDim,
      fontSize: 12,
      fontFamily: typography.mono,
    },
    disclosureGlyph: {
      color: colors.text,
      fontSize: 24,
      lineHeight: 24,
    },
    listRow: {
      ...cardSurface(colors, "surfaceMuted"),
      padding: spacing.md,
      gap: spacing.sm,
    },
    listRowTitle: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    rowBadges: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    tag: {
      ...tagSurface(colors, "panelStrong"),
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
    },
    tagWarning: {
      backgroundColor: colors.warningSurface,
      borderColor: "#9d7b44",
    },
    tagSuccess: {
      backgroundColor: colors.successSurface,
      borderColor: "#4f9164",
    },
    tagDanger: {
      backgroundColor: colors.dangerSurface,
      borderColor: "#9d585c",
    },
    tagText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: "700",
      fontFamily: typography.mono,
    },
    tagTextWarning: {
      color: colors.warning,
    },
    tagTextSuccess: {
      color: colors.success,
    },
    tagTextDanger: {
      color: colors.danger,
    },
    emptyState: {
      color: colors.textDim,
      lineHeight: 20,
    },
    composerDock: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.app,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      gap: spacing.sm,
    },
    commandMenu: {
      maxHeight: 240,
      ...cardSurface(colors),
      overflow: "hidden",
    },
    commandMenuScroll: {
      maxHeight: 240,
    },
    commandMenuState: {
      color: colors.textDim,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: 14,
      fontFamily: typography.mono,
    },
    commandItem: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      gap: 6,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    commandItemHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    commandName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "800",
      fontFamily: typography.mono,
    },
    commandDescription: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    commandMeta: {
      color: colors.textDim,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: typography.mono,
    },
    commandSourceBadge: {
      ...tagSurface(colors, "panelStrong"),
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
    },
    commandSourceText: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      fontFamily: typography.mono,
    },
    composerError: {
      color: colors.danger,
      fontSize: 13,
      paddingHorizontal: 4,
    },
    composerNotice: {
      color: colors.info,
      fontSize: 13,
      paddingHorizontal: 4,
    },
    optionsPanel: {
      ...cardSurface(colors),
      padding: spacing.md,
      gap: spacing.sm,
    },
    optionsLabel: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    optionsMetaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    composerCard: {
      ...cardSurface(colors),
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    composerCardCompact: {
      paddingVertical: spacing.xs,
    },
    composer: {
      minHeight: 48,
      maxHeight: 120,
      borderWidth: 0,
      backgroundColor: "transparent",
      color: colors.text,
      paddingTop: 6,
      paddingBottom: 2,
      paddingHorizontal: 2,
      fontSize: 17,
      lineHeight: 24,
      textAlignVertical: "top",
    },
    composerCompact: {
      minHeight: 44,
      maxHeight: 96,
    },
    composerFooter: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    composerFooterCompact: {
      alignItems: "center",
    },
    composerFooterLeft: {
      flex: 1,
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: spacing.sm,
    },
    composerSummary: {
      flexShrink: 1,
      color: colors.textDim,
      fontSize: 12,
      fontFamily: typography.mono,
    },
    agentToggleRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    agentToggle: {
      ...buttonSurface(colors, "surfaceMuted"),
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
    },
    agentToggleSelected: {
      borderColor: colors.borderStrong,
      backgroundColor: colors.panelStrong,
    },
    agentToggleText: {
      color: colors.textMuted,
      fontWeight: "700",
      textTransform: "capitalize",
      fontFamily: typography.mono,
    },
    agentToggleTextSelected: {
      color: colors.text,
    },
    inlineAction: {
      justifyContent: "center",
      paddingHorizontal: 2,
    },
    inlineActionText: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 13,
    },
    metaChip: {
      ...buttonSurface(colors, "surfaceMuted"),
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      gap: 2,
    },
    metaChipDisabled: {
      opacity: 0.55,
    },
    metaChipLabel: {
      color: colors.textDim,
      fontSize: 10,
      letterSpacing: 1,
      fontFamily: typography.mono,
    },
    metaChipValue: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
    },
    sendButton: {
      ...buttonSurface(colors, "accent"),
      minWidth: 82,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
    },
    sendButtonText: {
      color: colors.textOnAccent,
      fontSize: 14,
      fontWeight: "800",
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: "center",
      backgroundColor: colors.overlay,
      padding: spacing.lg,
    },
    modalCard: {
      maxHeight: "82%",
      ...cardSurface(colors),
      padding: spacing.lg,
      gap: spacing.md,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 22,
      fontWeight: "700",
    },
    detailSection: {
      gap: spacing.sm,
    },
    detailSectionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
    },
    detailSectionHint: {
      color: colors.textDim,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: typography.mono,
    },
    modalActionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    detailsScroll: {
      minHeight: 120,
      maxHeight: 360,
    },
    detailsContent: {
      gap: spacing.md,
      paddingBottom: spacing.sm,
    },
    closeDetailsButton: {
      ...buttonSurface(colors, "panelStrong"),
      minHeight: 46,
      alignItems: "center",
      justifyContent: "center",
    },
    closeDetailsText: {
      color: colors.text,
      fontWeight: "700",
    },
    disclosureContent: {
      gap: spacing.sm,
    },
    detailRowMeta: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.sm,
    },
    detailPreview: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    detailCodeBlock: {
      ...cardSurface(colors, "surface"),
      padding: spacing.sm,
    },
    detailCodeText: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: typography.mono,
    },
    loading: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.app,
      paddingHorizontal: spacing.xl,
      gap: spacing.md,
    },
    errorTitle: {
      color: colors.text,
      fontSize: 22,
      fontWeight: "700",
      textAlign: "center",
    },
    errorMessage: {
      color: colors.textMuted,
      textAlign: "center",
      lineHeight: 22,
    },
    inlineButton: {
      ...buttonSurface(colors, "panelStrong"),
      minHeight: 44,
      paddingHorizontal: spacing.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    inlineButtonText: {
      color: colors.text,
      fontWeight: "700",
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  })
}
