import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import Fastify from "fastify"
import { buildApp } from "../src/app.js"
import type { AppConfig } from "../src/config.js"
import type { HostControlSnapshot } from "../src/host-control.js"

const tempDir = path.join(os.tmpdir(), `opencode-remote-test-${Date.now()}`)
const stateFile = path.join(tempDir, "state.json")

let upstream: Awaited<ReturnType<typeof Fastify>>
let app: Awaited<ReturnType<typeof buildApp>>
let promptBodies: Array<Record<string, unknown>> = []
let commandBodies: Array<Record<string, unknown>> = []
let createdSessions = 0
let disconnectRequests = 0
let hostControlState: HostControlSnapshot = {
  startupEnabled: false,
  startupSupported: true,
  disconnectSupported: true,
}

beforeAll(async () => {
  await fs.mkdir(tempDir, { recursive: true })
  upstream = Fastify()
  upstream.get("/global/health", async () => ({ healthy: true, version: "1.2.24" }))
  upstream.get("/global/event", async (_request: unknown, reply: any) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "keep-alive",
      "cache-control": "no-cache",
    })
    reply.raw.write(`data: ${JSON.stringify({ type: "session.status", properties: { sessionID: "session-1", status: { type: "idle" } } })}\n\n`)
  })
  upstream.get("/session", async () => [
    {
      id: "session-1",
      slug: "remote-demo",
      directory: "/workspace",
      title: "Remote demo",
      summary: { additions: 1, deletions: 0, files: 1 },
      time: { created: Date.now(), updated: Date.now() },
    },
  ])
  upstream.post("/session", async (request: any) => {
    createdSessions += 1
    const body = (request.body as { directory?: string } | undefined) ?? {}
    return {
      id: `session-created-${createdSessions}`,
      slug: `created-${createdSessions}`,
      directory: body.directory ?? "/workspace",
      title: `Created session ${createdSessions}`,
      time: { created: Date.now(), updated: Date.now() },
    }
  })
  upstream.get("/session/status", async () => ({
    "session-1": { type: "idle" },
  }))
  upstream.get("/session/:sessionId", async (request: any) => ({
    id: (request.params as { sessionId: string }).sessionId,
    slug: (request.params as { sessionId: string }).sessionId === "session-large" ? "large-demo" : "remote-demo",
    directory: "/workspace",
    title: (request.params as { sessionId: string }).sessionId === "session-large" ? "Large demo" : "Remote demo",
    summary:
      (request.params as { sessionId: string }).sessionId === "session-large"
        ? { additions: 12000, deletions: 500, files: 400 }
        : { additions: 1, deletions: 0, files: 1 },
    time: { created: Date.now(), updated: Date.now() },
  }))
  upstream.get("/session/:sessionId/message", async () => [])
  upstream.get("/session/:sessionId/todo", async () => [])
  upstream.get("/session/:sessionId/diff", async (request: any, reply: any) => {
    if ((request.params as { sessionId: string }).sessionId === "session-large") {
      reply.code(500)
      return { error: "Diff should not be requested for large sessions" }
    }
    return []
  })
  upstream.get("/agent", async () => ({
    value: [
      {
        name: "build",
        description: "Build mode",
        mode: "primary",
        native: true,
      },
      {
        name: "plan",
        description: "Plan mode",
        mode: "primary",
        native: true,
      },
      {
        name: "explore",
        description: "Explore mode",
        mode: "subagent",
        native: true,
      },
      {
        name: "summary",
        mode: "primary",
        native: true,
        hidden: true,
      },
      {
        name: "title",
        mode: "primary",
        native: true,
        hidden: true,
      },
    ],
  }))
  upstream.get("/config/providers", async () => ({
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-5.4": {
            id: "gpt-5.4",
            providerID: "openai",
            name: "GPT-5.4",
            capabilities: {
              reasoning: true,
              toolcall: true,
            },
            variants: {
              low: { reasoningEffort: "low" },
              high: { reasoningEffort: "high" },
            },
          },
          "text-only": {
            id: "text-only",
            providerID: "openai",
            name: "Text Only",
            capabilities: {
              reasoning: false,
              toolcall: false,
            },
            variants: {},
          },
        },
      },
    ],
    default: {
      openai: "gpt-5.4",
    },
  }))
  upstream.get("/command", async () => [
    {
      name: "init",
      description: "create/update AGENTS.md",
      source: "command",
      hints: ["$ARGUMENTS"],
    },
    {
      name: "review",
      description: "review changes [commit|branch|pr], defaults to uncommitted",
      source: "command",
      hints: ["$ARGUMENTS"],
    },
    {
      name: "frontend-design",
      description: "Create distinctive frontend interfaces.",
      source: "skill",
      hints: [],
    },
  ])
  upstream.post("/session/:sessionId/prompt_async", async (_request: unknown, reply: any) => {
    promptBodies.push((_request as { body?: Record<string, unknown> }).body ?? {})
    reply.code(204)
    return ""
  })
  upstream.post("/session/:sessionId/command", async (_request: unknown) => {
    commandBodies.push((_request as { body?: Record<string, unknown> }).body ?? {})
    return {
      info: {
        id: "msg_command",
        role: "assistant",
      },
      parts: [],
    }
  })
  upstream.post("/session/:sessionId/share", async (request: any) => ({
    id: (request.params as { sessionId: string }).sessionId,
    share: {
      url: `https://example.test/share/${(request.params as { sessionId: string }).sessionId}`,
    },
  }))
  upstream.delete("/session/:sessionId/share", async (request: any) => ({
    id: (request.params as { sessionId: string }).sessionId,
    share: null,
  }))
  upstream.patch("/session/:sessionId", async (request: any) => ({
    id: (request.params as { sessionId: string }).sessionId,
    title: ((request.body as { title?: string } | undefined) ?? {}).title ?? "Untitled",
  }))
  upstream.post("/session/:sessionId/summarize", async () => true)
  upstream.post("/session/:sessionId/revert", async (_request: unknown) => ({
    ok: true,
  }))
  upstream.post("/session/:sessionId/unrevert", async (_request: unknown) => ({
    ok: true,
  }))
  upstream.post("/session/:sessionId/abort", async () => true)
  upstream.post("/session/:sessionId/permissions/:permissionId", async () => true)
  await upstream.listen({ host: "127.0.0.1", port: 48096 })

  const config: AppConfig = {
    GATEWAY_HOST: "127.0.0.1",
    GATEWAY_PORT: 8787,
    PUBLIC_BASE_URL: "http://localhost:8787",
    OPENCODE_BASE_URL: "http://127.0.0.1:48096",
    OPENCODE_PASSWORD: undefined,
    OPENCODE_BIN: "opencode",
    JWT_SECRET: "test-secret-test-secret",
    PAIR_CODE_TTL_MS: 300000,
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_SECONDS: 2592000,
    STATE_FILE: stateFile,
    stateFile,
  }
  app = await buildApp(config, {
    hostControl: {
      getSnapshot: async () => ({ ...hostControlState }),
      setStartupEnabled: async (enabled: boolean) => {
        hostControlState = {
          ...hostControlState,
          startupEnabled: enabled,
        }
        return { ...hostControlState }
      },
      disconnectHost: async () => {
        disconnectRequests += 1
      },
    },
  })
})

afterAll(async () => {
  await app.close()
  await upstream.close()
  await fs.rm(tempDir, { recursive: true, force: true })
})

async function pairMobileDevice(deviceName: string, platform: "android" | "ios" = "android") {
  const pairStart = await app.inject({
    method: "POST",
    url: "/mobile/pair/start",
    payload: {},
  })
  expect(pairStart.statusCode).toBe(200)

  const started = pairStart.json()
  const pairComplete = await app.inject({
    method: "POST",
    url: "/mobile/pair/complete",
    payload: {
      challengeId: started.challengeId,
      code: started.code,
      deviceName,
      platform,
    },
  })
  expect(pairComplete.statusCode).toBe(200)
  return pairComplete.json()
}

describe("gateway pairing flow", () => {
  it("renders the branded host pairing page", async () => {
    hostControlState = {
      startupEnabled: false,
      startupSupported: true,
      disconnectSupported: true,
    }
    const response = await app.inject({
      method: "GET",
      url: "/",
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.body).toContain("OpenCode companion")
    expect(response.body).toContain("Generate pairing challenge")
    expect(response.body).toContain("same Wi-Fi network")
    expect(response.body).toContain("Copy all")
    expect(response.body).toContain("Host controls")
    expect(response.body).toContain("Turn on automatic startup")
    expect(response.body).toContain("Unlink all paired phones")
    expect(response.body).toContain("Stop everything now")
    expect(response.body).toContain("Reveal linked phone details")
  })

  it("keeps linked phone details out of the initial host page html", async () => {
    await app.inject({
      method: "POST",
      url: "/host/devices/unlink",
    })

    const pairStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    const started = pairStart.json()

    const pairComplete = await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: started.challengeId,
        code: started.code,
        deviceName: "Hidden Device",
        platform: "android",
        modelName: "Pixel 9 Pro",
        osName: "Android",
        osVersion: "16",
      },
    })
    expect(pairComplete.statusCode).toBe(200)

    const response = await app.inject({
      method: "GET",
      url: "/",
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain("1 phone linked")
    expect(response.body).not.toContain("Hidden Device")
    expect(response.body).not.toContain("Pixel 9 Pro")
  })

  it("toggles automatic startup from the host page controls", async () => {
    hostControlState = {
      startupEnabled: false,
      startupSupported: true,
      disconnectSupported: true,
    }

    const response = await app.inject({
      method: "POST",
      url: "/host/windows-startup",
      payload: {
        enabled: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      startupEnabled: true,
      startupSupported: true,
      disconnectSupported: true,
    })
  })

  it("unlinks every paired device from the host page controls", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/host/devices/unlink",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ remaining: 0 })
    expect(response.json().revoked).toBeGreaterThanOrEqual(0)

    const pairStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    const started = pairStart.json()
    await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: started.challengeId,
        code: started.code,
        deviceName: "Phone A",
        platform: "android",
      },
    })
    await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    }).then(async (secondStart) => {
      const second = secondStart.json()
      await app.inject({
        method: "POST",
        url: "/mobile/pair/complete",
        payload: {
          challengeId: second.challengeId,
          code: second.code,
          deviceName: "Phone B",
          platform: "ios",
        },
      })
    })

    const unlink = await app.inject({
      method: "POST",
      url: "/host/devices/unlink",
    })

    expect(unlink.statusCode).toBe(200)
    expect(unlink.json()).toEqual({ revoked: 2, remaining: 0 })
  })

  it("accepts a host shutdown request from the host page controls", async () => {
    disconnectRequests = 0
    hostControlState = {
      startupEnabled: true,
      startupSupported: true,
      disconnectSupported: true,
    }

    const response = await app.inject({
      method: "POST",
      url: "/host/disconnect",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ accepted: true })

    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(disconnectRequests).toBe(1)
  })

  it("returns sanitized linked phone details for the host modal", async () => {
    await app.inject({
      method: "POST",
      url: "/host/devices/unlink",
    })

    const firstStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    const firstPair = await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: firstStart.json().challengeId,
        code: firstStart.json().code,
        deviceName: "Legacy Phone",
        platform: "android",
      },
    })
    expect(firstPair.statusCode).toBe(200)

    const secondStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    const secondChallenge = secondStart.json()
    const secondPair = await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: secondChallenge.challengeId,
        code: secondChallenge.code,
        deviceName: "Travel Phone",
        platform: "ios",
        modelName: "iPhone 16",
        osName: "iOS",
        osVersion: "18.1",
      },
    })
    expect(secondPair.statusCode).toBe(200)
    const secondTokens = secondPair.json()

    const metadataUpdate = await app.inject({
      method: "POST",
      url: "/mobile/devices/me/metadata",
      headers: {
        authorization: `Bearer ${secondTokens.accessToken}`,
      },
      payload: {
        locationCity: "Istanbul",
        locationCountry: "Turkey",
      },
    })
    expect(metadataUpdate.statusCode).toBe(200)
    expect(metadataUpdate.json()).toMatchObject({
      id: secondTokens.deviceId,
      locationCity: "Istanbul",
      locationCountry: "Turkey",
    })

    const linkedDevices = await app.inject({
      method: "GET",
      url: "/host/devices",
    })

    expect(linkedDevices.statusCode).toBe(200)
    expect(linkedDevices.json()).toEqual([
      {
        name: "Travel Phone",
        platform: "ios",
        modelName: "iPhone 16",
        osName: "iOS",
        osVersion: "18.1",
        createdAt: expect.any(String),
        lastSeenAt: expect.any(String),
        locationCity: "Istanbul",
        locationCountry: "Turkey",
      },
      {
        name: "Legacy Phone",
        platform: "android",
        modelName: null,
        osName: null,
        osVersion: null,
        createdAt: expect.any(String),
        lastSeenAt: expect.any(String),
        locationCity: null,
        locationCountry: null,
      },
    ])
    expect(linkedDevices.json()[0].id).toBeUndefined()
    expect(linkedDevices.json()[0].pushToken).toBeUndefined()
  })

  it("updates per-device notification preferences for mobile settings", async () => {
    const tokens = await pairMobileDevice("Preference tester")

    const update = await app.inject({
      method: "POST",
      url: "/mobile/devices/me/preferences",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        notifications: {
          agent: false,
          errors: true,
        },
        sounds: {
          permissions: "silent",
        },
      },
    })

    expect(update.statusCode).toBe(200)
    expect(update.json()).toMatchObject({
      id: tokens.deviceId,
      notificationPreferences: {
        agent: false,
        permissions: true,
        errors: true,
      },
      soundPreferences: {
        agent: "staplebops-01",
        permissions: "silent",
        errors: "nope-03",
      },
    })
  })

  it("pairs a device, refreshes a token, and lists sessions", async () => {
    promptBodies = []
    const pairStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    expect(pairStart.statusCode).toBe(200)
    const started = pairStart.json()

    const pairComplete = await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: started.challengeId,
        code: started.code,
        deviceName: "Pixel 9",
        platform: "android",
      },
    })
    expect(pairComplete.statusCode).toBe(200)
    const tokens = pairComplete.json()
    expect(tokens.accessToken).toBeTypeOf("string")
    expect(tokens.refreshToken).toBeTypeOf("string")

    const sessions = await app.inject({
      method: "GET",
      url: "/mobile/sessions",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
    })
    expect(sessions.statusCode).toBe(200)
    expect(sessions.json()).toHaveLength(1)

    const refreshed = await app.inject({
      method: "POST",
      url: "/mobile/auth/refresh",
      payload: {
        refreshToken: tokens.refreshToken,
      },
    })
    expect(refreshed.statusCode).toBe(200)
    expect(refreshed.json().refreshToken).not.toBe(tokens.refreshToken)
  })

  it("lists browsable roots and child directories for project creation", async () => {
    const tokens = await pairMobileDevice("Project browser")
    const rootPath = process.platform === "win32" ? path.parse(tempDir).root : path.parse(tempDir).root || path.sep
    const browseRoot = path.join(tempDir, "browse-root")
    const alphaDir = path.join(browseRoot, "alpha")
    const betaDir = path.join(browseRoot, "beta")

    await fs.mkdir(alphaDir, { recursive: true })
    await fs.mkdir(betaDir, { recursive: true })
    await fs.writeFile(path.join(browseRoot, "notes.txt"), "ignore me")

    const roots = await app.inject({
      method: "GET",
      url: "/mobile/projects/directories",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
    })

    expect(roots.statusCode).toBe(200)
    expect(roots.json()).toMatchObject({
      currentPath: null,
      parentPath: null,
      entries: expect.arrayContaining([expect.objectContaining({ path: rootPath })]),
    })

    const browse = await app.inject({
      method: "GET",
      url: `/mobile/projects/directories?path=${encodeURIComponent(browseRoot)}`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
    })

    expect(browse.statusCode).toBe(200)
    expect(browse.json()).toEqual({
      currentPath: browseRoot,
      parentPath: path.dirname(browseRoot),
      entries: [
        { name: "alpha", path: alphaDir },
        { name: "beta", path: betaDir },
      ],
    })
  })

  it("rejects missing or file browse paths for project creation", async () => {
    const tokens = await pairMobileDevice("Invalid browser")
    const browseRoot = path.join(tempDir, "invalid-browse")
    const filePath = path.join(browseRoot, "file.txt")
    const missingPath = path.join(browseRoot, "missing-folder")

    await fs.mkdir(browseRoot, { recursive: true })
    await fs.writeFile(filePath, "not a directory")

    const fileBrowse = await app.inject({
      method: "GET",
      url: `/mobile/projects/directories?path=${encodeURIComponent(filePath)}`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
    })

    expect(fileBrowse.statusCode).toBe(400)
    expect(fileBrowse.json()).toEqual({ error: "Choose a folder path, not a file." })

    const missingBrowse = await app.inject({
      method: "GET",
      url: `/mobile/projects/directories?path=${encodeURIComponent(missingPath)}`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
    })

    expect(missingBrowse.statusCode).toBe(404)
    expect(missingBrowse.json()).toEqual({ error: "That folder does not exist on this PC." })
  })

  it("creates a new project directory recursively and starts a session there", async () => {
    const tokens = await pairMobileDevice("Project creator")
    const targetDirectory = path.join(tempDir, "projects", "client-x", "new-app")

    await fs.rm(path.join(tempDir, "projects"), { recursive: true, force: true })

    const created = await app.inject({
      method: "POST",
      url: "/mobile/projects",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        directory: targetDirectory,
      },
    })

    expect(created.statusCode).toBe(200)
    expect(created.json()).toEqual({
      sessionId: expect.stringMatching(/^session-created-/),
      directory: targetDirectory,
      createdDirectory: true,
    })

    const stat = await fs.stat(targetDirectory)
    expect(stat.isDirectory()).toBe(true)
  })

  it("opens a session in an existing project directory without recreating it", async () => {
    const tokens = await pairMobileDevice("Existing project opener")
    const existingDirectory = path.join(tempDir, "existing-project")

    await fs.mkdir(existingDirectory, { recursive: true })

    const created = await app.inject({
      method: "POST",
      url: "/mobile/projects",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        directory: existingDirectory,
      },
    })

    expect(created.statusCode).toBe(200)
    expect(created.json()).toEqual({
      sessionId: expect.stringMatching(/^session-created-/),
      directory: existingDirectory,
      createdDirectory: false,
    })
  })

  it("requires auth and rejects relative project paths", async () => {
    const unauthenticatedBrowse = await app.inject({
      method: "GET",
      url: "/mobile/projects/directories",
    })
    expect(unauthenticatedBrowse.statusCode).toBe(401)

    const unauthenticatedCreate = await app.inject({
      method: "POST",
      url: "/mobile/projects",
      payload: {
        directory: path.join(tempDir, "unauthenticated-project"),
      },
    })
    expect(unauthenticatedCreate.statusCode).toBe(401)

    const tokens = await pairMobileDevice("Relative path tester")
    const relativeCreate = await app.inject({
      method: "POST",
      url: "/mobile/projects",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        directory: "relative-project",
      },
    })

    expect(relativeCreate.statusCode).toBe(400)
    expect(relativeCreate.json()).toEqual({ error: "Use an absolute folder path from this PC." })
  })

  it("supports synthetic retry and resume control actions", async () => {
    promptBodies = []
    const pairStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    const started = pairStart.json()
    const pairComplete = await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: started.challengeId,
        code: started.code,
        deviceName: "iPhone",
        platform: "ios",
      },
    })
    const tokens = pairComplete.json()

    const retry = await app.inject({
      method: "POST",
      url: "/mobile/sessions/session-1/control",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        action: "retry",
      },
    })
    expect(retry.statusCode).toBe(200)
    expect(retry.json()).toMatchObject({ supported: true, result: true, mode: "synthetic_prompt" })
  })

  it("lists prompt settings and forwards agent, model, and variant", async () => {
    promptBodies = []
    const pairStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    const started = pairStart.json()
    const pairComplete = await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: started.challengeId,
        code: started.code,
        deviceName: "Pixel",
        platform: "android",
      },
    })
    const tokens = pairComplete.json()

    const options = await app.inject({
      method: "GET",
      url: "/mobile/prompt/options",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
    })
    expect(options.statusCode).toBe(200)
    expect(options.json()).toMatchObject({
      defaultAgent: "build",
      agents: [
        { id: "build" },
        { id: "plan" },
      ],
      models: [
        {
          providerID: "openai",
          modelID: "gpt-5.4",
          variants: [
            { id: "low" },
            { id: "high" },
          ],
        },
      ],
    })
    expect(options.json().agents).toHaveLength(2)

    const prompt = await app.inject({
      method: "POST",
      url: "/mobile/sessions/session-1/prompt",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        text: "continue",
        agent: "plan",
        model: {
          providerID: "openai",
          modelID: "gpt-5.4",
        },
        variant: "high",
      },
    })
    expect(prompt.statusCode).toBe(200)
    expect(promptBodies.at(-1)).toMatchObject({
      agent: "plan",
      model: {
        providerID: "openai",
        modelID: "gpt-5.4",
      },
      variant: "high",
    })
  })

  it("lists merged slash commands and dispatches host commands through the command endpoint", async () => {
    commandBodies = []
    const pairStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    const started = pairStart.json()
    const pairComplete = await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: started.challengeId,
        code: started.code,
        deviceName: "Slash tester",
        platform: "android",
      },
    })
    const tokens = pairComplete.json()

    const commands = await app.inject({
      method: "GET",
      url: "/mobile/commands",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
    })

    expect(commands.statusCode).toBe(200)
    expect(commands.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "exit",
          source: "built-in",
          aliases: expect.arrayContaining(["quit", "q"]),
        }),
        expect.objectContaining({
          name: "review",
          source: "command",
        }),
        expect.objectContaining({
          name: "frontend-design",
          source: "skill",
        }),
        expect.objectContaining({
          name: "init",
          source: "command",
          description: "create/update AGENTS.md",
        }),
      ]),
    )

    const command = await app.inject({
      method: "POST",
      url: "/mobile/sessions/session-1/command",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        command: "review",
        arguments: "main",
        agent: "plan",
        model: {
          providerID: "openai",
          modelID: "gpt-5.4",
        },
        variant: "high",
      },
    })

    expect(command.statusCode).toBe(200)
    expect(command.json()).toEqual({
      accepted: true,
      status: "dispatched",
      message: "Started /review.",
      sessionId: null,
      shareUrl: null,
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(commandBodies.at(-1)).toMatchObject({
      command: "review",
      arguments: "main",
      agent: "plan",
      model: "openai/gpt-5.4",
      variant: "high",
    })
  })

  it("maps built-in slash commands to supported session actions", async () => {
    const pairStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    const started = pairStart.json()
    const pairComplete = await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: started.challengeId,
        code: started.code,
        deviceName: "Built-in tester",
        platform: "android",
      },
    })
    const tokens = pairComplete.json()

    const share = await app.inject({
      method: "POST",
      url: "/mobile/sessions/session-1/command",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        command: "share",
        arguments: "",
      },
    })
    expect(share.statusCode).toBe(200)
    expect(share.json()).toEqual({
      accepted: true,
      status: "completed",
      message: "Session shared.",
      sessionId: null,
      shareUrl: "https://example.test/share/session-1",
    })

    const rename = await app.inject({
      method: "POST",
      url: "/mobile/sessions/session-1/command",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        command: "rename",
        arguments: "Fresh title",
      },
    })
    expect(rename.statusCode).toBe(200)
    expect(rename.json()).toEqual({
      accepted: true,
      status: "completed",
      message: 'Renamed the session to "Fresh title".',
      sessionId: null,
      shareUrl: null,
    })

    const nextSession = await app.inject({
      method: "POST",
      url: "/mobile/sessions/session-1/command",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        command: "new",
        arguments: "",
      },
    })
    expect(nextSession.statusCode).toBe(200)
    expect(nextSession.json()).toMatchObject({
      accepted: true,
      status: "completed",
      message: "Started a new session.",
      sessionId: expect.stringMatching(/^session-created-/),
      shareUrl: null,
    })
  })

  it("returns unsupported for unknown or mobile-only slash commands", async () => {
    const pairStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    const started = pairStart.json()
    const pairComplete = await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: started.challengeId,
        code: started.code,
        deviceName: "Unsupported tester",
        platform: "android",
      },
    })
    const tokens = pairComplete.json()

    const unknown = await app.inject({
      method: "POST",
      url: "/mobile/sessions/session-1/command",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        command: "does-not-exist",
        arguments: "",
      },
    })
    expect(unknown.statusCode).toBe(200)
    expect(unknown.json()).toEqual({
      accepted: true,
      status: "unsupported",
      message: "/does-not-exist is not available on this host.",
      sessionId: null,
      shareUrl: null,
    })

    const mobileOnly = await app.inject({
      method: "POST",
      url: "/mobile/sessions/session-1/command",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        command: "themes",
        arguments: "",
      },
    })
    expect(mobileOnly.statusCode).toBe(200)
    expect(mobileOnly.json()).toEqual({
      accepted: true,
      status: "unsupported",
      message: "/themes is not available in the mobile session view yet.",
      sessionId: null,
      shareUrl: null,
    })
  })

  it("removes revoked devices from the device list", async () => {
    const firstPairStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    const firstStarted = firstPairStart.json()
    const firstPairComplete = await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: firstStarted.challengeId,
        code: firstStarted.code,
        deviceName: "Device A",
        platform: "android",
      },
    })
    const firstTokens = firstPairComplete.json()

    const secondPairStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    const secondStarted = secondPairStart.json()
    const secondPairComplete = await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: secondStarted.challengeId,
        code: secondStarted.code,
        deviceName: "Device B",
        platform: "android",
      },
    })
    const secondTokens = secondPairComplete.json()

    const beforeRevoke = await app.inject({
      method: "GET",
      url: "/mobile/devices",
      headers: {
        authorization: `Bearer ${firstTokens.accessToken}`,
      },
    })
    expect(beforeRevoke.statusCode).toBe(200)
    expect(beforeRevoke.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstTokens.deviceId }),
        expect.objectContaining({ id: secondTokens.deviceId }),
      ]),
    )

    const revoke = await app.inject({
      method: "POST",
      url: `/mobile/devices/${secondTokens.deviceId}/revoke`,
      headers: {
        authorization: `Bearer ${firstTokens.accessToken}`,
      },
    })
    expect(revoke.statusCode).toBe(200)
    expect(revoke.json()).toEqual({ revoked: true })

    const afterRevoke = await app.inject({
      method: "GET",
      url: "/mobile/devices",
      headers: {
        authorization: `Bearer ${firstTokens.accessToken}`,
      },
    })
    expect(afterRevoke.statusCode).toBe(200)
    expect(afterRevoke.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: firstTokens.deviceId })]),
    )
    expect(afterRevoke.json()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: secondTokens.deviceId })]),
    )
  })

  it("omits oversized diffs so session detail can load quickly", async () => {
    const pairStart = await app.inject({
      method: "POST",
      url: "/mobile/pair/start",
      payload: {},
    })
    const started = pairStart.json()
    const pairComplete = await app.inject({
      method: "POST",
      url: "/mobile/pair/complete",
      payload: {
        challengeId: started.challengeId,
        code: started.code,
        deviceName: "Large session tester",
        platform: "android",
      },
    })
    const tokens = pairComplete.json()

    const detail = await app.inject({
      method: "GET",
      url: "/mobile/sessions/session-large",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
    })

    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({
      diff: [],
      diffInfo: {
        status: "omitted",
        message: "Diff omitted for large session changes.",
      },
    })
  })
})
