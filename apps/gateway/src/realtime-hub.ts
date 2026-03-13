import type { WebSocket } from "@fastify/websocket"
import type { StreamEvent } from "@opencode-remote/shared"

type Subscriber = {
  socket: WebSocket
}

export class RealtimeHub {
  private readonly subscribers = new Set<Subscriber>()

  public subscribe(socket: WebSocket) {
    const subscriber = { socket }
    this.subscribers.add(subscriber)
    socket.on("close", () => {
      this.subscribers.delete(subscriber)
    })
  }

  public broadcast(event: StreamEvent) {
    const payload = JSON.stringify(event)
    for (const subscriber of this.subscribers) {
      if (subscriber.socket.readyState === 1) subscriber.socket.send(payload)
    }
  }
}
