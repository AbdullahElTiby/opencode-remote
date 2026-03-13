import { z } from "zod"

export const devicePlatformSchema = z.enum(["ios", "android", "web", "unknown"])
export type DevicePlatform = z.infer<typeof devicePlatformSchema>

export const pairStartRequestSchema = z.object({
  label: z.string().min(1).max(80).optional(),
})
export type PairStartRequest = z.infer<typeof pairStartRequestSchema>

export const pairStartResponseSchema = z.object({
  challengeId: z.string(),
  code: z.string(),
  expiresAt: z.string(),
  qrPayload: z.string(),
  qrCodeDataUrl: z.string(),
})
export type PairStartResponse = z.infer<typeof pairStartResponseSchema>

export const pairCompleteRequestSchema = z.object({
  challengeId: z.string(),
  code: z.string(),
  deviceName: z.string().min(1).max(120),
  platform: devicePlatformSchema,
  modelName: z.string().min(1).max(120).optional(),
  osName: z.string().min(1).max(80).optional(),
  osVersion: z.string().min(1).max(80).optional(),
  pushToken: z.string().optional(),
})
export type PairCompleteRequest = z.infer<typeof pairCompleteRequestSchema>

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
})
export type RefreshRequest = z.infer<typeof refreshRequestSchema>

export const pushTokenRequestSchema = z.object({
  pushToken: z.string().min(1),
})
export type PushTokenRequest = z.infer<typeof pushTokenRequestSchema>

export const authTokensSchema = z.object({
  deviceId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string(),
})
export type AuthTokens = z.infer<typeof authTokensSchema>

export const deviceMetadataSchema = z.object({
  modelName: z.string().min(1).max(120).nullable().default(null),
  osName: z.string().min(1).max(80).nullable().default(null),
  osVersion: z.string().min(1).max(80).nullable().default(null),
  locationCity: z.string().min(1).max(120).nullable().default(null),
  locationCountry: z.string().min(1).max(120).nullable().default(null),
  locationSharedAt: z.string().nullable().default(null),
})
export type DeviceMetadata = z.infer<typeof deviceMetadataSchema>

export const notificationPreferenceKeySchema = z.enum(["agent", "permissions", "errors"])
export type NotificationPreferenceKey = z.infer<typeof notificationPreferenceKeySchema>

export const soundEffectPreferenceSchema = z.enum(["staplebops-01", "staplebops-02", "nope-03", "silent"])
export type SoundEffectPreference = z.infer<typeof soundEffectPreferenceSchema>

export const deviceNotificationPreferencesSchema = z.object({
  agent: z.boolean().default(true),
  permissions: z.boolean().default(true),
  errors: z.boolean().default(true),
})
export type DeviceNotificationPreferences = z.infer<typeof deviceNotificationPreferencesSchema>

export const deviceSoundPreferencesSchema = z.object({
  agent: soundEffectPreferenceSchema.default("staplebops-01"),
  permissions: soundEffectPreferenceSchema.default("staplebops-02"),
  errors: soundEffectPreferenceSchema.default("nope-03"),
})
export type DeviceSoundPreferences = z.infer<typeof deviceSoundPreferencesSchema>

export const deviceMetadataUpdateRequestSchema = z.object({
  modelName: z.string().min(1).max(120).nullable().optional(),
  osName: z.string().min(1).max(80).nullable().optional(),
  osVersion: z.string().min(1).max(80).nullable().optional(),
  locationCity: z.string().min(1).max(120).nullable().optional(),
  locationCountry: z.string().min(1).max(120).nullable().optional(),
})
export type DeviceMetadataUpdateRequest = z.infer<typeof deviceMetadataUpdateRequestSchema>

export const devicePreferencesUpdateRequestSchema = z.object({
  notifications: deviceNotificationPreferencesSchema.partial().optional(),
  sounds: deviceSoundPreferencesSchema.partial().optional(),
})
export type DevicePreferencesUpdateRequest = z.infer<typeof devicePreferencesUpdateRequestSchema>

export const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: devicePlatformSchema,
  createdAt: z.string(),
  lastSeenAt: z.string(),
  revokedAt: z.string().nullable().default(null),
  pushToken: z.string().nullable().default(null),
  notificationPreferences: deviceNotificationPreferencesSchema.default({
    agent: true,
    permissions: true,
    errors: true,
  }),
  soundPreferences: deviceSoundPreferencesSchema.default({
    agent: "staplebops-01",
    permissions: "staplebops-02",
    errors: "nope-03",
  }),
}).extend(deviceMetadataSchema.shape)
export type Device = z.infer<typeof deviceSchema>

export const hostInfoSchema = z.object({
  hostId: z.string(),
  hostName: z.string(),
  publicBaseUrl: z.string(),
  opencodeBaseUrl: z.string(),
  opencodeReachable: z.boolean(),
  opencodeVersion: z.string().nullable(),
  activeSessions: z.number().int().nonnegative(),
  registeredDevices: z.number().int().nonnegative(),
})
export type HostInfo = z.infer<typeof hostInfoSchema>

export const deviceListResponseSchema = z.array(deviceSchema)
export type DeviceListResponse = z.infer<typeof deviceListResponseSchema>

export const hostLinkedDeviceSchema = z.object({
  name: z.string(),
  platform: devicePlatformSchema,
  modelName: z.string().nullable().default(null),
  osName: z.string().nullable().default(null),
  osVersion: z.string().nullable().default(null),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  locationCity: z.string().nullable().default(null),
  locationCountry: z.string().nullable().default(null),
})
export type HostLinkedDevice = z.infer<typeof hostLinkedDeviceSchema>

export const hostLinkedDeviceListResponseSchema = z.array(hostLinkedDeviceSchema)
export type HostLinkedDeviceListResponse = z.infer<typeof hostLinkedDeviceListResponseSchema>

export const projectDirectoryBrowseQuerySchema = z.object({
  path: z.string().min(1).optional(),
})
export type ProjectDirectoryBrowseQuery = z.infer<typeof projectDirectoryBrowseQuerySchema>

export const projectDirectoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
})
export type ProjectDirectoryEntry = z.infer<typeof projectDirectoryEntrySchema>

export const projectDirectoryBrowseResponseSchema = z.object({
  currentPath: z.string().nullable(),
  parentPath: z.string().nullable(),
  entries: z.array(projectDirectoryEntrySchema),
})
export type ProjectDirectoryBrowseResponse = z.infer<typeof projectDirectoryBrowseResponseSchema>

export const createProjectRequestSchema = z.object({
  directory: z.string().min(1),
})
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>

export const createProjectResponseSchema = z.object({
  sessionId: z.string(),
  directory: z.string(),
  createdDirectory: z.boolean(),
})
export type CreateProjectResponse = z.infer<typeof createProjectResponseSchema>

export const modelRefSchema = z.object({
  providerID: z.string(),
  modelID: z.string(),
})
export type ModelRef = z.infer<typeof modelRefSchema>

export const modelVariantSchema = z.object({
  id: z.string(),
  label: z.string(),
  reasoningEffort: z.string().nullable().default(null),
})
export type ModelVariant = z.infer<typeof modelVariantSchema>

export const promptAgentOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  mode: z.string(),
  isPrimary: z.boolean(),
  isNative: z.boolean(),
})
export type PromptAgentOption = z.infer<typeof promptAgentOptionSchema>

export const promptModelOptionSchema = z.object({
  id: z.string(),
  providerID: z.string(),
  providerName: z.string(),
  modelID: z.string(),
  name: z.string(),
  reasoningSupported: z.boolean(),
  supportsTools: z.boolean(),
  variants: z.array(modelVariantSchema),
})
export type PromptModelOption = z.infer<typeof promptModelOptionSchema>

export const promptOptionsResponseSchema = z.object({
  defaultAgent: z.string(),
  agents: z.array(promptAgentOptionSchema),
  models: z.array(promptModelOptionSchema),
})
export type PromptOptionsResponse = z.infer<typeof promptOptionsResponseSchema>

export const commandSourceSchema = z.enum(["built-in", "command", "mcp", "skill"])
export type CommandSource = z.infer<typeof commandSourceSchema>

export const commandSummarySchema = z.object({
  name: z.string(),
  description: z.string().nullable().default(null),
  source: commandSourceSchema,
  hints: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
})
export type CommandSummary = z.infer<typeof commandSummarySchema>

export const commandListResponseSchema = z.array(commandSummarySchema)
export type CommandListResponse = z.infer<typeof commandListResponseSchema>

export const commandExecuteRequestSchema = z.object({
  command: z.string().min(1),
  arguments: z.string().default(""),
  agent: z.string().optional(),
  model: modelRefSchema.optional(),
  variant: z.string().optional(),
})
export type CommandExecuteRequest = z.infer<typeof commandExecuteRequestSchema>

export const commandExecuteResponseSchema = z.object({
  accepted: z.literal(true),
  status: z.enum(["dispatched", "completed", "unsupported"]).default("completed"),
  message: z.string().nullable().default(null),
  sessionId: z.string().nullable().default(null),
  shareUrl: z.string().nullable().default(null),
})
export type CommandExecuteResponse = z.infer<typeof commandExecuteResponseSchema>

export const sessionStatusSchema = z.union([
  z.object({ type: z.literal("idle") }),
  z.object({ type: z.literal("busy") }),
  z.object({
    type: z.literal("retry"),
    attempt: z.number(),
    message: z.string(),
    next: z.number(),
  }),
])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string().nullable().default(null),
  directory: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  summary: z
    .object({
      additions: z.number().int(),
      deletions: z.number().int(),
      files: z.number().int(),
    })
    .nullable()
    .default(null),
  status: sessionStatusSchema,
  hasTui: z.boolean(),
})
export type SessionSummary = z.infer<typeof sessionSummarySchema>

export const promptRequestSchema = z.object({
  text: z.string().min(1),
  agent: z.string().optional(),
  system: z.string().optional(),
  model: modelRefSchema.optional(),
  variant: z.string().optional(),
  noReply: z.boolean().optional(),
})
export type PromptRequest = z.infer<typeof promptRequestSchema>

export const sessionControlRequestSchema = z.object({
  action: z.enum(["approve", "deny", "abort", "resume", "retry"]),
  permissionId: z.string().optional(),
  remember: z.boolean().optional(),
  message: z.string().optional(),
  agent: z.string().optional(),
  model: modelRefSchema.optional(),
  variant: z.string().optional(),
})
export type SessionControlRequest = z.infer<typeof sessionControlRequestSchema>

export const sessionDetailSchema = z.object({
  summary: sessionSummarySchema,
  session: z.record(z.string(), z.unknown()),
  messages: z.array(z.record(z.string(), z.unknown())),
  todo: z.array(z.record(z.string(), z.unknown())),
  diff: z.array(z.record(z.string(), z.unknown())),
  diffInfo: z.object({
    status: z.enum(["ready", "omitted", "unavailable"]),
    message: z.string().nullable().default(null),
  }),
})
export type SessionDetail = z.infer<typeof sessionDetailSchema>

export const streamEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("host.status"),
    payload: hostInfoSchema,
  }),
  z.object({
    kind: z.literal("session.snapshot"),
    payload: sessionSummarySchema,
  }),
  z.object({
    kind: z.literal("session.event"),
    payload: z.object({
      sessionId: z.string().nullable(),
      sourceType: z.string(),
      raw: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({
    kind: z.literal("session.approval_requested"),
    payload: z.object({
      sessionId: z.string(),
      permissionId: z.string(),
      permission: z.string(),
      patterns: z.array(z.string()).default([]),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
  }),
  z.object({
    kind: z.literal("session.approval_resolved"),
    payload: z.object({
      sessionId: z.string(),
      permissionId: z.string(),
      resolution: z.string(),
    }),
  }),
  z.object({
    kind: z.literal("session.diff_ready"),
    payload: z.object({
      sessionId: z.string(),
      diffCount: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    kind: z.literal("terminal.frame"),
    payload: z.object({
      sessionId: z.string(),
      data: z.string(),
    }),
  }),
  z.object({
    kind: z.literal("terminal.exit"),
    payload: z.object({
      sessionId: z.string(),
      exitCode: z.number().nullable(),
      signal: z.number().nullable().optional(),
    }),
  }),
  z.object({
    kind: z.literal("notification.test"),
    payload: z.object({
      sentAt: z.string(),
    }),
  }),
])
export type StreamEvent = z.infer<typeof streamEventSchema>

export const terminalInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("input"),
    data: z.string(),
  }),
  z.object({
    type: z.literal("resize"),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("interrupt"),
  }),
  z.object({
    type: z.literal("detach"),
  }),
])
export type TerminalInput = z.infer<typeof terminalInputSchema>
