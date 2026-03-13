import os from "node:os"
import Fastify from "fastify"
import cors from "@fastify/cors"
import websocket from "@fastify/websocket"
import QRCode from "qrcode"
import type { CommandSummary, Device } from "@opencode-remote/shared"
import { z } from "zod"
import {
  createProjectRequestSchema,
  createProjectResponseSchema,
  commandExecuteRequestSchema,
  commandExecuteResponseSchema,
  commandListResponseSchema,
  deviceMetadataUpdateRequestSchema,
  devicePreferencesUpdateRequestSchema,
  hostInfoSchema,
  hostLinkedDeviceListResponseSchema,
  pairCompleteRequestSchema,
  pairStartRequestSchema,
  projectDirectoryBrowseQuerySchema,
  projectDirectoryBrowseResponseSchema,
  promptOptionsResponseSchema,
  promptRequestSchema,
  pushTokenRequestSchema,
  refreshRequestSchema,
  sessionControlRequestSchema,
  sessionDetailSchema,
  sessionSummarySchema,
  streamEventSchema,
} from "@opencode-remote/shared"
import { AuthService } from "./auth.js"
import type { AppConfig } from "./config.js"
import { NotificationService } from "./notification-service.js"
import { OpenCodeClient } from "./opencode-client.js"
import { RealtimeHub } from "./realtime-hub.js"
import { StateStore } from "./state-store.js"
import { TerminalManager } from "./terminal-manager.js"
import { PowerShellHostControl, type HostControl } from "./host-control.js"
import { loadHostPageAssets, renderHostPage } from "./host-page.js"
import {
  ProjectFilesystemService,
  ProjectFilesystemServiceError,
} from "./project-filesystem-service.js"

const MAX_INLINE_DIFF_FILES = 200
const MAX_INLINE_DIFF_CHANGES = 10_000
const DIFF_FETCH_TIMEOUT_MS = 2_500

function toQrCodeDataUrl(payload: string) {
  return new Promise<string>((resolve, reject) => {
    QRCode.toDataURL(
      payload,
      {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 240,
      },
      (error, dataUrl) => {
        if (error) {
          reject(error)
          return
        }
        resolve(dataUrl)
      },
    )
  })
}

async function buildHostInfo(store: StateStore, opencode: OpenCodeClient, config: AppConfig) {
  const health = await opencode.health().catch(() => null)
  const statuses = await opencode.sessionStatuses().catch(() => ({}))
  return hostInfoSchema.parse({
    hostId: store.getHostId(),
    hostName: os.hostname(),
    publicBaseUrl: config.PUBLIC_BASE_URL,
    opencodeBaseUrl: config.OPENCODE_BASE_URL,
    opencodeReachable: Boolean(health?.healthy),
    opencodeVersion: health?.version ?? null,
    activeSessions: Object.values(statuses).filter((item) => item.type !== "idle").length,
    registeredDevices: store.listDevices().filter((item) => !item.revokedAt).length,
  })
}

function shouldInlineDiff(summary?: { additions: number; deletions: number; files: number } | null) {
  if (!summary) return true
  const totalChanges = summary.additions + summary.deletions
  return summary.files <= MAX_INLINE_DIFF_FILES && totalChanges <= MAX_INLINE_DIFF_CHANGES
}

function resolveCommand(commands: CommandSummary[], rawCommand: string) {
  const normalized = rawCommand.trim().toLowerCase()
  if (!normalized) return null

  return (
    commands.find((command) => command.name.toLowerCase() === normalized) ??
    commands.find((command) => command.aliases.some((alias) => alias.toLowerCase() === normalized)) ??
    null
  )
}

function readStringProperty(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  return typeof record[key] === "string" ? record[key] : null
}

function readShareUrl(value: unknown) {
  if (typeof value !== "object" || value === null) return null
  const share = (value as Record<string, unknown>).share
  return readStringProperty(share, "url")
}

function toHostLinkedDevice(device: Device) {
  return {
    name: device.name,
    platform: device.platform,
    modelName: device.modelName ?? null,
    osName: device.osName ?? null,
    osVersion: device.osVersion ?? null,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    locationCity: device.locationCity ?? null,
    locationCountry: device.locationCountry ?? null,
  }
}

function replyWithProjectFilesystemError(error: unknown) {
  if (error instanceof ProjectFilesystemServiceError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.message,
      },
    }
  }

  return {
    statusCode: 500,
    body: {
      error: "The PC could not finish that project request.",
    },
  }
}

type BuildAppDependencies = {
  hostControl?: HostControl
  projectFilesystem?: ProjectFilesystemService
}

const hostStartupRequestSchema = z.object({
  enabled: z.boolean(),
})

export async function buildApp(config: AppConfig, dependencies: BuildAppDependencies = {}) {
  const app = Fastify({
    logger: true,
  })

  const store = new StateStore(config.stateFile, config.PAIR_CODE_TTL_MS, config.REFRESH_TOKEN_TTL_SECONDS)
  await store.init()

  const auth = new AuthService(store, store.getHostId(), config.JWT_SECRET, config.ACCESS_TOKEN_TTL_SECONDS)
  const opencode = new OpenCodeClient(config.OPENCODE_BASE_URL, config.OPENCODE_PASSWORD)
  const hub = new RealtimeHub()
  const notifications = new NotificationService(true)
  const terminals = new TerminalManager({
    opencodeBin: config.OPENCODE_BIN,
    opencodeUrl: config.OPENCODE_BASE_URL,
    opencodePassword: config.OPENCODE_PASSWORD,
  })
  const hostControl = dependencies.hostControl ?? new PowerShellHostControl()
  const projectFilesystem = dependencies.projectFilesystem ?? new ProjectFilesystemService()
  const hostPageAssets = await loadHostPageAssets()

  await app.register(cors, {
    origin: true,
  })
  await app.register(websocket)

  const sseAbort = new AbortController()
  const sessionStatusMemory = new Map<string, string>()
  void opencode.subscribe(async (event) => {
    try {
      const properties =
        typeof event.properties === "object" && event.properties !== null ? event.properties : {}
      const eventType = typeof event.type === "string" ? event.type : null

      if (!eventType) {
        app.log.warn({ event }, "Skipping OpenCode SSE event without a type")
        return
      }

      if (eventType === "permission.asked") {
        void notifications
          .sendToDevices(store.listDevices(), {
            category: "permissions",
            title: "Approval needed",
            body: `${String(properties.permission ?? "Permission request")} needs your response`,
            data: {
              screen: "session",
              sessionId: String(properties.sessionID ?? ""),
              permissionId: String(properties.id ?? ""),
            },
          })
          .catch((error) => {
            app.log.warn({ error }, "Failed to send approval notification")
          })

        hub.broadcast(
          streamEventSchema.parse({
            kind: "session.approval_requested",
            payload: {
              sessionId: String(properties.sessionID ?? ""),
              permissionId: String(properties.id ?? ""),
              permission: String(properties.permission ?? "unknown"),
              patterns: Array.isArray(properties.patterns)
                ? properties.patterns.map((item) => String(item))
                : [],
              metadata:
                typeof properties.metadata === "object" && properties.metadata
                  ? properties.metadata
                  : {},
            },
          }),
        )
        return
      }

      if (eventType === "permission.replied") {
        hub.broadcast(
          streamEventSchema.parse({
            kind: "session.approval_resolved",
            payload: {
              sessionId: String(properties.sessionID ?? ""),
              permissionId: String(properties.requestID ?? properties.permissionID ?? ""),
              resolution: String(properties.reply ?? properties.response ?? "unknown"),
            },
          }),
        )
        return
      }

      if (eventType === "session.status") {
        const sessionId = String(properties.sessionID ?? "")
        const nextType =
          typeof (properties.status as { type?: string } | undefined)?.type === "string"
            ? String((properties.status as { type?: string }).type)
            : "idle"
        const previousType = sessionStatusMemory.get(sessionId)
        sessionStatusMemory.set(sessionId, nextType)

        if ((previousType === "busy" || previousType === "retry") && nextType === "idle") {
          void notifications
            .sendToDevices(store.listDevices(), {
              category: "agent",
              title: "Session complete",
              body: `Session ${sessionId} is idle again`,
              data: {
                screen: "session",
                sessionId,
              },
            })
            .catch((error) => {
              app.log.warn({ error }, "Failed to send completion notification")
            })
        }

        if (nextType === "retry" && previousType !== "retry") {
          const retryMessage =
            typeof (properties.status as { message?: string } | undefined)?.message === "string"
              ? String((properties.status as { message?: string }).message)
              : "The session reported a retry-worthy error."

          void notifications
            .sendToDevices(store.listDevices(), {
              category: "errors",
              title: "Session needs attention",
              body: retryMessage,
              data: {
                screen: "session",
                sessionId,
              },
            })
            .catch((error) => {
              app.log.warn({ error }, "Failed to send retry notification")
            })
        }

        const sessions = await opencode.listSessions().catch(() => [])
        const statuses = await opencode.sessionStatuses().catch<Record<string, { type: "idle" }>>(() => ({}))
        const session = sessions.find((item) => item.id === sessionId)
        if (session) {
          hub.broadcast(
            streamEventSchema.parse({
              kind: "session.snapshot",
              payload: opencode.toSummary(session, statuses[session.id] ?? { type: "idle" }),
            }),
          )
        }
        return
      }

      hub.broadcast(
        streamEventSchema.parse({
          kind: "session.event",
          payload: {
            sessionId: typeof properties.sessionID === "string" ? properties.sessionID : null,
            sourceType: eventType,
            raw: properties,
          },
        }),
      )
    } catch (error) {
      app.log.warn({ error, event }, "Failed to process OpenCode SSE event")
    }
  }, sseAbort.signal).catch((error) => {
    app.log.warn({ error }, "OpenCode SSE bridge stopped")
  })

  app.addHook("onClose", async () => {
    sseAbort.abort()
  })

  app.get("/", async (_request, reply) => {
    const hostControls = await hostControl.getSnapshot().catch((error) => {
      app.log.warn({ error }, "Failed to load host controls for the pairing page")
      return {
        startupEnabled: false,
        startupSupported: false,
        disconnectSupported: false,
      }
    })

    reply
      .type("text/html")
      .send(
        renderHostPage(
          config.PUBLIC_BASE_URL,
          hostPageAssets,
          hostControls,
          store.listDevices().length,
        ),
      )
  })

  app.get("/healthz", async () => ({ ok: true }))

  app.get("/host/devices", async () =>
    hostLinkedDeviceListResponseSchema.parse(
      store
        .listDevices()
        .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
        .map(toHostLinkedDevice),
    ),
  )

  app.post("/host/windows-startup", async (request, reply) => {
    const body = hostStartupRequestSchema.parse(request.body ?? {})

    try {
      const snapshot = await hostControl.setStartupEnabled(body.enabled)
      if (!snapshot.startupSupported) {
        reply.code(501)
        return {
          error: "Automatic startup controls are unavailable on this host.",
          ...snapshot,
        }
      }

      return snapshot
    } catch (error) {
      app.log.warn({ error }, "Failed to update Windows startup")
      reply.code(500)
      return {
        error: "Failed to update automatic startup on this host.",
      }
    }
  })

  app.post("/host/devices/unlink", async (_request, reply) => {
    try {
      const revoked = await store.revokeAllDevices()
      return {
        revoked,
        remaining: store.listDevices().length,
      }
    } catch (error) {
      app.log.warn({ error }, "Failed to unlink paired devices")
      reply.code(500)
      return {
        error: "Failed to unlink paired devices from this PC.",
      }
    }
  })

  app.post("/host/disconnect", async (_request, reply) => {
    const snapshot = await hostControl.getSnapshot().catch((error) => {
      app.log.warn({ error }, "Failed to load host controls before disconnect")
      return {
        startupEnabled: false,
        startupSupported: false,
        disconnectSupported: false,
      }
    })

    if (!snapshot.disconnectSupported) {
      reply.code(501)
      return {
        error: "Stopping OpenCode on this host is unavailable right now.",
      }
    }

    reply.raw.once("finish", () => {
      setTimeout(() => {
        void hostControl.disconnectHost().catch((error) => {
          app.log.error({ error }, "Failed to stop the host after disconnect was requested")
        })
      }, 150)
    })

    reply.send({
      accepted: true,
    })
    return reply
  })

  app.post("/mobile/pair/start", async (request) => {
    const body = pairStartRequestSchema.parse(request.body ?? {})
    const challenge = await store.createPairingChallenge(body.label)
    const qrPayload = JSON.stringify({
      serverUrl: config.PUBLIC_BASE_URL,
      challengeId: challenge.id,
      code: challenge.code,
    })
    const qrCodeDataUrl = await toQrCodeDataUrl(qrPayload)
    return {
      challengeId: challenge.id,
      code: challenge.code,
      expiresAt: challenge.expiresAt,
      qrPayload,
      qrCodeDataUrl,
    }
  })

  app.post("/mobile/pair/complete", async (request, reply) => {
    const body = pairCompleteRequestSchema.parse(request.body)
    const challenge = await store.consumePairingChallenge(body.challengeId, body.code)
    if (!challenge) {
      reply.code(400)
      return { error: "Invalid or expired pairing challenge" }
    }
    const device = await store.registerDevice({
      name: body.deviceName,
      platform: body.platform,
      modelName: body.modelName,
      osName: body.osName,
      osVersion: body.osVersion,
      pushToken: body.pushToken,
    })
    return auth.issueBundle(device)
  })

  app.post("/mobile/auth/refresh", async (request, reply) => {
    const body = refreshRequestSchema.parse(request.body)
    const rotated = await store.rotateRefreshToken(body.refreshToken)
    if (!rotated) {
      reply.code(401)
      return { error: "Invalid refresh token" }
    }
    return auth.issueBundle(rotated.device, rotated.refreshToken)
  })

  app.get(
    "/mobile/devices",
    { preHandler: auth.authenticate },
    async () => store.listDevices(),
  )

  app.post(
    "/mobile/devices/:deviceId/revoke",
    { preHandler: auth.authenticate },
    async (request) => {
      const deviceId = (request.params as { deviceId: string }).deviceId
      return {
        revoked: await store.revokeDevice(deviceId),
      }
    },
  )

  app.post(
    "/mobile/devices/me/metadata",
    { preHandler: auth.authenticate },
    async (request, reply) => {
      const body = deviceMetadataUpdateRequestSchema.parse(request.body ?? {})
      const deviceId = request.authDevice?.id

      if (!deviceId) {
        reply.code(401)
        return { error: "Unknown device" }
      }

      const device = await store.updateDeviceMetadata(deviceId, body)
      if (!device) {
        reply.code(404)
        return { error: "Device not found" }
      }

      return device
    },
  )

  app.post(
    "/mobile/devices/me/preferences",
    { preHandler: auth.authenticate },
    async (request, reply) => {
      const body = devicePreferencesUpdateRequestSchema.parse(request.body ?? {})
      const deviceId = request.authDevice?.id
      if (!deviceId) {
        reply.code(401)
        return { error: "Unknown device" }
      }

      const device = await store.updateDevicePreferences(deviceId, body)
      if (!device) {
        reply.code(404)
        return { error: "Device not found" }
      }

      return device
    },
  )

  app.post(
    "/mobile/devices/:deviceId/push-token",
    { preHandler: auth.authenticate },
    async (request, reply) => {
      const body = pushTokenRequestSchema.parse(request.body)
      const deviceId = (request.params as { deviceId: string }).deviceId
      const device = await store.setPushToken(deviceId, body.pushToken)
      if (!device) {
        reply.code(404)
        return { error: "Device not found" }
      }
      return device
    },
  )

  app.get("/mobile/host", { preHandler: auth.authenticate }, async () => buildHostInfo(store, opencode, config))

  app.get(
    "/mobile/prompt/options",
    { preHandler: auth.authenticate },
    async () => promptOptionsResponseSchema.parse(await opencode.listPromptOptions()),
  )

  app.get(
    "/mobile/commands",
    { preHandler: auth.authenticate },
    async () => commandListResponseSchema.parse(await opencode.listCommands()),
  )

  app.get(
    "/mobile/sessions",
    { preHandler: auth.authenticate },
    async () => {
      const [sessions, statuses] = await Promise.all([opencode.listSessions(), opencode.sessionStatuses()])
      return sessions.map((session) => {
        const status = ((statuses as Record<string, unknown>)[session.id] as { type: "idle" } | { type: "busy" } | { type: "retry"; attempt: number; message: string; next: number } | undefined) ?? { type: "idle" }
        return sessionSummarySchema.parse(opencode.toSummary(session, status))
      })
    },
  )

  app.get(
    "/mobile/projects/directories",
    { preHandler: auth.authenticate },
    async (request, reply) => {
      const query = projectDirectoryBrowseQuerySchema.parse(request.query)

      try {
        return projectDirectoryBrowseResponseSchema.parse(await projectFilesystem.browseDirectories(query.path))
      } catch (error) {
        const response = replyWithProjectFilesystemError(error)
        reply.code(response.statusCode)
        return response.body
      }
    },
  )

  app.post(
    "/mobile/projects",
    { preHandler: auth.authenticate },
    async (request, reply) => {
      const body = createProjectRequestSchema.parse(request.body)

      try {
        const projectDirectory = await projectFilesystem.createProjectDirectory(body.directory)
        const session = await opencode.createSession(projectDirectory.directory)
        const sessionId = readStringProperty(session, "id")
        if (!sessionId) {
          throw new Error("OpenCode did not return a session id.")
        }

        return createProjectResponseSchema.parse({
          sessionId,
          directory: projectDirectory.directory,
          createdDirectory: projectDirectory.createdDirectory,
        })
      } catch (error) {
        const response = replyWithProjectFilesystemError(error)
        if (response.statusCode !== 500 || error instanceof ProjectFilesystemServiceError) {
          reply.code(response.statusCode)
          return response.body
        }

        throw error
      }
    },
  )

  app.get(
    "/mobile/sessions/:sessionId",
    { preHandler: auth.authenticate },
    async (request) => {
      const sessionId = (request.params as { sessionId: string }).sessionId
      const [session, messages, todo, statuses] = await Promise.all([
        opencode.getSession(sessionId),
        opencode.getMessages(sessionId),
        opencode.getTodo(sessionId),
        opencode.sessionStatuses(),
      ])
      const sessionInfo = session as {
        id: string
        slug: string
        directory: string
        title: string
        summary?: { additions: number; deletions: number; files: number }
        time: { created: number; updated: number }
      }
      let diff: Record<string, unknown>[] = []
      let diffInfo: { status: "ready" | "omitted" | "unavailable"; message: string | null } = {
        status: "ready",
        message: null,
      }

      if (shouldInlineDiff(sessionInfo.summary ?? null)) {
        try {
          diff = await opencode.getDiff(sessionId, DIFF_FETCH_TIMEOUT_MS)
        } catch (error) {
          app.log.warn({ error, sessionId }, "Skipping diff for session detail")
          diffInfo = {
            status: "unavailable",
            message: "Diff took too long to load.",
          }
        }
      } else {
        diffInfo = {
          status: "omitted",
          message: "Diff omitted for large session changes.",
        }
      }

      return sessionDetailSchema.parse({
        summary: opencode.toSummary(sessionInfo, statuses[sessionId] ?? { type: "idle" }),
        session,
        messages,
        todo,
        diff,
        diffInfo,
      })
    },
  )

  app.post(
    "/mobile/sessions/:sessionId/prompt",
    { preHandler: auth.authenticate },
    async (request) => {
      const sessionId = (request.params as { sessionId: string }).sessionId
      const body = promptRequestSchema.parse(request.body)
      await opencode.prompt(sessionId, body)
      return { accepted: true }
    },
  )

  app.post(
    "/mobile/sessions/:sessionId/command",
    { preHandler: auth.authenticate },
    async (request) => {
      const sessionId = (request.params as { sessionId: string }).sessionId
      const body = commandExecuteRequestSchema.parse(request.body)
      const commands = await opencode.listCommands()
      const resolved = resolveCommand(commands, body.command)
      const commandName = resolved?.name ?? body.command.trim()

      if (!resolved) {
        return commandExecuteResponseSchema.parse({
          accepted: true,
          status: "unsupported",
          message: `/${commandName} is not available on this host.`,
        })
      }

      if (resolved?.source !== "built-in") {
        opencode.runCommandDetached(sessionId, {
          ...body,
          command: commandName,
        })
        return commandExecuteResponseSchema.parse({
          accepted: true,
          status: "dispatched",
          message: `Started /${commandName}.`,
        })
      }

      switch (commandName) {
        case "new": {
          const currentSession = await opencode.getSession(sessionId)
          const nextSession = await opencode.createSession(readStringProperty(currentSession, "directory") ?? undefined)
          return commandExecuteResponseSchema.parse({
            accepted: true,
            status: "completed",
            message: "Started a new session.",
            sessionId: readStringProperty(nextSession, "id"),
          })
        }
        case "share": {
          const sharedSession = await opencode.shareSession(sessionId)
          const shareUrl = readShareUrl(sharedSession)
          return commandExecuteResponseSchema.parse({
            accepted: true,
            status: "completed",
            message: shareUrl ? "Session shared." : "Sharing enabled for this session.",
            shareUrl,
          })
        }
        case "unshare": {
          await opencode.unshareSession(sessionId)
          return commandExecuteResponseSchema.parse({
            accepted: true,
            status: "completed",
            message: "Sharing disabled for this session.",
          })
        }
        case "rename": {
          const nextTitle = body.arguments.trim()
          if (!nextTitle) {
            return commandExecuteResponseSchema.parse({
              accepted: true,
              status: "unsupported",
              message: "Type /rename followed by the new session title.",
            })
          }
          await opencode.renameSession(sessionId, nextTitle)
          return commandExecuteResponseSchema.parse({
            accepted: true,
            status: "completed",
            message: `Renamed the session to "${nextTitle}".`,
          })
        }
        case "compact": {
          if (!body.model) {
            return commandExecuteResponseSchema.parse({
              accepted: true,
              status: "unsupported",
              message: "Choose a model before using /compact on mobile.",
            })
          }
          opencode.summarizeSessionDetached(sessionId, {
            model: body.model,
            variant: body.variant,
          })
          return commandExecuteResponseSchema.parse({
            accepted: true,
            status: "dispatched",
            message: "Started compacting this session.",
          })
        }
        case "undo": {
          const result = await opencode.undoSession(sessionId)
          return commandExecuteResponseSchema.parse({
            accepted: true,
            status: "completed",
            message: result ? "Reverted the latest user turn." : "Nothing to undo yet.",
          })
        }
        case "redo": {
          const result = await opencode.redoSession(sessionId)
          return commandExecuteResponseSchema.parse({
            accepted: true,
            status: "completed",
            message: result ? "Restored the latest reverted turn." : "Nothing to redo yet.",
          })
        }
        default:
          return commandExecuteResponseSchema.parse({
            accepted: true,
            status: "unsupported",
            message: `/${commandName} is not available in the mobile session view yet.`,
          })
      }
    },
  )

  app.post(
    "/mobile/sessions/:sessionId/control",
    { preHandler: auth.authenticate },
    async (request) => {
      const sessionId = (request.params as { sessionId: string }).sessionId
      const body = sessionControlRequestSchema.parse(request.body)
      const result = await opencode.control(sessionId, body)
      return {
        supported: true,
        result,
        mode: body.action === "resume" || body.action === "retry" ? "synthetic_prompt" : "native_api",
      }
    },
  )

  app.get(
    "/mobile/stream",
    { websocket: true, preHandler: auth.authenticate },
    async (socket) => {
      hub.subscribe(socket)
      socket.send(JSON.stringify(streamEventSchema.parse({ kind: "host.status", payload: await buildHostInfo(store, opencode, config) })))
      const [sessions, statuses] = await Promise.all([opencode.listSessions(), opencode.sessionStatuses()])
      for (const session of sessions) {
        socket.send(
          JSON.stringify(
            streamEventSchema.parse({
              kind: "session.snapshot",
              payload: opencode.toSummary(session, statuses[session.id] ?? { type: "idle" }),
            }),
          ),
        )
      }
    },
  )

  app.get(
    "/mobile/terminal/:sessionId",
    { websocket: true, preHandler: auth.authenticate },
    (socket, request) => {
      const sessionId = (request.params as { sessionId: string }).sessionId
      terminals.attach(sessionId, socket)
    },
  )

  return app
}
