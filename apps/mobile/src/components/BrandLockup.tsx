import { useMemo } from "react"
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native"
import { useAppTheme } from "../design/theme"
import { radii, spacing, typography, type ThemeColors } from "../design/tokens"

type Props = {
  compact?: boolean
  caption?: string | null
  markOnly?: boolean
  style?: StyleProp<ViewStyle>
}

export function BrandLockup({ compact = false, caption, markOnly = false, style }: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <View style={style}>
      <View style={styles.row}>
        <Image
          source={markOnly ? theme.brandAssets.logomark : theme.brandAssets.lockup}
          style={markOnly ? (compact ? styles.markCompact : styles.mark) : compact ? styles.lockupCompact : styles.lockup}
          resizeMode="contain"
        />
      </View>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    mark: {
      width: 38,
      height: 48,
      borderRadius: radii.sm,
    },
    markCompact: {
      width: 24,
      height: 30,
      borderRadius: radii.sm,
    },
    lockup: {
      width: 200,
      height: 36,
    },
    lockupCompact: {
      width: 152,
      height: 28,
    },
    caption: {
      marginTop: spacing.sm,
      color: colors.textDim,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: typography.mono,
    },
  })
}
