import type {
  AuthTokens,
  CommandExecuteRequest,
  CommandExecuteResponse,
  CommandListResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  Device,
  DeviceMetadataUpdateRequest,
  DevicePreferencesUpdateRequest,
  HostInfo,
  PairCompleteRequest,
  PairStartResponse,
  ProjectDirectoryBrowseResponse,
  PromptRequest,
  PromptOptionsResponse,
  SessionControlRequest,
  SessionDetail,
  SessionSummary,
  StreamEvent,
} from "@opencode-remote/shared"
import type { AuthSession } from "../state/auth-store"

function trimBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "")
}

function toHttpUrl(serverUrl: string, pathname: string) {
  return `${trimBaseUrl(serverUrl)}${pathname}`
}

function toWsUrl(serverUrl: string, pathname: string) {
  const base = trimBaseUrl(serverUrl)
  if (base.startsWith("https://")) return `wss://${base.slice("https://".length)}${pathname}`
  if (base.startsWith("http://")) return `ws://${base.slice("http://".length)}${pathname}`
  return `${base}${pathname}`
}

const REQUEST_TIMEOUT_MS = 15_000

async function fetchWithTimeout(input: string, init: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timed out. Check that the gateway is reachable.")
    }
    if (error instanceof Error && error.message.includes("Network request failed")) {
      throw new Error("Network request failed. Confirm that your phone can open the gateway URL in a browser.")
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function pairDevice(serverUrl: string, request: PairCompleteRequest): Promise<AuthTokens> {
  const response = await fetchWithTimeout(toHttpUrl(serverUrl, "/mobile/pair/complete"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || "Failed to complete pairing")
  }
  return (await response.json()) as AuthTokens
}

export async function refreshSession(serverUrl: string, refreshToken: string): Promise<AuthTokens> {
  const response = await fetchWithTimeout(toHttpUrl(serverUrl, "/mobile/auth/refresh"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ refreshToken }),
  })
  if (!response.ok) throw new Error("Failed to refresh session")
  return (await response.json()) as AuthTokens
}

async function authedRequest<T>(
  session: AuthSession,
  pathname: string,
  init: RequestInit,
  onRefresh: (next: AuthTokens) => Promise<void>,
): Promise<T> {
  const makeRequest = (accessToken: string) =>
    {
      const initHeaders = (init.headers as Record<string, string> | undefined) ?? {}
      const headers: Record<string, string> = {
        authorization: `Bearer ${accessToken}`,
        ...initHeaders,
      }

      if (init.body != null && !headers["content-type"]) {
        headers["content-type"] = "application/json"
      }

      return fetchWithTimeout(toHttpUrl(session.serverUrl, pathname), {
        ...init,
        headers,
      })
    }

  let response = await makeRequest(session.accessToken)
  if (response.status === 401) {
    const next = await refreshSession(session.serverUrl, session.refreshToken)
    await onRefresh(next)
    response = await makeRequest(next.accessToken)
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Request failed for ${pathname}`)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function getHostInfo(
  session: AuthSession,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest<HostInfo>(session, "/mobile/host", { method: "GET" }, onRefresh)
}

export async function getSessions(
  session: AuthSession,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest<SessionSummary[]>(session, "/mobile/sessions", { method: "GET" }, onRefresh)
}

export async function browseProjectDirectories(
  session: AuthSession,
  onRefresh: (next: AuthTokens) => Promise<void>,
  nextPath?: string | null,
) {
  const pathname = nextPath?.trim()
    ? `/mobile/projects/directories?path=${encodeURIComponent(nextPath.trim())}`
    : "/mobile/projects/directories"

  return authedRequest<ProjectDirectoryBrowseResponse>(session, pathname, { method: "GET" }, onRefresh)
}

export async function createProject(
  session: AuthSession,
  request: CreateProjectRequest,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest<CreateProjectResponse>(
    session,
    "/mobile/projects",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
    onRefresh,
  )
}

export async function getDevices(
  session: AuthSession,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest<Device[]>(session, "/mobile/devices", { method: "GET" }, onRefresh)
}

export async function revokeDevice(
  session: AuthSession,
  deviceId: string,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest<{ revoked: boolean }>(
    session,
    `/mobile/devices/${deviceId}/revoke`,
    { method: "POST" },
    onRefresh,
  )
}

export async function getSessionDetail(
  session: AuthSession,
  sessionId: string,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest<SessionDetail>(session, `/mobile/sessions/${sessionId}`, { method: "GET" }, onRefresh)
}

export async function getPromptOptions(
  session: AuthSession,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest<PromptOptionsResponse>(session, "/mobile/prompt/options", { method: "GET" }, onRefresh)
}

export async function getCommands(
  session: AuthSession,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest<CommandListResponse>(session, "/mobile/commands", { method: "GET" }, onRefresh)
}

export async function sendPrompt(
  session: AuthSession,
  sessionId: string,
  prompt: PromptRequest,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest<{ accepted: true }>(
    session,
    `/mobile/sessions/${sessionId}/prompt`,
    {
      method: "POST",
      body: JSON.stringify(prompt),
    },
    onRefresh,
  )
}

export async function sendCommand(
  session: AuthSession,
  sessionId: string,
  command: CommandExecuteRequest,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest<CommandExecuteResponse>(
    session,
    `/mobile/sessions/${sessionId}/command`,
    {
      method: "POST",
      body: JSON.stringify(command),
    },
    onRefresh,
  )
}

export async function sendControl(
  session: AuthSession,
  sessionId: string,
  control: SessionControlRequest,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest<{ supported: boolean; result?: boolean; reason?: string; mode?: string }>(
    session,
    `/mobile/sessions/${sessionId}/control`,
    {
      method: "POST",
      body: JSON.stringify(control),
    },
    onRefresh,
  )
}

export async function updatePushToken(
  session: AuthSession,
  pushToken: string,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest(
    session,
    `/mobile/devices/${session.deviceId}/push-token`,
    {
      method: "POST",
      body: JSON.stringify({ pushToken }),
    },
    onRefresh,
  )
}

export async function updateDeviceMetadata(
  session: AuthSession,
  metadata: DeviceMetadataUpdateRequest,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest(
    session,
    "/mobile/devices/me/metadata",
    {
      method: "POST",
      body: JSON.stringify(metadata),
    },
    onRefresh,
  )
}

export async function updateDevicePreferences(
  session: AuthSession,
  preferences: DevicePreferencesUpdateRequest,
  onRefresh: (next: AuthTokens) => Promise<void>,
) {
  return authedRequest(
    session,
    "/mobile/devices/me/preferences",
    {
      method: "POST",
      body: JSON.stringify(preferences),
    },
    onRefresh,
  )
}

export function openStreamSocket(
  session: AuthSession,
  handlers: {
    onMessage: (event: StreamEvent) => void
    onClose?: () => void
  },
) {
  const SocketCtor = WebSocket as unknown as new (
    url: string,
    protocols?: string | string[],
    options?: { headers?: Record<string, string> },
  ) => WebSocket
  const socket = new SocketCtor(toWsUrl(session.serverUrl, "/mobile/stream"), undefined, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  })
  socket.onmessage = (message) => {
    handlers.onMessage(JSON.parse(String(message.data)) as StreamEvent)
  }
  socket.onclose = () => {
    handlers.onClose?.()
  }
  return socket
}

export function openTerminalSocket(
  session: AuthSession,
  sessionId: string,
  handlers: {
    onMessage: (event: StreamEvent) => void
    onClose?: () => void
  },
) {
  const SocketCtor = WebSocket as unknown as new (
    url: string,
    protocols?: string | string[],
    options?: { headers?: Record<string, string> },
  ) => WebSocket
  const socket = new SocketCtor(toWsUrl(session.serverUrl, `/mobile/terminal/${sessionId}`), undefined, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  })
  socket.onmessage = (message) => {
    handlers.onMessage(JSON.parse(String(message.data)) as StreamEvent)
  }
  socket.onclose = () => {
    handlers.onClose?.()
  }
  return socket
}

export async function startPairingChallenge(serverUrl: string) {
  const response = await fetchWithTimeout(toHttpUrl(serverUrl, "/mobile/pair/start"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || "Failed to create pairing challenge")
  }
  return (await response.json()) as PairStartResponse
}
