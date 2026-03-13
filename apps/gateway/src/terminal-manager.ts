import type { WebSocket } from "@fastify/websocket"
import { spawn } from "node-pty"
import { terminalInputSchema } from "@opencode-remote/shared"

type TerminalManagerConfig = {
  opencodeBin: string
  opencodeUrl: string
  opencodePassword?: string
}

export class TerminalManager {
  public constructor(private readonly config: TerminalManagerConfig) {}

  public attach(sessionId: string, socket: WebSocket) {
    const args = ["attach", this.config.opencodeUrl, "--session", sessionId]
    if (this.config.opencodePassword) args.push("--password", this.config.opencodePassword)

    const pty = spawn(this.config.opencodeBin, args, {
      name: "xterm-256color",
      cols: 100,
      rows: 36,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    })

    pty.onData((data) => {
      if (socket.readyState !== 1) return
      socket.send(
        JSON.stringify({
          kind: "terminal.frame",
          payload: {
            sessionId,
            data,
          },
        }),
      )
    })

    pty.onExit(({ exitCode, signal }) => {
      if (socket.readyState === 1) {
        socket.send(
          JSON.stringify({
            kind: "terminal.exit",
            payload: {
              sessionId,
              exitCode,
              signal,
            },
          }),
        )
      }
      socket.close()
    })

    socket.on("message", (buffer: Buffer) => {
      const parsed = terminalInputSchema.safeParse(JSON.parse(buffer.toString()))
      if (!parsed.success) return
      switch (parsed.data.type) {
        case "input":
          pty.write(parsed.data.data)
          break
        case "resize":
          pty.resize(parsed.data.cols, parsed.data.rows)
          break
        case "interrupt":
          pty.write("\u0003")
          break
        case "detach":
          pty.kill()
          break
      }
    })

    socket.on("close", () => {
      try {
        pty.kill()
      } catch {
        // Ignore shutdown races.
      }
    })
  }
}
