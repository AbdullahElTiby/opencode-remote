import { createSecretKey } from "node:crypto"
import { jwtVerify, SignJWT } from "jose"
import type { FastifyReply, FastifyRequest } from "fastify"
import type { AuthTokens, Device } from "@opencode-remote/shared"
import { StateStore } from "./state-store.js"

type AccessClaims = {
  sub: string
  hostId: string
  kind: "access"
}

export class AuthService {
  private readonly secret

  public constructor(
    private readonly store: StateStore,
    private readonly hostId: string,
    jwtSecret: string,
    private readonly accessTokenTtlSeconds: number,
  ) {
    this.secret = createSecretKey(Buffer.from(jwtSecret))
  }

  public async issueBundle(device: Device, refreshToken?: string): Promise<AuthTokens> {
    const nextRefreshToken = refreshToken ?? (await this.store.issueRefreshToken(device.id))
    const expiresAt = new Date(Date.now() + this.accessTokenTtlSeconds * 1000).toISOString()
    const accessToken = await new SignJWT({
      hostId: this.hostId,
      kind: "access",
    } satisfies Omit<AccessClaims, "sub">)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(device.id)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTokenTtlSeconds}s`)
      .sign(this.secret)

    return {
      deviceId: device.id,
      accessToken,
      refreshToken: nextRefreshToken,
      expiresAt,
    }
  }

  public async verifyAccessToken(token: string) {
    const result = await jwtVerify(token, this.secret)
    return result.payload as AccessClaims
  }

  public authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization
    if (!header?.startsWith("Bearer ")) {
      reply.code(401)
      throw new Error("Missing bearer token")
    }

    const payload = await this.verifyAccessToken(header.slice("Bearer ".length)).catch(() => null)
    if (!payload || payload.kind !== "access" || payload.hostId !== this.hostId) {
      reply.code(401)
      throw new Error("Invalid access token")
    }

    const device = this.store.findDevice(payload.sub)
    if (!device) {
      reply.code(401)
      throw new Error("Unknown device")
    }

    request.authDevice = device
    await this.store.touchDevice(device.id)
  }
}
