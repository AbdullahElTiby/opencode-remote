import { Platform, type ImageSourcePropType } from "react-native"

export type ThemeModePreference = "system" | "dark" | "light"
export type ResolvedThemeMode = "dark" | "light"
export type CommandSource = "built-in" | "command" | "mcp" | "skill"

export type ThemeColors = {
  app: string
  canvas: string
  surface: string
  surfaceElevated: string
  surfaceMuted: string
  panel: string
  panelStrong: string
  border: string
  borderStrong: string
  text: string
  textMuted: string
  textDim: string
  textOnAccent: string
  accent: string
  accentSoft: string
  accentMuted: string
  success: string
  successSurface: string
  danger: string
  dangerSurface: string
  warning: string
  warningSurface: string
  info: string
  infoSurface: string
  overlay: string
}

export type BrandAssets = {
  logomark: ImageSourcePropType
  wordmark: ImageSourcePropType
  lockup: ImageSourcePropType
  appIcon: ImageSourcePropType
}

export type AppTheme = {
  mode: ResolvedThemeMode
  colors: ThemeColors
  brandAssets: BrandAssets
  fonts: {
    sans: string
    mono: string
  }
}

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
}

export const radii = {
  sm: 4,
  md: 6,
  lg: 8,
  pill: 6,
}

const defaultSansFont = Platform.select({ ios: "System", android: "sans-serif", default: "System" })
const defaultMonoFont = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" })
let activeMonoFont = defaultMonoFont

export const typography = {
  sans: defaultSansFont,
  get mono() {
    return activeMonoFont
  },
}

export function resolveMonoFontFamily(preference: "system-mono" | "monospace" | "system-sans") {
  switch (preference) {
    case "monospace":
      return Platform.select({ ios: "Courier", android: "monospace", default: "monospace" })
    case "system-sans":
      return defaultSansFont
    case "system-mono":
    default:
      return defaultMonoFont
  }
}

export function setActiveMonoFont(family: string) {
  activeMonoFont = family || defaultMonoFont
}

const darkColors: ThemeColors = {
  app: "#080607",
  canvas: "#0f0c0d",
  surface: "#151112",
  surfaceElevated: "#1b1718",
  surfaceMuted: "#110f10",
  panel: "#191516",
  panelStrong: "#211c1d",
  border: "#2c2728",
  borderStrong: "#474041",
  text: "#f1ecec",
  textMuted: "#b7b1b1",
  textDim: "#7f7879",
  textOnAccent: "#0e0b0b",
  accent: "#f1ecec",
  accentSoft: "#cbc5c5",
  accentMuted: "#6d6667",
  success: "#7dc891",
  successSurface: "#132018",
  danger: "#e08888",
  dangerSurface: "#231315",
  warning: "#d0b17c",
  warningSurface: "#241b11",
  info: "#99b7d8",
  infoSurface: "#121a24",
  overlay: "rgba(8, 6, 7, 0.92)",
}

const lightColors: ThemeColors = {
  app: "#f4efe9",
  canvas: "#fffcf8",
  surface: "#fcf8f3",
  surfaceElevated: "#ffffff",
  surfaceMuted: "#f1ebe4",
  panel: "#ebe4dc",
  panelStrong: "#e0d6cc",
  border: "#d9d0c6",
  borderStrong: "#b9ac9d",
  text: "#171311",
  textMuted: "#615851",
  textDim: "#867a70",
  textOnAccent: "#f7f3ee",
  accent: "#171311",
  accentSoft: "#2e2723",
  accentMuted: "#a69888",
  success: "#277245",
  successSurface: "#e4f2e8",
  danger: "#aa3f43",
  dangerSurface: "#f7e7e8",
  warning: "#8d5d17",
  warningSurface: "#f7efe3",
  info: "#2d618f",
  infoSurface: "#e8f0f8",
  overlay: "rgba(23, 19, 17, 0.2)",
}

const darkAssets: BrandAssets = {
  logomark: require("../../assets/brand/opencode-logomark-dark.png"),
  wordmark: require("../../assets/brand/opencode-wordmark-dark.png"),
  lockup: require("../../assets/brand/opencode-lockup-dark.png"),
  appIcon: require("../../assets/brand/opencode-app-icon.png"),
}

const lightAssets: BrandAssets = {
  logomark: require("../../assets/brand/opencode-logomark-light.png"),
  wordmark: require("../../assets/brand/opencode-wordmark-light.png"),
  lockup: require("../../assets/brand/opencode-lockup-light.png"),
  appIcon: require("../../assets/brand/opencode-app-icon.png"),
}

export function createAppTheme(mode: ResolvedThemeMode, monoFontFamily = defaultMonoFont): AppTheme {
  return {
    mode,
    colors: mode === "light" ? { ...lightColors } : { ...darkColors },
    brandAssets: mode === "light" ? lightAssets : darkAssets,
    fonts: {
      sans: defaultSansFont,
      mono: monoFontFamily,
    },
  }
}

export function sessionStatusTone(colors: ThemeColors, status: string) {
  switch (status) {
    case "busy":
      return {
        backgroundColor: colors.warningSurface,
        borderColor: "#9d7b44",
        textColor: colors.warning,
      }
    case "retry":
      return {
        backgroundColor: colors.infoSurface,
        borderColor: "#5f7ea3",
        textColor: colors.info,
      }
    default:
      return {
        backgroundColor: colors.surfaceMuted,
        borderColor: colors.border,
        textColor: colors.textMuted,
      }
  }
}

export function commandSourceTone(colors: ThemeColors, source: CommandSource) {
  switch (source) {
    case "skill":
      return {
        backgroundColor: colors.infoSurface,
        borderColor: "#5f7ea3",
        textColor: colors.info,
      }
    case "command":
      return {
        backgroundColor: colors.surfaceMuted,
        borderColor: colors.borderStrong,
        textColor: colors.textMuted,
      }
    case "mcp":
      return {
        backgroundColor: colors.warningSurface,
        borderColor: "#9d7b44",
        textColor: colors.warning,
      }
    default:
      return {
        backgroundColor: colors.panelStrong,
        borderColor: colors.borderStrong,
        textColor: colors.text,
      }
  }
}
