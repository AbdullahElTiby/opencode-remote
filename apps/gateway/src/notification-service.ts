import type { Device, NotificationPreferenceKey, SoundEffectPreference } from "@opencode-remote/shared"

type ExpoMessage = {
  to: string
  sound?: "default"
  channelId?: string
  title: string
  body: string
  data?: Record<string, unknown>
}

type NotificationMessage = Omit<ExpoMessage, "to" | "sound" | "channelId"> & {
  category: NotificationPreferenceKey
}

function shouldNotifyDevice(device: Device, category: NotificationPreferenceKey) {
  return device.notificationPreferences[category]
}

function shouldPlaySound(soundPreference: SoundEffectPreference) {
  return soundPreference !== "silent"
}

function getAndroidChannelId(category: NotificationPreferenceKey, soundPreference: SoundEffectPreference) {
  return `opencode-${category}-${shouldPlaySound(soundPreference) ? "audible" : "silent"}`
}

export class NotificationService {
  public constructor(private readonly enabled = true) {}

  public async sendToDevices(devices: Device[], message: NotificationMessage) {
    if (!this.enabled) return
    const payload: ExpoMessage[] = []

    for (const device of devices) {
      if (device.revokedAt || !device.pushToken || !shouldNotifyDevice(device, message.category)) {
        continue
      }

      const soundPreference = device.soundPreferences[message.category]
      const soundEnabled = shouldPlaySound(soundPreference)
      const token = device.pushToken

      if (!token.startsWith("ExponentPushToken[") && !token.startsWith("ExpoPushToken[")) {
        continue
      }

      payload.push({
        to: token,
        title: message.title,
        body: message.body,
        data: {
          ...(message.data ?? {}),
          notificationCategory: message.category,
        },
        ...(device.platform === "android"
          ? {
              channelId: getAndroidChannelId(message.category, soundPreference),
            }
          : {}),
        ...(device.platform !== "android" && soundEnabled ? { sound: "default" as const } : {}),
      })
    }

    if (payload.length === 0) return

    for (let index = 0; index < payload.length; index += 100) {
      const chunk = payload.slice(index, index + 100)

      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(chunk),
      })

      if (!response.ok) {
        throw new Error(`Expo push request failed with ${response.status}`)
      }
    }
  }
}
