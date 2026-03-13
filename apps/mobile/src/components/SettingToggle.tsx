import { useMemo } from "react"
import { Pressable, StyleSheet, View } from "react-native"
import { useAppTheme } from "../design/theme"
import { iconButtonSurface } from "../design/primitives"
import { radii, spacing, type ThemeColors } from "../design/tokens"

type Props = {
  value: boolean
  onPress: () => void
  disabled?: boolean
}

export function SettingToggle({ value, onPress, disabled = false }: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={[styles.track, value && styles.trackActive, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={[styles.thumb, value && styles.thumbActive]} />
    </Pressable>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    track: {
      ...iconButtonSurface(colors, "surfaceMuted"),
      width: 42,
      height: 24,
      padding: 3,
      alignItems: "flex-start",
      justifyContent: "center",
    },
    trackActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
      alignItems: "flex-end",
    },
    thumb: {
      width: 14,
      height: 14,
      borderRadius: radii.sm - 1,
      backgroundColor: colors.textDim,
    },
    thumbActive: {
      backgroundColor: colors.textOnAccent,
    },
    disabled: {
      opacity: 0.55,
    },
  })
}
