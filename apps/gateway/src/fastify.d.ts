import type { Device } from "@opencode-remote/shared"

declare module "fastify" {
  interface FastifyRequest {
    authDevice?: Device
  }
}
