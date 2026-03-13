import { useMemo, type ReactNode } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useAppTheme } from "../design/theme"
import { radii, spacing, typography, type ThemeColors } from "../design/tokens"

type Props = {
  title: string
  subtitle?: string | null
  onBack?: () => void
  right?: ReactNode
}

export function AppHeader({ title, subtitle, onBack, right }: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <View style={styles.root}>
      <View style={styles.left}>
        {onBack ? (
          <Pressable accessibilityRole="button" style={styles.backButton} onPress={onBack}>
            <Text style={styles.backGlyph}>{"<"}</Text>
          </Pressable>
        ) : null}
        <View style={styles.copy}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    left: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      flex: 1,
    },
    backButton: {
      width: 38,
      height: 38,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    backGlyph: {
      color: colors.text,
      fontSize: 22,
      lineHeight: 22,
      marginTop: -1,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "700",
    },
    subtitle: {
      color: colors.textDim,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: typography.mono,
    },
    right: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
  })
}
