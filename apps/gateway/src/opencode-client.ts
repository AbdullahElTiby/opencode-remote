import { createParser, type EventSourceMessage } from "eventsource-parser"
import type {
  CommandSummary,
  PromptAgentOption,
  PromptModelOption,
  CommandExecuteRequest,
  PromptRequest,
  PromptOptionsResponse,
  SessionControlRequest,
  SessionStatus,
  SessionSummary,
} from "@opencode-remote/shared"
import { BUILTIN_COMMANDS } from "./builtin-commands.js"

type OpenCodeHealth = {
  healthy: boolean
  version: string
}

type OpenCodeProjectInfo = {
  id: string
  worktree: string
}

type OpenCodeSessionInfo = {
  id: string
  slug: string
  directory: string
  title: string
  summary?: {
    additions: number
    deletions: number
    files: number
  }
  time: {
    created: number
    updated: number
  }
}

type OpenCodeAgent = {
  name: string
  description?: string
  mode?: string
  native?: boolean
  hidden?: boolean
}

type OpenCodeProviderCatalog = {
  providers: Array<{
    id: string
    name?: string
    models?: Record<
      string,
      {
        id?: string
        providerID?: string
        name?: string
        capabilities?: {
          reasoning?: boolean
          toolcall?: boolean
        }
        variants?: Record<
          string,
          {
            reasoningEffort?: string
          }
        >
      }
    >
  }>
  default?: Record<string, string>
}

type OpenCodeCommand = {
  name: string
  description?: string
  source?: "command" | "mcp" | "skill"
  hints?: string[]
}

type SseEnvelope = {
  type: string
  properties: Record<string, unknown>
}

function normalizeSseEnvelope(value: unknown): SseEnvelope | null {
  if (typeof value !== "object" || value === null) return null

  const candidate =
    typeof (value as { payload?: unknown }).payload === "object" && (value as { payload?: unknown }).payload !== null
      ? ((value as { payload: unknown }).payload as Record<string, unknown>)
      : (value as Record<string, unknown>)

  if (typeof candidate.type !== "string") return null

  return {
    type: candidate.type,
    properties:
      typeof candidate.properties === "object" && candidate.properties !== null
        ? (candidate.properties as Record<string, unknown>)
        : {},
  }
}

export class OpenCodeClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly password?: string,
  ) {}

  public async health() {
    return this.requestJson<OpenCodeHealth>("/global/health")
  }

  public async listProjects() {
    const response = await this.requestJson<{ value?: OpenCodeProjectInfo[] } | OpenCodeProjectInfo[]>("/project")
    if (Array.isArray(response)) {
      return response
    }
    return Array.isArray(response.value) ? response.value : []
  }

  public async listSessions(directory?: string) {
    return this.requestJson<OpenCodeSessionInfo[]>(this.withDirectoryQuery("/session", directory))
  }

  public async sessionStatuses(directory?: string) {
    return this.requestJson<Record<string, SessionStatus>>(this.withDirectoryQuery("/session/status", directory))
  }

  public async getSession(sessionId: string) {
    return this.requestJson<Record<string, unknown>>(`/session/${sessionId}`)
  }

  public async getMessages(sessionId: string, limit = 80) {
    return this.requestJson<Record<string, unknown>[]>(`/session/${sessionId}/message?limit=${limit}`)
  }

  public async getTodo(sessionId: string) {
    return this.requestJson<Record<string, unknown>[]>(`/session/${sessionId}/todo`)
  }

  public async getDiff(sessionId: string, timeoutMs?: number) {
    return this.requestJson<Record<string, unknown>[]>(`/session/${sessionId}/diff`, undefined, timeoutMs)
  }

  public async listAgents() {
    const response = await this.requestJson<{ value?: OpenCodeAgent[] } | OpenCodeAgent[]>("/agent")
    const agents = Array.isArray(response)
      ? response
      : Array.isArray(response.value)
        ? response.value
        : []
    return agents
      .filter((agent) => !agent.hidden)
      .filter((agent) => (agent.mode ?? "primary") !== "subagent")
      .map<PromptAgentOption>((agent) => ({
        id: agent.name,
        name: agent.name,
        description: agent.description ?? null,
        mode: agent.mode ?? "primary",
        isPrimary: (agent.mode ?? "primary") === "primary",
        isNative: Boolean(agent.native),
      }))
  }

  public async listPromptOptions(): Promise<PromptOptionsResponse> {
    const [agents, providerCatalog] = await Promise.all([
      this.listAgents(),
      this.requestJson<OpenCodeProviderCatalog>("/config/providers"),
    ])

    const models = (providerCatalog.providers ?? [])
      .flatMap<PromptModelOption>((provider) =>
        Object.entries(provider.models ?? {}).map(([modelKey, model]) => ({
          id: `${provider.id}/${model.id ?? modelKey}`,
          providerID: provider.id,
          providerName: provider.name ?? provider.id,
          modelID: model.id ?? modelKey,
          name: model.name ?? model.id ?? modelKey,
          reasoningSupported: Boolean(model.capabilities?.reasoning),
          supportsTools: Boolean(model.capabilities?.toolcall),
          variants: Object.entries(model.variants ?? {}).map(([variantId, variant]) => ({
            id: variantId,
            label: variantId,
            reasoningEffort: variant.reasoningEffort ?? null,
          })),
        })),
      )
      .filter((model) => model.supportsTools)
      .sort((left, right) => left.name.localeCompare(right.name))

    return {
      defaultAgent: agents.find((agent) => agent.id === "build")?.id ?? agents[0]?.id ?? "build",
      agents,
      models,
    }
  }

  public async listCommands(): Promise<CommandSummary[]> {
    const commands = await this.requestJson<OpenCodeCommand[]>("/command")
    const merged = new Map<string, CommandSummary>()

    for (const builtin of BUILTIN_COMMANDS) {
      merged.set(builtin.name, builtin)
    }

    for (const command of commands) {
      merged.set(command.name, {
        name: command.name,
        description: command.description ?? null,
        source: command.source ?? "command",
        hints: command.hints ?? [],
        aliases: [],
      })
    }

    return Array.from(merged.values())
  }

  public async createSession(directory?: string) {
    return this.requestJson<Record<string, unknown>>("/session", {
      method: "POST",
      body: JSON.stringify(directory ? { directory } : {}),
    })
  }

  public async prompt(sessionId: string, prompt: PromptRequest) {
    return this.requestVoid(`/session/${sessionId}/prompt_async`, {
      method: "POST",
      body: JSON.stringify({
        agent: prompt.agent,
        system: prompt.system,
        model: prompt.model,
        variant: prompt.variant,
        noReply: prompt.noReply,
        parts: [
          {
            type: "text",
            text: prompt.text,
          },
        ],
      }),
    })
  }

  public async control(sessionId: string, control: SessionControlRequest) {
    switch (control.action) {
      case "approve":
      case "deny": {
        if (!control.permissionId) throw new Error("permissionId is required")
        return this.requestJson<boolean>(`/session/${sessionId}/permissions/${control.permissionId}`, {
          method: "POST",
          body: JSON.stringify({
            response: control.action === "approve" ? (control.remember ? "always" : "once") : "reject",
            remember: control.remember,
          }),
        })
      }
      case "abort":
        return this.requestJson<boolean>(`/session/${sessionId}/abort`, {
          method: "POST",
        })
      case "resume":
        await this.prompt(sessionId, {
          text: "continue from the last incomplete step",
          agent: control.agent,
          model: control.model,
          variant: control.variant,
        })
        return true
      case "retry":
        await this.prompt(sessionId, {
          text: "try again and continue from the last incomplete step",
          agent: control.agent,
          model: control.model,
          variant: control.variant,
        })
        return true
      default:
        return false
    }
  }

  public async runCommand(sessionId: string, command: CommandExecuteRequest) {
    const model = command.model ? `${command.model.providerID}/${command.model.modelID}` : undefined

    return this.requestJson<Record<string, unknown>>(`/session/${sessionId}/command`, {
      method: "POST",
      body: JSON.stringify({
        command: command.command,
        arguments: command.arguments,
        agent: command.agent,
        model,
        variant: command.variant,
      }),
    })
  }

  public runCommandDetached(sessionId: string, command: CommandExecuteRequest) {
    void this.runCommand(sessionId, command).catch(() => {
      // The realtime bridge will surface downstream changes. Failures are handled by the gateway route.
    })
  }

  public async shareSession(sessionId: string) {
    return this.requestJson<Record<string, unknown>>(`/session/${sessionId}/share`, {
      method: "POST",
    })
  }

  public async unshareSession(sessionId: string) {
    return this.requestJson<Record<string, unknown>>(`/session/${sessionId}/share`, {
      method: "DELETE",
    })
  }

  public async renameSession(sessionId: string, title: string) {
    return this.requestJson<Record<string, unknown>>(`/session/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    })
  }

  public summarizeSessionDetached(
    sessionId: string,
    options: {
      model: NonNullable<CommandExecuteRequest["model"]>
      variant?: string
    },
  ) {
    void this.requestJson<Record<string, unknown>>(`/session/${sessionId}/summarize`, {
      method: "POST",
      body: JSON.stringify({
        providerID: options.model.providerID,
        modelID: options.model.modelID,
        variant: options.variant,
      }),
    }).catch(() => {
      // The mobile client receives the follow-up session updates through polling/SSE.
    })
  }

  public async undoSession(sessionId: string) {
    const messageId = await this.getLatestUserMessageId(sessionId)
    if (!messageId) return null
    return this.requestJson<Record<string, unknown>>(`/session/${sessionId}/revert`, {
      method: "POST",
      body: JSON.stringify({ messageID: messageId }),
    })
  }

  public async redoSession(sessionId: string) {
    const messageId = await this.getLatestUserMessageId(sessionId)
    if (!messageId) return null
    return this.requestJson<Record<string, unknown>>(`/session/${sessionId}/unrevert`, {
      method: "POST",
      body: JSON.stringify({ messageID: messageId }),
    })
  }

  public async subscribe(
    onEvent: (event: SseEnvelope) => Promise<void> | void,
    signal: AbortSignal,
  ) {
    const response = await fetch(new URL("/global/event", this.baseUrl), {
      headers: this.headers(),
      signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`Failed to subscribe to OpenCode SSE: ${response.status}`)
    }

    const decoder = new TextDecoder()
    const parser = createParser({
      onEvent: async (message: EventSourceMessage) => {
        if (!message.data) return
        const parsed = normalizeSseEnvelope(JSON.parse(message.data))
        if (!parsed) return
        await onEvent(parsed)
      },
    })

    for await (const chunk of response.body) {
      parser.feed(decoder.decode(chunk, { stream: true }))
    }
  }

  public toSummary(session: OpenCodeSessionInfo, status: SessionStatus): SessionSummary {
    return {
      id: session.id,
      title: session.title,
      slug: session.slug ?? null,
      directory: session.directory ?? null,
      createdAt: new Date(session.time.created).toISOString(),
      updatedAt: new Date(session.time.updated).toISOString(),
      summary: session.summary
        ? {
            additions: session.summary.additions,
            deletions: session.summary.deletions,
            files: session.summary.files,
          }
        : null,
      status,
      hasTui: true,
    }
  }

  private async getLatestUserMessageId(sessionId: string) {
    const messages = await this.getMessages(sessionId, 200)
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (
        typeof message.info === "object" &&
        message.info !== null &&
        (message.info as Record<string, unknown>).role === "user" &&
        typeof (message.info as Record<string, unknown>).id === "string"
      ) {
        return (message.info as Record<string, string>).id
      }
    }
    return null
  }

  private async requestJson<T>(pathname: string, init?: RequestInit, timeoutMs?: number) {
    const controller = new AbortController()
    const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null
    const initHeaders = (init?.headers as Record<string, string> | undefined) ?? {}
    const headers = {
      ...this.headers(),
      ...initHeaders,
    } satisfies Record<string, string>

    if (init?.body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/json"
    }

    try {
      const response = await fetch(new URL(pathname, this.baseUrl), {
        ...init,
        signal: controller.signal,
        headers,
      })
      if (!response.ok) throw new Error(`OpenCode request failed: ${response.status} ${pathname}`)
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`OpenCode request timed out: ${pathname}`)
      }
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private async requestVoid(pathname: string, init?: RequestInit) {
    const initHeaders = (init?.headers as Record<string, string> | undefined) ?? {}
    const headers = {
      ...this.headers(),
      ...initHeaders,
    } satisfies Record<string, string>

    if (init?.body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/json"
    }

    const response = await fetch(new URL(pathname, this.baseUrl), {
      ...init,
      headers,
    })
    if (!response.ok) throw new Error(`OpenCode request failed: ${response.status} ${pathname}`)
  }

  private headers(): Record<string, string> {
    if (!this.password) return {}
    return {
      Authorization: `Basic ${Buffer.from(`opencode:${this.password}`).toString("base64")}`,
    }
  }

  private withDirectoryQuery(pathname: string, directory?: string) {
    if (!directory) return pathname

    const url = new URL(pathname, this.baseUrl)
    url.searchParams.set("directory", directory)
    return `${url.pathname}${url.search}`
  }
}
