import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import {
  deviceSchema,
  type Device,
  type DeviceMetadataUpdateRequest,
  type DevicePreferencesUpdateRequest,
  type DevicePlatform,
} from "@opencode-remote/shared"

type PairingChallenge = {
  id: string
  code: string
  label: string | null
  createdAt: string
  expiresAt: string
}

type RefreshTokenRecord = {
  id: string
  deviceId: string
  tokenHash: string
  createdAt: string
  expiresAt: string
  lastUsedAt: string
}

type PersistedState = {
  hostId: string
  createdAt: string
  devices: Record<string, Device>
  pairingChallenges: Record<string, PairingChallenge>
  refreshTokens: Record<string, RefreshTokenRecord>
}

function nowIso() {
  return new Date().toISOString()
}

function randomId() {
  return crypto.randomUUID()
}

function hashToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function randomCode() {
  return `${Math.floor(100000 + Math.random() * 900000)}`
}

function normalizeDevice(device: unknown): Device {
  return deviceSchema.parse(device)
}

export class StateStore {
  private state: PersistedState | null = null

  public constructor(
    private readonly filePath: string,
    private readonly pairCodeTtlMs: number,
    private readonly refreshTokenTtlSeconds: number,
  ) {}

  public async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    try {
      const raw = await fs.readFile(this.filePath, "utf8")
      this.state = JSON.parse(raw) as PersistedState
    } catch {
      this.state = {
        hostId: randomId(),
        createdAt: nowIso(),
        devices: {},
        pairingChallenges: {},
        refreshTokens: {},
      }
      await this.persist()
    }

    const state = this.requireState()
    state.devices = Object.fromEntries(
      Object.entries(state.devices).map(([deviceId, device]) => [deviceId, normalizeDevice(device)]),
    )
    this.cleanupExpired()
  }

  public getHostId() {
    return this.requireState().hostId
  }

  public listDevices(includeRevoked = false): Device[] {
    this.cleanupExpired()
    return Object.values(this.requireState().devices)
      .filter((device) => includeRevoked || !device.revokedAt)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  public findDevice(deviceId: string) {
    const device = this.requireState().devices[deviceId]
    if (!device || device.revokedAt) return null
    return device
  }

  public async createPairingChallenge(label?: string) {
    const challenge: PairingChallenge = {
      id: randomId(),
      code: randomCode(),
      label: label ?? null,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + this.pairCodeTtlMs).toISOString(),
    }
    this.requireState().pairingChallenges[challenge.id] = challenge
    await this.persist()
    return challenge
  }

  public async consumePairingChallenge(challengeId: string, code: string) {
    this.cleanupExpired()
    const challenge = this.requireState().pairingChallenges[challengeId]
    if (!challenge) return null
    if (challenge.code !== code) return null
    delete this.requireState().pairingChallenges[challengeId]
    await this.persist()
    return challenge
  }

  public async registerDevice(input: {
    name: string
    platform: DevicePlatform
    modelName?: string
    osName?: string
    osVersion?: string
    pushToken?: string
  }) {
    const device = normalizeDevice({
      id: randomId(),
      name: input.name,
      platform: input.platform,
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
      revokedAt: null,
      pushToken: input.pushToken ?? null,
      modelName: input.modelName ?? null,
      osName: input.osName ?? null,
      osVersion: input.osVersion ?? null,
      locationCity: null,
      locationCountry: null,
      locationSharedAt: null,
    })
    this.requireState().devices[device.id] = device
    await this.persist()
    return device
  }

  public async updateDeviceMetadata(deviceId: string, input: DeviceMetadataUpdateRequest) {
    const device = this.findDevice(deviceId)
    if (!device) return null

    if (Object.hasOwn(input, "modelName")) {
      device.modelName = input.modelName ?? null
    }
    if (Object.hasOwn(input, "osName")) {
      device.osName = input.osName ?? null
    }
    if (Object.hasOwn(input, "osVersion")) {
      device.osVersion = input.osVersion ?? null
    }
    if (Object.hasOwn(input, "locationCity")) {
      device.locationCity = input.locationCity ?? null
    }
    if (Object.hasOwn(input, "locationCountry")) {
      device.locationCountry = input.locationCountry ?? null
    }

    if (Object.hasOwn(input, "locationCity") || Object.hasOwn(input, "locationCountry")) {
      device.locationSharedAt =
        device.locationCity || device.locationCountry ? nowIso() : null
    }

    await this.persist()
    return device
  }

  public async updateDevicePreferences(deviceId: string, input: DevicePreferencesUpdateRequest) {
    const device = this.findDevice(deviceId)
    if (!device) return null

    if (input.notifications) {
      device.notificationPreferences = {
        ...device.notificationPreferences,
        ...input.notifications,
      }
    }

    if (input.sounds) {
      device.soundPreferences = {
        ...device.soundPreferences,
        ...input.sounds,
      }
    }

    device.lastSeenAt = nowIso()
    await this.persist()
    return device
  }

  public async touchDevice(deviceId: string) {
    const device = this.findDevice(deviceId)
    if (!device) return
    device.lastSeenAt = nowIso()
    await this.persist()
  }

  public async setPushToken(deviceId: string, pushToken: string) {
    const device = this.findDevice(deviceId)
    if (!device) return null
    device.pushToken = pushToken
    device.lastSeenAt = nowIso()
    await this.persist()
    return device
  }

  public async revokeDevice(deviceId: string) {
    const device = this.requireState().devices[deviceId]
    if (!device || device.revokedAt) return false
    device.revokedAt = nowIso()
    for (const [tokenId, record] of Object.entries(this.requireState().refreshTokens)) {
      if (record.deviceId === deviceId) delete this.requireState().refreshTokens[tokenId]
    }
    await this.persist()
    return true
  }

  public async revokeAllDevices() {
    let revoked = 0

    for (const device of Object.values(this.requireState().devices)) {
      if (device.revokedAt) continue
      device.revokedAt = nowIso()
      revoked += 1
    }

    if (revoked > 0) {
      this.requireState().refreshTokens = {}
      await this.persist()
    }

    return revoked
  }

  public async issueRefreshToken(deviceId: string) {
    const rawToken = crypto.randomBytes(32).toString("hex")
    const record: RefreshTokenRecord = {
      id: randomId(),
      deviceId,
      tokenHash: hashToken(rawToken),
      createdAt: nowIso(),
      lastUsedAt: nowIso(),
      expiresAt: new Date(Date.now() + this.refreshTokenTtlSeconds * 1000).toISOString(),
    }
    this.requireState().refreshTokens[record.id] = record
    await this.persist()
    return rawToken
  }

  public async rotateRefreshToken(rawToken: string) {
    this.cleanupExpired()
    const tokenHash = hashToken(rawToken)
    const record = Object.values(this.requireState().refreshTokens).find((item) => item.tokenHash === tokenHash)
    if (!record) return null
    const device = this.findDevice(record.deviceId)
    if (!device) return null
    delete this.requireState().refreshTokens[record.id]
    device.lastSeenAt = nowIso()
    await this.persist()
    const nextRefreshToken = await this.issueRefreshToken(device.id)
    return {
      device,
      refreshToken: nextRefreshToken,
    }
  }

  private cleanupExpired() {
    const state = this.requireState()
    const now = Date.now()
    for (const [id, challenge] of Object.entries(state.pairingChallenges)) {
      if (Date.parse(challenge.expiresAt) <= now) delete state.pairingChallenges[id]
    }
    for (const [id, token] of Object.entries(state.refreshTokens)) {
      if (Date.parse(token.expiresAt) <= now) delete state.refreshTokens[id]
    }
  }

  private requireState() {
    if (!this.state) throw new Error("StateStore not initialized")
    return this.state
  }

  private async persist() {
    await fs.writeFile(this.filePath, JSON.stringify(this.requireState(), null, 2), "utf8")
  }
}
