import { useMemo } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { AppHeader } from "../components/AppHeader"
import { buttonSurface, cardSurface } from "../design/primitives"
import { useAppTheme } from "../design/theme"
import { spacing, typography, type ThemeColors, type ThemeModePreference } from "../design/tokens"

type Props = {
  onBack: () => void
}

export function AppearanceSettingsScreen({ onBack }: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <AppHeader title="Appearance" subtitle="Keep the app comfortable without crowding the session view." onBack={onBack} />

        <View style={styles.card}>
          <Text style={styles.kicker}>THEME</Text>
          <Text style={styles.title}>Choose your look</Text>
          <Text style={styles.body}>
            Theme controls now live here so the session chat can stay focused on the transcript.
          </Text>

          <View style={styles.themeRow}>
            <ThemeChip label="System" value="system" selected={theme.preference} onSelect={theme.setPreference} />
            <ThemeChip label="Dark" value="dark" selected={theme.preference} onSelect={theme.setPreference} />
            <ThemeChip label="Light" value="light" selected={theme.preference} onSelect={theme.setPreference} />
          </View>

          <Text style={styles.meta}>
            Current theme: {theme.preference === "system" ? `System (${theme.mode})` : theme.preference}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ThemeChip({
  label,
  value,
  selected,
  onSelect,
}: {
  label: string
  value: ThemeModePreference
  selected: ThemeModePreference
  onSelect: (value: ThemeModePreference) => Promise<void>
}) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const active = value === selected

  return (
    <Pressable style={[styles.themeChip, active && styles.themeChipActive]} onPress={() => void onSelect(value)}>
      <Text style={[styles.themeChipText, active && styles.themeChipTextActive]}>{label}</Text>
    </Pressable>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.app,
    },
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl,
      gap: spacing.md,
      backgroundColor: colors.app,
    },
    card: {
      ...cardSurface(colors),
      padding: spacing.lg,
      gap: spacing.md,
    },
    kicker: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    title: {
      color: colors.text,
      fontSize: 22,
      fontWeight: "700",
    },
    body: {
      color: colors.textMuted,
      lineHeight: 22,
    },
    themeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    themeChip: {
      ...buttonSurface(colors, "surfaceMuted"),
      minHeight: 40,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    themeChipActive: {
      borderColor: colors.borderStrong,
      backgroundColor: colors.panelStrong,
    },
    themeChipText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: "700",
    },
    themeChipTextActive: {
      color: colors.text,
    },
    meta: {
      color: colors.textDim,
      fontSize: 12,
      fontFamily: typography.mono,
    },
  })
}
