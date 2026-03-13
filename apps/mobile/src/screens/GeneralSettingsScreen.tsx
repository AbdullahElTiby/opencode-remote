import { useMemo, useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import Constants from "expo-constants"
import { SafeAreaView } from "react-native-safe-area-context"
import { AppHeader } from "../components/AppHeader"
import { SelectionModal } from "../components/SelectionModal"
import { SettingToggle } from "../components/SettingToggle"
import { useAppTheme } from "../design/theme"
import { buttonSurface, cardSurface, surfaceTextColor } from "../design/primitives"
import { spacing, typography, type ThemeColors, type ThemeModePreference } from "../design/tokens"
import {
  useAppPreferencesStore,
  type AppLanguagePreference,
  type MonoFontPreference,
  type NotificationPreferenceKey,
  type SoundEffectPreference,
  type SoundPreferenceKey,
} from "../state/app-preferences-store"

type Props = {
  onBack: () => void
}

type PickerTarget =
  | "language"
  | "appearance"
  | "font"
  | "sound-agent"
  | "sound-permissions"
  | "sound-errors"
  | null

const LANGUAGE_ITEMS = [
  { id: "en", title: "English", subtitle: "Current mobile copy stays in English." },
  { id: "tr", title: "Turkish", subtitle: "Preference saved for future localized mobile copy." },
]

const APPEARANCE_ITEMS = [
  { id: "system", title: "System", subtitle: "Follow the device theme." },
  { id: "dark", title: "Dark", subtitle: "Always use the dark mobile theme." },
  { id: "light", title: "Light", subtitle: "Always use the light mobile theme." },
]

const FONT_ITEMS = [
  { id: "system-mono", title: "System Mono", subtitle: "Use the platform monospace family." },
  { id: "monospace", title: "Monospace", subtitle: "Prefer the generic monospace face." },
  { id: "system-sans", title: "System Sans", subtitle: "Use the default sans-serif system font." },
]

const SOUND_ITEMS = [
  { id: "staplebops-01", title: "Staplebops 01", subtitle: "Use the system sound for completion and idle alerts." },
  { id: "staplebops-02", title: "Staplebops 02", subtitle: "Use the system sound for permission alerts." },
  { id: "nope-03", title: "Nope 03", subtitle: "Use the system sound for retry and error alerts." },
  { id: "silent", title: "Silent", subtitle: "No sound for this category." },
]

export function GeneralSettingsScreen({ onBack }: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const [picker, setPicker] = useState<PickerTarget>(null)

  const language = useAppPreferencesStore((state) => state.language)
  const monoFont = useAppPreferencesStore((state) => state.monoFont)
  const themeVariant = useAppPreferencesStore((state) => state.themeVariant)
  const showReasoningSummaries = useAppPreferencesStore((state) => state.showReasoningSummaries)
  const expandShellToolParts = useAppPreferencesStore((state) => state.expandShellToolParts)
  const expandEditToolParts = useAppPreferencesStore((state) => state.expandEditToolParts)
  const notifications = useAppPreferencesStore((state) => state.notifications)
  const sounds = useAppPreferencesStore((state) => state.sounds)
  const checkForUpdatesOnStartup = useAppPreferencesStore((state) => state.checkForUpdatesOnStartup)
  const showReleaseNotes = useAppPreferencesStore((state) => state.showReleaseNotes)
  const setLanguage = useAppPreferencesStore((state) => state.setLanguage)
  const setMonoFont = useAppPreferencesStore((state) => state.setMonoFont)
  const setShowReasoningSummaries = useAppPreferencesStore((state) => state.setShowReasoningSummaries)
  const setExpandShellToolParts = useAppPreferencesStore((state) => state.setExpandShellToolParts)
  const setExpandEditToolParts = useAppPreferencesStore((state) => state.setExpandEditToolParts)
  const setNotificationEnabled = useAppPreferencesStore((state) => state.setNotificationEnabled)
  const setSoundPreference = useAppPreferencesStore((state) => state.setSoundPreference)
  const setCheckForUpdatesOnStartup = useAppPreferencesStore((state) => state.setCheckForUpdatesOnStartup)
  const setShowReleaseNotes = useAppPreferencesStore((state) => state.setShowReleaseNotes)

  const pickerConfig = useMemo(() => {
    switch (picker) {
      case "language":
        return {
          title: "Language",
          selectedId: language,
          items: LANGUAGE_ITEMS,
          onSelect: (value: string) => setLanguage(value as AppLanguagePreference),
        }
      case "appearance":
        return {
          title: "Appearance",
          selectedId: theme.preference,
          items: APPEARANCE_ITEMS,
          onSelect: (value: string) => theme.setPreference(value as ThemeModePreference),
        }
      case "font":
        return {
          title: "Code font",
          selectedId: monoFont,
          items: FONT_ITEMS,
          onSelect: (value: string) => setMonoFont(value as MonoFontPreference),
        }
      case "sound-agent":
        return {
          title: "Agent sound",
          selectedId: sounds.agent,
          items: SOUND_ITEMS,
          onSelect: (value: string) => setSoundPreference("agent", value as SoundEffectPreference),
        }
      case "sound-permissions":
        return {
          title: "Permissions sound",
          selectedId: sounds.permissions,
          items: SOUND_ITEMS,
          onSelect: (value: string) => setSoundPreference("permissions", value as SoundEffectPreference),
        }
      case "sound-errors":
        return {
          title: "Errors sound",
          selectedId: sounds.errors,
          items: SOUND_ITEMS,
          onSelect: (value: string) => setSoundPreference("errors", value as SoundEffectPreference),
        }
      default:
        return null
    }
  }, [language, monoFont, picker, setLanguage, setMonoFont, setSoundPreference, sounds, theme])

  const appVersion = Constants.expoConfig?.version ?? "0.1.0"

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <AppHeader title="General" subtitle="Desktop-style mobile preferences for appearance, feed, and system behavior." onBack={onBack} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appearance</Text>
          <SettingRow
            title="Language"
            description="Choose the mobile app language preference."
            value={language === "tr" ? "Turkish" : "English"}
            onPress={() => setPicker("language")}
          />
          <SettingRow
            title="Appearance"
            description="Customize how OpenCode looks on this device."
            value={formatAppearance(theme.preference, theme.mode)}
            onPress={() => setPicker("appearance")}
          />
          <ReadOnlyRow
            title="Theme"
            description="The current mobile build uses the OC-2 OpenCode brand theme."
            value={themeVariant.toUpperCase()}
          />
          <SettingRow
            title="Font"
            description="Choose the preferred font family for code-heavy UI and terminal surfaces."
            value={formatMonoFont(monoFont)}
            onPress={() => setPicker("font")}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Feed</Text>
          <ToggleRow
            title="Show reasoning summaries"
            description="Show assistant reasoning entries by default in the mobile transcript."
            value={showReasoningSummaries}
            onToggle={() => void setShowReasoningSummaries(!showReasoningSummaries)}
          />
          <ToggleRow
            title="Expand shell tool parts"
            description="Open live shell activity by default in the session details view."
            value={expandShellToolParts}
            onToggle={() => void setExpandShellToolParts(!expandShellToolParts)}
          />
          <ToggleRow
            title="Expand edit tool parts"
            description="Open live edit and patch activity by default in the session details view."
            value={expandEditToolParts}
            onToggle={() => void setExpandEditToolParts(!expandEditToolParts)}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>System notifications</Text>
          <ToggleRow
            title="Agent"
            description="Allow completion-style agent notifications on the mobile companion."
            value={notifications.agent}
            onToggle={() => void updateNotificationPreference(setNotificationEnabled, "agent", notifications.agent)}
          />
          <ToggleRow
            title="Permissions"
            description="Allow permission and approval notifications on the mobile companion."
            value={notifications.permissions}
            onToggle={() =>
              void updateNotificationPreference(setNotificationEnabled, "permissions", notifications.permissions)
            }
          />
          <ToggleRow
            title="Errors"
            description="Allow failure and error notifications on the mobile companion."
            value={notifications.errors}
            onToggle={() => void updateNotificationPreference(setNotificationEnabled, "errors", notifications.errors)}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sound effects</Text>
          <Text style={styles.sectionHint}>Non-silent profiles currently use the system notification sound on mobile.</Text>
          <SettingRow
            title="Agent"
            description="Play a sound when the agent is complete or needs attention."
            value={formatSound(sounds.agent)}
            onPress={() => setPicker("sound-agent")}
          />
          <SettingRow
            title="Permissions"
            description="Play a sound when a permission is required."
            value={formatSound(sounds.permissions)}
            onPress={() => setPicker("sound-permissions")}
          />
          <SettingRow
            title="Errors"
            description="Play a sound when an error occurs."
            value={formatSound(sounds.errors)}
            onPress={() => setPicker("sound-errors")}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Updates</Text>
          <ToggleRow
            title="Check for updates on startup"
            description="Save whether the mobile companion should look for fresh builds when it starts."
            value={checkForUpdatesOnStartup}
            onToggle={() => void setCheckForUpdatesOnStartup(!checkForUpdatesOnStartup)}
          />
          <ToggleRow
            title="Release notes"
            description="Save whether What's New style release notes should appear after updates."
            value={showReleaseNotes}
            onToggle={() => void setShowReleaseNotes(!showReleaseNotes)}
          />
          <Pressable
            style={styles.inlineAction}
            onPress={() => {
              Alert.alert(
                "Current mobile build",
                `Version ${appVersion}\n\nMobile update delivery is currently handled by the installed build. This action confirms the build version on the device today.`,
              )
            }}
          >
            <Text style={styles.inlineActionText}>Check now</Text>
          </Pressable>
        </View>
      </ScrollView>

      <SelectionModal
        visible={Boolean(pickerConfig)}
        title={pickerConfig?.title ?? "Choose setting"}
        searchPlaceholder="Search options"
        items={pickerConfig?.items ?? []}
        selectedId={pickerConfig?.selectedId ?? null}
        onSelect={(value) => pickerConfig?.onSelect(value)}
        onClose={() => setPicker(null)}
      />
    </SafeAreaView>
  )
}

function updateNotificationPreference(
  update: (key: NotificationPreferenceKey, enabled: boolean) => Promise<void>,
  key: NotificationPreferenceKey,
  currentValue: boolean,
) {
  return update(key, !currentValue)
}

function formatAppearance(value: ThemeModePreference, resolvedMode: "dark" | "light") {
  if (value === "system") {
    return `System (${resolvedMode})`
  }
  return value[0].toUpperCase() + value.slice(1)
}

function formatMonoFont(value: MonoFontPreference) {
  switch (value) {
    case "monospace":
      return "Monospace"
    case "system-sans":
      return "System Sans"
    case "system-mono":
    default:
      return "System Mono"
  }
}

function formatSound(value: SoundEffectPreference) {
  switch (value) {
    case "staplebops-01":
      return "Staplebops 01"
    case "staplebops-02":
      return "Staplebops 02"
    case "nope-03":
      return "Nope 03"
    default:
      return "Silent"
  }
}

function SettingRow({
  title,
  description,
  value,
  onPress,
}: {
  title: string
  description: string
  value: string
  onPress: () => void
}) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      <Text style={styles.rowValue}>{value}</Text>
    </Pressable>
  )
}

function ReadOnlyRow({
  title,
  description,
  value,
}: {
  title: string
  description: string
  value: string
}) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

function ToggleRow({
  title,
  description,
  value,
  onToggle,
}: {
  title: string
  description: string
  value: boolean
  onToggle: () => void
}) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      <SettingToggle value={value} onPress={onToggle} />
    </View>
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
    section: {
      ...cardSurface(colors),
      padding: spacing.lg,
      gap: spacing.sm,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "700",
    },
    sectionHint: {
      color: colors.textDim,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: typography.mono,
    },
    row: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    rowCopy: {
      flex: 1,
      gap: 4,
    },
    rowTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
    },
    rowDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 20,
    },
    rowValue: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
      fontFamily: typography.mono,
      textAlign: "right",
      maxWidth: 112,
    },
    inlineAction: {
      ...buttonSurface(colors, "panelStrong"),
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      marginTop: spacing.sm,
    },
    inlineActionText: {
      color: surfaceTextColor(colors, "panelStrong"),
      fontWeight: "700",
    },
  })
}
