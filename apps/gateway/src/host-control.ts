import { execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type HostControlSnapshot = {
  startupEnabled: boolean
  startupSupported: boolean
  disconnectSupported: boolean
}

export interface HostControl {
  getSnapshot(): Promise<HostControlSnapshot>
  setStartupEnabled(enabled: boolean): Promise<HostControlSnapshot>
  disconnectHost(): Promise<void>
}

type PowerShellHostControlOptions = {
  powershellPath?: string
  repoRoot?: string
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function findRepoRoot(startDir: string): string | null {
  let current = path.resolve(startDir)

  while (true) {
    if (
      existsSync(path.join(current, "package.json")) &&
      existsSync(path.join(current, "scripts", "remote-common.ps1"))
    ) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

function resolveRepoRoot(): string {
  return (
    findRepoRoot(process.cwd()) ??
    findRepoRoot(__dirname) ??
    path.resolve(process.cwd())
  )
}

function toPowerShellStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function execFileAsync(filePath: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      filePath,
      args,
      {
        cwd,
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr.trim() || stdout.trim() || error.message
          reject(new Error(message))
          return
        }

        resolve(stdout)
      },
    )
  })
}

export class PowerShellHostControl implements HostControl {
  private readonly repoRoot: string
  private readonly powershellPath: string
  private readonly remoteCommonPath: string
  private readonly stopScriptPath: string

  constructor(options: PowerShellHostControlOptions = {}) {
    this.repoRoot = options.repoRoot ?? resolveRepoRoot()
    this.powershellPath = options.powershellPath ?? "powershell.exe"
    this.remoteCommonPath = path.join(this.repoRoot, "scripts", "remote-common.ps1")
    this.stopScriptPath = path.join(this.repoRoot, "scripts", "stop-remote.ps1")
  }

  async getSnapshot(): Promise<HostControlSnapshot> {
    const startupSupported = this.supportsWindowsStartup()
    const disconnectSupported = this.supportsDisconnect()

    if (!startupSupported) {
      return {
        startupEnabled: false,
        startupSupported,
        disconnectSupported,
      }
    }

    const startupEnabled = await this.readStartupEnabled()
    return {
      startupEnabled,
      startupSupported,
      disconnectSupported,
    }
  }

  async setStartupEnabled(enabled: boolean): Promise<HostControlSnapshot> {
    const disconnectSupported = this.supportsDisconnect()
    if (!this.supportsWindowsStartup()) {
      return {
        startupEnabled: false,
        startupSupported: false,
        disconnectSupported,
      }
    }

    const remoteCommon = toPowerShellStringLiteral(this.remoteCommonPath)
    const repoRoot = toPowerShellStringLiteral(this.repoRoot)
    const action = enabled
      ? `Set-RemoteStartupShortcut -Root ${repoRoot} | Out-Null`
      : "Remove-RemoteStartupShortcut | Out-Null"

    await this.runPowerShell(`
      . ${remoteCommon}
      ${action}
      if (Test-RemoteStartupShortcut) {
        Write-Output "true"
      } else {
        Write-Output "false"
      }
    `)

    return {
      startupEnabled: await this.readStartupEnabled(),
      startupSupported: true,
      disconnectSupported,
    }
  }

  async disconnectHost(): Promise<void> {
    if (!this.supportsDisconnect()) {
      throw new Error("Stopping OpenCode on this host is unavailable right now.")
    }

    const child = spawn(
      this.powershellPath,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", this.stopScriptPath],
      {
        cwd: this.repoRoot,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    )

    child.unref()
  }

  private supportsWindowsStartup(): boolean {
    return process.platform === "win32" && existsSync(this.remoteCommonPath)
  }

  private supportsDisconnect(): boolean {
    return process.platform === "win32" && existsSync(this.stopScriptPath)
  }

  private async readStartupEnabled(): Promise<boolean> {
    const remoteCommon = toPowerShellStringLiteral(this.remoteCommonPath)
    const output = await this.runPowerShell(`
      . ${remoteCommon}
      if (Test-RemoteStartupShortcut) {
        Write-Output "true"
      } else {
        Write-Output "false"
      }
    `)

    return output.trim().toLowerCase().endsWith("true")
  }

  private async runPowerShell(command: string): Promise<string> {
    const encodedCommand = Buffer.from(command, "utf16le").toString("base64")
    return execFileAsync(
      this.powershellPath,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand],
      this.repoRoot,
    )
  }
}
