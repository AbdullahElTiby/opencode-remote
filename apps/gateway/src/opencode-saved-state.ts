import { readdir, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type SavedOpenCodeSessionReference = {
  id: string
  directory: string | null
  updatedAt: number | null
}

export type SavedOpenCodeStateSnapshot = {
  projectDirectories: string[]
  sessionReferences: SavedOpenCodeSessionReference[]
}

export type OpenCodeSavedStateReader = {
  readSnapshot(): Promise<SavedOpenCodeStateSnapshot>
}

type DesktopSavedStateReaderOptions = {
  appDataDirectory?: string
  ttlMs?: number
}

type SavedWorkspaceReference = {
  directory: string | null
  sessionId: string | null
}

const DEFAULT_CACHE_TTL_MS = 5 * 60_000
const WORKSPACE_FILE_PREFIX = "opencode.workspace."
const WORKSPACE_FILE_SUFFIX = ".dat"

export function emptySavedOpenCodeStateSnapshot(): SavedOpenCodeStateSnapshot {
  return {
    projectDirectories: [],
    sessionReferences: [],
  }
}

function normalizeDirectory(value: unknown) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeSessionId(value: unknown) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.startsWith("ses_") ? trimmed : null
}

function normalizeTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readJsonStringRecord(value: unknown) {
  if (typeof value !== "object" || value === null) return null
  return value as Record<string, unknown>
}

function parseEmbeddedJson(value: unknown) {
  if (typeof value !== "string") return null

  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function decodeWorkspaceDirectory(rawValue: string) {
  const encoded = rawValue.trim()
  if (!encoded) return null
  if (!/^[A-Za-z0-9+/=_-]+$/.test(encoded)) return null

  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/")
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4 || 4)) % 4)}`

  try {
    const decoded = Buffer.from(padded, "base64").toString("utf8")
    if (!decoded || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(decoded)) {
      return null
    }

    return normalizeDirectory(decoded)
  } catch {
    return null
  }
}

function parseWorkspaceReference(rawValue: string): SavedWorkspaceReference {
  const [rawWorkspaceKey, rawSessionKey] = rawValue.split("/", 2)
  return {
    directory: decodeWorkspaceDirectory(rawWorkspaceKey ?? ""),
    sessionId: normalizeSessionId(rawSessionKey),
  }
}

function parseSessionIdFromWorkspaceEntry(key: string) {
  if (!key.startsWith("session:")) return null

  const [, rawSessionId] = key.split(":", 3)
  return normalizeSessionId(rawSessionId)
}

export class DesktopSavedStateReader implements OpenCodeSavedStateReader {
  private readonly appDataDirectory: string
  private readonly ttlMs: number
  private cache = emptySavedOpenCodeStateSnapshot()
  private expiresAt = 0
  private inFlight: Promise<SavedOpenCodeStateSnapshot> | null = null

  public constructor(options: DesktopSavedStateReaderOptions = {}) {
    this.appDataDirectory =
      options.appDataDirectory ??
      path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "ai.opencode.desktop")
    this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS
  }

  public async readSnapshot(): Promise<SavedOpenCodeStateSnapshot> {
    if (this.expiresAt > Date.now()) {
      return this.cache
    }

    if (!this.inFlight) {
      this.inFlight = this.loadSnapshot()
        .then((snapshot) => {
          this.cache = snapshot
          this.expiresAt = Date.now() + this.ttlMs
          return snapshot
        })
        .catch(() => {
          this.cache = emptySavedOpenCodeStateSnapshot()
          this.expiresAt = Date.now() + this.ttlMs
          return this.cache
        })
        .finally(() => {
          this.inFlight = null
        })
    }

    return this.inFlight
  }

  private async loadSnapshot(): Promise<SavedOpenCodeStateSnapshot> {
    const projectDirectories = new Set<string>()
    const sessionReferenceMap = new Map<string, SavedOpenCodeSessionReference>()

    const addProjectDirectory = (candidate: unknown) => {
      const directory = normalizeDirectory(candidate)
      if (directory) {
        projectDirectories.add(directory)
      }
    }

    const addSessionReference = (candidate: SavedOpenCodeSessionReference) => {
      const sessionId = normalizeSessionId(candidate.id)
      if (!sessionId) return

      const directory = normalizeDirectory(candidate.directory)
      const updatedAt = normalizeTimestamp(candidate.updatedAt)
      const existing = sessionReferenceMap.get(sessionId)

      if (!existing) {
        sessionReferenceMap.set(sessionId, {
          id: sessionId,
          directory,
          updatedAt,
        })
        return
      }

      sessionReferenceMap.set(sessionId, {
        id: sessionId,
        directory: existing.directory ?? directory,
        updatedAt:
          existing.updatedAt === null
            ? updatedAt
            : updatedAt === null
              ? existing.updatedAt
              : Math.max(existing.updatedAt, updatedAt),
      })
    }

    const parseGlobalDesktopState = async () => {
      const globalStatePath = path.join(this.appDataDirectory, "opencode.global.dat")
      const rawGlobalState = await readFile(globalStatePath, "utf8").catch(() => null)
      if (!rawGlobalState) return

      const root = readJsonStringRecord(parseEmbeddedJson(rawGlobalState))
      if (!root) return

      const globalProjects = readJsonStringRecord(parseEmbeddedJson(root["globalSync.project"]))
      const globalProjectList = Array.isArray(globalProjects?.value) ? globalProjects.value : []
      for (const project of globalProjectList) {
        if (typeof project !== "object" || project === null) continue
        addProjectDirectory((project as Record<string, unknown>).worktree)
      }

      const localProjects = readJsonStringRecord(parseEmbeddedJson(root.server))
      const localProjectList = Array.isArray(
        readJsonStringRecord(localProjects?.projects)?.local,
      )
        ? (readJsonStringRecord(localProjects?.projects)?.local as unknown[])
        : []
      for (const project of localProjectList) {
        if (typeof project !== "object" || project === null) continue
        addProjectDirectory((project as Record<string, unknown>).worktree)
      }

      const layoutPage = readJsonStringRecord(parseEmbeddedJson(root["layout.page"]))
      const lastProjectSession = readJsonStringRecord(layoutPage?.lastProjectSession)
      for (const candidate of Object.values(lastProjectSession ?? {})) {
        if (typeof candidate !== "object" || candidate === null) continue
        const entry = candidate as Record<string, unknown>
        addProjectDirectory(entry.directory)
        addSessionReference({
          id: String(entry.id ?? ""),
          directory: normalizeDirectory(entry.directory),
          updatedAt: normalizeTimestamp(entry.at),
        })
      }

      const notifications = readJsonStringRecord(parseEmbeddedJson(root.notification))
      const notificationList = Array.isArray(notifications?.list) ? notifications.list : []
      for (const notification of notificationList) {
        if (typeof notification !== "object" || notification === null) continue
        const entry = notification as Record<string, unknown>
        addProjectDirectory(entry.directory)
        addSessionReference({
          id: String(entry.session ?? ""),
          directory: normalizeDirectory(entry.directory),
          updatedAt: normalizeTimestamp(entry.time),
        })
      }

      const layout = readJsonStringRecord(parseEmbeddedJson(root.layout))
      const sessionTabs = readJsonStringRecord(layout?.sessionTabs)
      for (const key of Object.keys(sessionTabs ?? {})) {
        const reference = parseWorkspaceReference(key)
        addProjectDirectory(reference.directory)
        if (reference.sessionId) {
          addSessionReference({
            id: reference.sessionId,
            directory: reference.directory,
            updatedAt: null,
          })
        }
      }

      const permissions = readJsonStringRecord(parseEmbeddedJson(root.permission))
      const autoAccept = readJsonStringRecord(permissions?.autoAccept)
      for (const key of Object.keys(autoAccept ?? {})) {
        const reference = parseWorkspaceReference(key)
        addProjectDirectory(reference.directory)
        if (reference.sessionId) {
          addSessionReference({
            id: reference.sessionId,
            directory: reference.directory,
            updatedAt: null,
          })
        }
      }
    }

    const parseWorkspaceFiles = async () => {
      const entries = await readdir(this.appDataDirectory, { withFileTypes: true }).catch(() => [])
      const workspaceFiles = entries.filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith(WORKSPACE_FILE_PREFIX) &&
          entry.name.endsWith(WORKSPACE_FILE_SUFFIX),
      )

      for (const entry of workspaceFiles) {
        const filePath = path.join(this.appDataDirectory, entry.name)
        const rawWorkspace = await readFile(filePath, "utf8").catch(() => null)
        if (!rawWorkspace) continue

        const workspace = readJsonStringRecord(parseEmbeddedJson(rawWorkspace))
        if (!workspace) continue

        for (const key of Object.keys(workspace)) {
          const sessionId = parseSessionIdFromWorkspaceEntry(key)
          if (!sessionId) continue

          addSessionReference({
            id: sessionId,
            directory: null,
            updatedAt: null,
          })
        }
      }
    }

    await Promise.all([parseGlobalDesktopState(), parseWorkspaceFiles()])

    return {
      projectDirectories: Array.from(projectDirectories).sort((left, right) => left.localeCompare(right)),
      sessionReferences: Array.from(sessionReferenceMap.values()).sort(
        (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
      ),
    }
  }
}
