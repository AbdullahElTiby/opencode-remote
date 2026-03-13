import type { ViewStyle } from "react-native"
import { radii, type ThemeColors } from "./tokens"

export type SurfaceTone =
  | "surface"
  | "surfaceMuted"
  | "panel"
  | "panelStrong"
  | "accent"
  | "danger"
  | "success"
  | "warning"
  | "info"

type SurfaceState = {
  backgroundColor: string
  borderColor: string
  textColor: string
}

function resolveSurfaceTone(colors: ThemeColors, tone: SurfaceTone): SurfaceState {
  switch (tone) {
    case "surfaceMuted":
      return {
        backgroundColor: colors.surfaceMuted,
        borderColor: colors.border,
        textColor: colors.text,
      }
    case "panel":
      return {
        backgroundColor: colors.panel,
        borderColor: colors.border,
        textColor: colors.text,
      }
    case "panelStrong":
      return {
        backgroundColor: colors.panelStrong,
        borderColor: colors.borderStrong,
        textColor: colors.text,
      }
    case "accent":
      return {
        backgroundColor: colors.accent,
        borderColor: colors.accent,
        textColor: colors.textOnAccent,
      }
    case "danger":
      return {
        backgroundColor: colors.dangerSurface,
        borderColor: "#9d585c",
        textColor: colors.danger,
      }
    case "success":
      return {
        backgroundColor: colors.successSurface,
        borderColor: "#4f9164",
        textColor: colors.success,
      }
    case "warning":
      return {
        backgroundColor: colors.warningSurface,
        borderColor: "#9d7b44",
        textColor: colors.warning,
      }
    case "info":
      return {
        backgroundColor: colors.infoSurface,
        borderColor: "#5f7ea3",
        textColor: colors.info,
      }
    case "surface":
    default:
      return {
        backgroundColor: colors.surface,
        borderColor: colors.border,
        textColor: colors.text,
      }
  }
}

export function cardSurface(colors: ThemeColors, tone: SurfaceTone = "surface"): ViewStyle {
  const surface = resolveSurfaceTone(colors, tone)
  return {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: surface.borderColor,
    backgroundColor: surface.backgroundColor,
  }
}

export function inputSurface(colors: ThemeColors, tone: SurfaceTone = "panel"): ViewStyle {
  const surface = resolveSurfaceTone(colors, tone)
  return {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: surface.borderColor,
    backgroundColor: surface.backgroundColor,
  }
}

export function buttonSurface(colors: ThemeColors, tone: SurfaceTone = "panelStrong"): ViewStyle {
  const surface = resolveSurfaceTone(colors, tone)
  return {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: surface.borderColor,
    backgroundColor: surface.backgroundColor,
  }
}

export function tagSurface(colors: ThemeColors, tone: SurfaceTone = "panelStrong"): ViewStyle {
  const surface = resolveSurfaceTone(colors, tone)
  return {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: surface.borderColor,
    backgroundColor: surface.backgroundColor,
  }
}

export function iconButtonSurface(colors: ThemeColors, tone: SurfaceTone = "surface"): ViewStyle {
  const surface = resolveSurfaceTone(colors, tone)
  return {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: surface.borderColor,
    backgroundColor: surface.backgroundColor,
  }
}

export function surfaceTextColor(colors: ThemeColors, tone: SurfaceTone = "panelStrong") {
  return resolveSurfaceTone(colors, tone).textColor
}
