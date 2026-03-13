import fs from "node:fs/promises"
import path from "node:path"
import type { ProjectDirectoryBrowseResponse, ProjectDirectoryEntry } from "@opencode-remote/shared"

export class ProjectFilesystemServiceError extends Error {
  public readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = "ProjectFilesystemServiceError"
    this.statusCode = statusCode
  }
}

type CreateProjectDirectoryResult = {
  directory: string
  createdDirectory: boolean
}

export class ProjectFilesystemService {
  public async browseDirectories(rawPath?: string | null): Promise<ProjectDirectoryBrowseResponse> {
    const nextPath = rawPath?.trim()
    if (!nextPath) {
      return {
        currentPath: null,
        parentPath: null,
        entries: await this.listRoots(),
      }
    }

    const directoryPath = this.normalizeAbsolutePath(nextPath)
    const stat = await this.readStat(directoryPath, {
      notFoundMessage: "That folder does not exist on this PC.",
      accessDeniedMessage: "That folder cannot be opened from this PC.",
    })

    if (!stat) {
      throw new ProjectFilesystemServiceError(404, "That folder does not exist on this PC.")
    }

    if (!stat.isDirectory()) {
      throw new ProjectFilesystemServiceError(400, "Choose a folder path, not a file.")
    }

    return {
      currentPath: directoryPath,
      parentPath: this.getParentPath(directoryPath),
      entries: await this.listChildDirectories(directoryPath),
    }
  }

  public async createProjectDirectory(rawPath: string): Promise<CreateProjectDirectoryResult> {
    const directoryPath = this.normalizeAbsolutePath(rawPath)
    const existing = await this.readStat(directoryPath, {
      allowMissing: true,
      notFoundMessage: "That folder does not exist on this PC.",
      accessDeniedMessage: "That folder cannot be created on this PC.",
    })

    if (existing) {
      if (!existing.isDirectory()) {
        throw new ProjectFilesystemServiceError(400, "Choose a folder path, not a file.")
      }

      return {
        directory: directoryPath,
        createdDirectory: false,
      }
    }

    try {
      await fs.mkdir(directoryPath, { recursive: true })
    } catch (error) {
      throw this.toFilesystemError(
        error,
        "That folder could not be created on this PC.",
        "That folder could not be created on this PC.",
      )
    }

    return {
      directory: directoryPath,
      createdDirectory: true,
    }
  }

  private normalizeAbsolutePath(rawPath: string) {
    const trimmed = rawPath.trim()
    if (!trimmed) {
      throw new ProjectFilesystemServiceError(400, "Choose a folder on this PC first.")
    }

    if (trimmed.includes("\0")) {
      throw new ProjectFilesystemServiceError(400, "That folder path is invalid.")
    }

    const normalized = path.normalize(trimmed)
    if (!path.isAbsolute(normalized)) {
      throw new ProjectFilesystemServiceError(400, "Use an absolute folder path from this PC.")
    }

    return normalized
  }

  private async listRoots(): Promise<ProjectDirectoryEntry[]> {
    if (process.platform !== "win32") {
      const root = path.parse(process.cwd()).root || path.sep
      return [{ name: root, path: root }]
    }

    const entries: ProjectDirectoryEntry[] = []
    for (let code = 65; code <= 90; code += 1) {
      const root = `${String.fromCharCode(code)}:\\`
      try {
        const stat = await fs.stat(root)
        if (stat.isDirectory()) {
          entries.push({ name: root, path: root })
        }
      } catch {
        // Ignore inaccessible or unavailable drive letters.
      }
    }

    return entries.sort((left, right) => left.path.localeCompare(right.path))
  }

  private async listChildDirectories(directoryPath: string): Promise<ProjectDirectoryEntry[]> {
    let entries
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true, encoding: "utf8" })
    } catch (error) {
      throw this.toFilesystemError(
        error,
        "That folder does not exist on this PC.",
        "That folder cannot be opened from this PC.",
      )
    }

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(directoryPath, entry.name),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  private getParentPath(directoryPath: string) {
    const parsed = path.parse(directoryPath)
    const normalized = this.trimTrailingSeparators(directoryPath)
    if (normalized === parsed.root) {
      return null
    }

    const parentPath = path.dirname(normalized)
    if (!parentPath || parentPath === normalized) {
      return null
    }

    return parentPath
  }

  private trimTrailingSeparators(directoryPath: string) {
    const parsed = path.parse(directoryPath)
    if (directoryPath === parsed.root) {
      return directoryPath
    }

    return directoryPath.replace(/[\\/]+$/, "") || parsed.root || directoryPath
  }

  private async readStat(
    targetPath: string,
    options: {
      allowMissing?: boolean
      notFoundMessage: string
      accessDeniedMessage: string
    },
  ) {
    try {
      return await fs.stat(targetPath)
    } catch (error) {
      if (options.allowMissing && this.isMissingError(error)) {
        return null
      }

      throw this.toFilesystemError(error, options.notFoundMessage, options.accessDeniedMessage)
    }
  }

  private toFilesystemError(error: unknown, notFoundMessage: string, accessDeniedMessage: string) {
    if (this.isMissingError(error)) {
      return new ProjectFilesystemServiceError(404, notFoundMessage)
    }

    if (this.isAccessError(error)) {
      return new ProjectFilesystemServiceError(403, accessDeniedMessage)
    }

    if (error instanceof ProjectFilesystemServiceError) {
      return error
    }

    return new ProjectFilesystemServiceError(500, "The PC could not finish that folder request.")
  }

  private isMissingError(error: unknown) {
    return this.readErrorCode(error) === "ENOENT"
  }

  private isAccessError(error: unknown) {
    const code = this.readErrorCode(error)
    return code === "EACCES" || code === "EPERM"
  }

  private readErrorCode(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : ""
  }
}
