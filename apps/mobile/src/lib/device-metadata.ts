import { Linking, Platform } from "react-native"
import * as ExpoDevice from "expo-device"
import * as Location from "expo-location"
import type {
  AuthTokens,
  DeviceMetadataUpdateRequest,
  DevicePlatform,
  PairCompleteRequest,
} from "@opencode-remote/shared"
import type { AuthSession } from "../state/auth-store"
import { updateDeviceMetadata } from "./api"

type SyncDeviceMetadataOptions = {
  includeLocationIfGranted?: boolean
  requestLocationPermission?: boolean
  clearLocation?: boolean
}

export type ApproximateLocationPermissionState = "granted" | "undetermined" | "denied" | "unavailable"

function sanitizeText(value: string | null | undefined, maxLength: number) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

export function getDevicePlatform(): DevicePlatform {
  switch (Platform.OS) {
    case "ios":
      return "ios"
    case "android":
      return "android"
    case "web":
      return "web"
    default:
      return "unknown"
  }
}

export function buildPairingDeviceMetadata(): Pick<
  PairCompleteRequest,
  "platform" | "modelName" | "osName" | "osVersion"
> {
  const modelName = sanitizeText(ExpoDevice.modelName ?? null, 120)
  const osName = sanitizeText(ExpoDevice.osName ?? null, 80)
  const osVersion = sanitizeText(ExpoDevice.osVersion ?? null, 80)

  return {
    platform: getDevicePlatform(),
    ...(modelName ? { modelName } : {}),
    ...(osName ? { osName } : {}),
    ...(osVersion ? { osVersion } : {}),
  }
}

function hasMetadata(payload: DeviceMetadataUpdateRequest) {
  return Object.keys(payload).length > 0
}

async function readApproximateLocation(requestPermission: boolean) {
  if (Platform.OS === "web") {
    return {}
  }

  let permission = await Location.getForegroundPermissionsAsync().catch(() => null)
  if (!permission?.granted && requestPermission) {
    permission = await Location.requestForegroundPermissionsAsync().catch(() => null)
  }

  if (!permission?.granted) {
    return {}
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  }).catch(() => null)
  if (!position) {
    return {}
  }

  const placemarks = await Location.reverseGeocodeAsync({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  }).catch(() => [])

  const placemark = placemarks[0]
  if (!placemark) {
    return {}
  }

  const locationCity = sanitizeText(
    placemark.city ?? placemark.subregion ?? placemark.region ?? null,
    120,
  )
  const locationCountry = sanitizeText(placemark.country ?? null, 120)

  if (!locationCity && !locationCountry) {
    return {}
  }

  return {
    ...(locationCity ? { locationCity } : {}),
    ...(locationCountry ? { locationCountry } : {}),
  }
}

export async function getApproximateLocationPermissionState(): Promise<ApproximateLocationPermissionState> {
  if (Platform.OS === "web") {
    return "unavailable"
  }

  const permission = await Location.getForegroundPermissionsAsync().catch(() => null)
  if (!permission) {
    return "unavailable"
  }

  if (permission.granted) {
    return "granted"
  }

  if (permission.status === Location.PermissionStatus.DENIED) {
    return "denied"
  }

  return "undetermined"
}

export async function openAppSystemSettings() {
  await Linking.openSettings()
}

export async function syncCurrentDeviceMetadata(
  session: AuthSession,
  onRefresh: (next: AuthTokens) => Promise<void>,
  options: SyncDeviceMetadataOptions = {},
) {
  const payload: DeviceMetadataUpdateRequest = {}
  const identity = buildPairingDeviceMetadata()

  if (identity.modelName) {
    payload.modelName = identity.modelName
  }
  if (identity.osName) {
    payload.osName = identity.osName
  }
  if (identity.osVersion) {
    payload.osVersion = identity.osVersion
  }

  if (options.clearLocation) {
    payload.locationCity = null
    payload.locationCountry = null
  } else if (options.includeLocationIfGranted ?? true) {
    Object.assign(payload, await readApproximateLocation(Boolean(options.requestLocationPermission)))
  }

  if (!hasMetadata(payload)) {
    return
  }

  await updateDeviceMetadata(session, payload, onRefresh)
}
